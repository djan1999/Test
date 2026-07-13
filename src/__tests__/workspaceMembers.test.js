import { afterEach, describe, expect, it, vi } from "vitest";
import handler, { normalizeEmail, normalizeRequestedRole } from "../../api/workspace-members.js";
import { requestWorkspaceMembers } from "../lib/workspaceMembers.js";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

describe("workspace member input safety", () => {
  it("accepts only the three product roles", () => {
    expect(normalizeRequestedRole(" ADMIN ")).toBe("admin");
    expect(normalizeRequestedRole("service")).toBe("service");
    expect(normalizeRequestedRole("kitchen")).toBe("kitchen");
    expect(normalizeRequestedRole("owner")).toBeNull();
    expect(normalizeRequestedRole("superadmin")).toBeNull();
  });

  it("normalizes valid email and rejects malformed input", () => {
    expect(normalizeEmail(" Staff@Example.COM ")).toBe("staff@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("rejects staff API calls without a signed-in access token", async () => {
    const res = responseRecorder();
    await handler({ method: "GET", headers: {}, query: { workspaceId: "ws-1" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects unsupported methods", async () => {
    const res = responseRecorder();
    await handler({ method: "PUT", headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toContain("PATCH");
  });
});

describe("workspace member browser request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the short-lived login token and workspace id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, members: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await requestWorkspaceMembers({ accessToken: "access-token", workspaceId: "ws 1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace-members?workspaceId=ws%201",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("surfaces the server error instead of pretending a role update worked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Cannot remove the last Admin." }),
    }));
    await expect(requestWorkspaceMembers({
      accessToken: "token", workspaceId: "ws", method: "DELETE", payload: { userId: "u1" },
    })).rejects.toThrow(/last Admin/i);
  });
});
