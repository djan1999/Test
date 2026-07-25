// The reservation client is thin, but two things in it are load-bearing and
// were wrong once: the manage token has to travel with an availability request
// (otherwise a guest changing their time is blocked by their own table), and it
// must travel as the token — never as a booking id, which anyone could guess
// and use to free a table they do not hold.

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPublicAvailability } from "../reservations-lab/reservationClient.js";

function captureFetch(payload = { ok: true, services: [] }) {
  const spy = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPublicAvailability", () => {
  it("asks for the plain public availability when there is no manage token", async () => {
    const fetchSpy = captureFetch();
    await loadPublicAvailability("2026-07-21", 2);
    const url = new URL(fetchSpy.mock.calls[0][0], "https://milka.test");
    expect(url.pathname).toBe("/api/resv/public");
    expect(url.searchParams.get("mode")).toBe("availability");
    expect(url.searchParams.get("date")).toBe("2026-07-21");
    expect(url.searchParams.get("pax")).toBe("2");
    expect(url.searchParams.has("token")).toBe(false);
  });

  it("carries the manage token so the guest's own table is not counted against them", async () => {
    const fetchSpy = captureFetch();
    await loadPublicAvailability("2026-07-21", 4, "tok_abc123");
    const url = new URL(fetchSpy.mock.calls[0][0], "https://milka.test");
    expect(url.searchParams.get("token")).toBe("tok_abc123");
    // The exclusion is derived server-side from the token. Sending a booking id
    // would let anyone free somebody else's table by guessing it.
    expect(url.searchParams.has("excludeBookingId")).toBe(false);
    expect(url.searchParams.has("bookingId")).toBe(false);
  });

  it("raises the server's own wording rather than a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: "slot_taken", message: "That time has just gone." }),
    })));
    await expect(loadPublicAvailability("2026-07-21", 2)).rejects.toMatchObject({
      code: "slot_taken",
      status: 409,
      message: "That time has just gone.",
    });
  });
});
