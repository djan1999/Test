// useRealtimeTable — the self-healing realtime subscription. Pins the 11.07
// hardening: a socket can die WITHOUT any status callback (Android screen
// sleep, process suspension), leaving the last recorded status "SUBSCRIBED"
// forever. Wake/online must therefore force a genuinely fresh channel, one
// wake must build one channel (debounced duplicates), late callbacks from a
// removed channel must be inert, and every re-join must trigger the
// consumer's authoritative catch-up read (events missed while dead are gone).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useRealtimeTable } from "../hooks/useRealtimeTable.js";

function makeSupabase() {
  const channels = [];
  const supabase = {
    channel: vi.fn((name) => {
      const ch = {
        name,
        statusCb: null,
        on: vi.fn(function () { return this; }),
        subscribe: vi.fn(function (cb) { this.statusCb = cb; return this; }),
      };
      channels.push(ch);
      return ch;
    }),
    removeChannel: vi.fn(),
  };
  return { supabase, channels };
}

function Harness({ supabase, onStatus, onResubscribe }) {
  useRealtimeTable({
    supabase,
    channelName: "test-channel",
    table: "service_tables",
    onChange: () => {},
    onStatus,
    onResubscribe,
    enabled: true,
  });
  return null;
}

describe("useRealtimeTable — dead-socket healing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fire = (type) => act(() => { window.dispatchEvent(new Event(type)); });
  const settleWake = () => act(() => { vi.advanceTimersByTime(300); });

  it("wake forces a FRESH channel even while the last status is SUBSCRIBED (the falsely-connected bug)", () => {
    const { supabase, channels } = makeSupabase();
    render(<Harness supabase={supabase} />);
    expect(channels.length).toBe(1);
    act(() => channels[0].statusCb("SUBSCRIBED"));

    // Android sleep kills the socket silently — no callback fires. The only
    // signal is the wake. The old hook skipped resubscribe here.
    fire("online");
    settleWake();
    expect(channels.length).toBe(2);
    expect(supabase.removeChannel).toHaveBeenCalledWith(channels[0]);
  });

  it("duplicate wake signals (online + visibilitychange together) build ONE channel", () => {
    const { supabase, channels } = makeSupabase();
    render(<Harness supabase={supabase} />);
    act(() => channels[0].statusCb("SUBSCRIBED"));

    fire("online");
    fire("visibilitychange"); // document.hidden is false in jsdom
    fire("online");
    settleWake();
    expect(channels.length).toBe(2); // one rejoin, not three
  });

  it("late callbacks from a removed channel are inert — they can't kill the replacement", () => {
    const { supabase, channels } = makeSupabase();
    const onStatus = vi.fn();
    render(<Harness supabase={supabase} onStatus={onStatus} />);
    act(() => channels[0].statusCb("SUBSCRIBED"));

    fire("online");
    settleWake();
    const replaced = channels[0];
    act(() => channels[1].statusCb("SUBSCRIBED"));
    onStatus.mockClear();

    // The torn-down channel finally reports CLOSED — must NOT surface in the
    // UI status nor schedule a retry that would churn the healthy channel.
    act(() => replaced.statusCb("CLOSED"));
    expect(onStatus).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(channels.length).toBe(2);
  });

  it("onResubscribe (the catch-up read) fires on every re-join but not the first join", () => {
    const { supabase, channels } = makeSupabase();
    const onResubscribe = vi.fn();
    render(<Harness supabase={supabase} onResubscribe={onResubscribe} />);

    act(() => channels[0].statusCb("SUBSCRIBED"));
    expect(onResubscribe).not.toHaveBeenCalled(); // boot loads own the first fill

    fire("online");
    settleWake();
    act(() => channels[1].statusCb("SUBSCRIBED"));
    expect(onResubscribe).toHaveBeenCalledTimes(1);

    // …and again after an error-path retry re-joins.
    act(() => channels[1].statusCb("CHANNEL_ERROR"));
    act(() => { vi.advanceTimersByTime(1100); });
    act(() => channels[2].statusCb("SUBSCRIBED"));
    expect(onResubscribe).toHaveBeenCalledTimes(2);
  });

  it("CHANNEL_ERROR retries with backoff on a fresh channel", () => {
    const { supabase, channels } = makeSupabase();
    render(<Harness supabase={supabase} />);
    act(() => channels[0].statusCb("CHANNEL_ERROR"));
    expect(channels.length).toBe(1);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(channels.length).toBe(2);
  });
});
