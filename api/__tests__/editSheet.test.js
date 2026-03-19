import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Helper to build a mock request object
function makeReq({ bearer, header, query } = {}) {
  return {
    headers: {
      authorization: bearer ? `Bearer ${bearer}` : undefined,
      "x-sync-secret": header,
    },
    query: { secret: query },
  };
}

// checkAuth reads SYNC_SECRET and CRON_SECRET at module load time.
// We must resetModules() + stubEnv() before each dynamic import to get a
// fresh module that sees the correct env values.
async function loadCheckAuth() {
  vi.resetModules();
  const mod = await import("../edit-sheet.js");
  return mod.checkAuth;
}

describe("checkAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows request when valid SYNC_SECRET matches query param", async () => {
    vi.stubEnv("SYNC_SECRET", "mysecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ query: "mysecret" }))).toBe(true);
  });

  it("allows request when valid SYNC_SECRET matches x-sync-secret header", async () => {
    vi.stubEnv("SYNC_SECRET", "mysecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ header: "mysecret" }))).toBe(true);
  });

  it("allows request when valid SYNC_SECRET matches Bearer token", async () => {
    vi.stubEnv("SYNC_SECRET", "mysecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ bearer: "mysecret" }))).toBe(true);
  });

  it("allows request when CRON_SECRET matches", async () => {
    vi.stubEnv("CRON_SECRET", "cronsecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ query: "cronsecret" }))).toBe(true);
  });

  it("rejects request with wrong secret", async () => {
    vi.stubEnv("SYNC_SECRET", "mysecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ query: "wrongsecret" }))).toBe(false);
  });

  it("rejects request with no secret provided", async () => {
    vi.stubEnv("SYNC_SECRET", "mysecret");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({}))).toBe(false);
  });

  it("bearer token takes precedence over header and query", async () => {
    vi.stubEnv("SYNC_SECRET", "correct");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ bearer: "correct", header: "wrong", query: "wrong" }))).toBe(true);
  });

  it("allows all requests when no env vars are set (documents current behaviour)", async () => {
    // IMPORTANT: This test documents a known security risk.
    // When neither SYNC_SECRET nor CRON_SECRET is configured, the endpoint
    // is open to all requests. This should be addressed before production.
    vi.stubEnv("SYNC_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ query: "anything" }))).toBe(true);
    expect(checkAuth(makeReq({}))).toBe(true);
  });

  it("accepts either SYNC_SECRET or CRON_SECRET as valid", async () => {
    vi.stubEnv("SYNC_SECRET", "sync");
    vi.stubEnv("CRON_SECRET", "cron");
    const checkAuth = await loadCheckAuth();
    expect(checkAuth(makeReq({ query: "sync" }))).toBe(true);
    expect(checkAuth(makeReq({ query: "cron" }))).toBe(true);
    expect(checkAuth(makeReq({ query: "other" }))).toBe(false);
  });
});
