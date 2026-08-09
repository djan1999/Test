// The logbook seam (Phase 1, docs/EVENT_LOG_PLAN.md): fire-and-forget appends,
// a persisted offline queue, idempotent uploads, and a queue that can never
// wedge behind a fact the server refuses forever.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  upserts: [], // every upsert call: { rows, opts }
  nextErrors: [], // shift()ed per upsert; null/undefined = success
  session: { user: { id: "user-1" } },
  serverEvents: [], // rows served to list reads, by ascending id
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    from: (table) => ({
      upsert: (rows, opts) => {
        h.upserts.push({ table, rows, opts });
        const error = h.nextErrors.length ? h.nextErrors.shift() : null;
        return Promise.resolve({ error: error || null });
      },
      select: (_columns, opts) => {
        if (opts?.head) return { eq: () => ({ eq: () => Promise.resolve({ count: 7, error: null }) }) };
        const state = { afterId: null, ascending: true };
        const query = {
          eq: () => query,
          gt: (_col, value) => { state.afterId = value; return query; },
          order: (_col, { ascending }) => { state.ascending = ascending; return query; },
          limit: (n) => {
            let rows = [...h.serverEvents];
            if (state.afterId != null) rows = rows.filter((row) => row.id > state.afterId);
            rows.sort((a, b) => (state.ascending ? a.id - b.id : b.id - a.id));
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          },
        };
        return query;
      },
    }),
    auth: { getSession: async () => ({ data: { session: h.session } }) },
  },
  getWorkspaceId: () => "ws-1",
}));
vi.mock("../lib/clientDiagnostics.js", () => ({ recordClientDiagnostic: vi.fn() }));

import {
  appendServiceEvent, drainServiceEvents, pendingServiceEventCount, getDeviceId,
  readServiceEvents, readAllServiceEvents,
} from "../lib/eventLog.js";

const QUEUE_KEY = "milka_event_queue:ws-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  h.upserts.length = 0;
  h.nextErrors.length = 0;
  h.session = { user: { id: "user-1" } };
  h.serverEvents = [];
});

describe("appendServiceEvent", () => {
  it("queues a device-attributed, uuid-identified fact and drains it", async () => {
    const event = appendServiceEvent({
      serviceId: "svc-1", type: "course_fired", tableId: 3,
      payload: { courseKey: "c2", firedAt: "19:55" },
    });
    expect(event.event_id).toMatch(/[0-9a-f-]{36}/);
    expect(event.device_id).toBe(getDeviceId());
    await flush();
    expect(h.upserts).toHaveLength(1);
    const { rows, opts } = h.upserts[0];
    expect(opts).toEqual({ onConflict: "workspace_id,event_id", ignoreDuplicates: true });
    expect(rows[0]).toMatchObject({
      workspace_id: "ws-1", service_id: "svc-1", actor_id: "user-1",
      type: "course_fired", table_id: 3, payload: { courseKey: "c2", firedAt: "19:55" },
    });
    expect(pendingServiceEventCount()).toBe(0); // accepted — queue empty
  });

  it("without a service or type there is no log line", () => {
    expect(appendServiceEvent({ serviceId: null, type: "course_fired" })).toBeNull();
    expect(appendServiceEvent({ serviceId: "svc-1", type: "" })).toBeNull();
    expect(pendingServiceEventCount()).toBe(0);
  });

  it("the device id is minted once and stays", () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });
});

describe("drainServiceEvents", () => {
  it("a transient failure keeps the queue for the next heartbeat", async () => {
    h.nextErrors.push({ code: "PGRST000", message: "network down" });
    appendServiceEvent({ serviceId: "svc-1", type: "course_fired", payload: {} });
    await flush();
    expect(pendingServiceEventCount()).toBe(1); // kept
    const result = await drainServiceEvents();
    expect(result.ok).toBe(true);
    expect(pendingServiceEventCount()).toBe(0); // heartbeat retry delivered it
  });

  it("a permanent refusal drops EXACTLY the refused fact — the queue never wedges", async () => {
    // Two queued facts; the batch is refused permanently (e.g. the service was
    // purged before the queue drained), then per-event isolation: the first is
    // refused again (dropped with a diagnostic), the second is accepted.
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { event_id: "e-1", service_id: "svc-gone", device_id: "d", type: "course_fired", payload: {}, client_ts: "t" },
      { event_id: "e-2", service_id: "svc-live", device_id: "d", type: "course_fired", payload: {}, client_ts: "t" },
    ]));
    h.nextErrors.push({ code: "23503", message: "fk violation" }); // batch verdict
    h.nextErrors.push({ code: "23503", message: "fk violation" }); // e-1 solo: dropped
    h.nextErrors.push(null); // e-2 solo: accepted
    const result = await drainServiceEvents();
    expect(result.ok).toBe(true);
    expect(pendingServiceEventCount()).toBe(0);
    // batch + two solos = 3 upserts; nothing left behind, nothing retried forever
    expect(h.upserts).toHaveLength(3);
  });

  it("uploads oldest-first in chunks and clears exactly what was accepted", async () => {
    const events = Array.from({ length: 120 }, (_, i) => ({
      event_id: `e-${i}`, service_id: "svc-1", device_id: "d", type: "t", payload: { i }, client_ts: "t",
    }));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events));
    const result = await drainServiceEvents();
    expect(result).toEqual({ ok: true, uploaded: 120 });
    expect(h.upserts.length).toBe(3); // 50 + 50 + 20
    expect(h.upserts[0].rows[0].event_id).toBe("e-0"); // oldest first — fold order
    expect(pendingServiceEventCount()).toBe(0);
  });

  it("reads the WHOLE log to exhaustion — a long night is never silently truncated", async () => {
    h.serverEvents = Array.from({ length: 2350 }, (_, i) => ({ id: i + 1, type: "t", table_id: 1, payload: {} }));
    const all = await readAllServiceEvents("svc-1");
    expect(all).toHaveLength(2350); // three pages: 1000 + 1000 + 350
    expect(all[0].id).toBe(1);
    expect(all[2349].id).toBe(2350);
    // The tail read (story view) stays a single bounded page, newest first.
    const tail = await readServiceEvents("svc-1", { limit: 12, ascending: false });
    expect(tail.map((row) => row.id)).toEqual(Array.from({ length: 12 }, (_, i) => 2350 - i));
  });

  it("caps the queue by dropping the oldest, never blocking a gesture", async () => {
    // Seed a full queue directly (appending 2000 through the API is O(n²)
    // JSON churn — the cap behavior lives in the single append beyond it).
    h.nextErrors.push(...Array.from({ length: 50 }, () => ({ code: "PGRST000", message: "down" })));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({
      event_id: `e-${i}`, service_id: "svc-1", device_id: "d", type: "t", payload: { i }, client_ts: "t",
    }))));
    appendServiceEvent({ serviceId: "svc-1", type: "t", payload: { i: 2000 } });
    await flush();
    expect(pendingServiceEventCount()).toBeLessThanOrEqual(2000);
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(queue[0].event_id).toBe("e-1"); // oldest dropped, newest kept
    expect(queue[queue.length - 1].payload.i).toBe(2000);
  });
});
