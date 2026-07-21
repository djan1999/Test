import { describe, expect, it, vi } from "vitest";
import { createRestaurantsHandler } from "../restaurants.js";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

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

function request(method = "GET", body) {
  return { method, body, headers: { authorization: "Bearer valid-token", host: "preview.example.com" } };
}

function serverConfig(operatorIds = new Set([OPERATOR_ID]), selfServiceEnabled = false) {
  return { url: "https://project.supabase.co", secretKey: "server-secret", operatorIds, selfServiceEnabled };
}

function adminClient({ existingUser = true } = {}) {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: WORKSPACE_ID, name: "Nova", slug: "nova", tableCount: 2 },
    error: null,
  });
  const inviteUserByEmail = vi.fn().mockResolvedValue({
    data: { user: { id: ADMIN_ID, email: "admin@example.com" } },
    error: null,
  });
  const client = {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: existingUser ? [{ id: ADMIN_ID, email: "admin@example.com" }] : [] },
          error: null,
        }),
        inviteUserByEmail,
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
    rpc,
  };
  return client;
}

function handlerWith({
  requesterId = OPERATOR_ID,
  requesterEmail = "operator@example.com",
  existingUser = true,
  operatorIds,
  selfServiceEnabled = false,
} = {}) {
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: requesterId, email: requesterEmail } },
        error: null,
      }),
    },
  };
  const databaseClient = adminClient({ existingUser });
  const createServerClient = vi.fn()
    .mockReturnValueOnce(authClient)
    .mockReturnValueOnce(databaseClient);
  return {
    databaseClient,
    handler: createRestaurantsHandler({
      createServerClient,
      makeWorkspaceId: () => WORKSPACE_ID,
      readServerConfig: () => serverConfig(
        operatorIds || new Set([OPERATOR_ID]),
        selfServiceEnabled,
      ),
    }),
  };
}

const validBody = {
  name: "Nova",
  slug: "nova",
  subtitle: "SERVICE BOARD",
  adminEmail: "admin@example.com",
  timezone: "Europe/Ljubljana",
  keepOperatorAdmin: true,
  tables: [{ id: 1, label: "T01" }, { id: 2, label: "T02" }],
};

describe("managed restaurant API", () => {
  it("rejects missing login before creating server clients", async () => {
    const createServerClient = vi.fn();
    const handler = createRestaurantsHandler({
      createServerClient,
      readServerConfig: () => serverConfig(),
    });
    const res = responseRecorder();
    await handler({ method: "POST", headers: {}, body: validBody }, res);
    expect(res.statusCode).toBe(401);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("denies signed-in users who are not in the UUID allowlist", async () => {
    const { handler, databaseClient } = handlerWith({ operatorIds: new Set([ADMIN_ID]) });
    const res = responseRecorder();
    await handler(request("POST", validBody), res);
    expect(res.statusCode).toBe(403);
    expect(databaseClient.rpc).not.toHaveBeenCalled();
  });

  it("lets a signed-in owner create a restaurant linked to their own Admin account", async () => {
    const { handler, databaseClient } = handlerWith({
      operatorIds: new Set([ADMIN_ID]),
      selfServiceEnabled: true,
    });
    const res = responseRecorder();
    await handler(request("POST", { ...validBody, adminEmail: "operator@example.com" }), res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.mode).toBe("self-service");
    expect(databaseClient.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(databaseClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(databaseClient.rpc).toHaveBeenCalledWith(
      "provision_managed_restaurant",
      expect.objectContaining({
        p_admin_user_id: OPERATOR_ID,
        p_operator_user_id: OPERATOR_ID,
        p_keep_operator_admin: true,
      }),
    );
  });

  it("does not let a self-service account assign a different first Admin", async () => {
    const { handler, databaseClient } = handlerWith({
      operatorIds: new Set([ADMIN_ID]),
      selfServiceEnabled: true,
    });
    const res = responseRecorder();
    await handler(request("POST", validBody), res);

    expect(res.statusCode).toBe(403);
    expect(res.payload.error).toMatch(/only for your own account/i);
    expect(databaseClient.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(databaseClient.rpc).not.toHaveBeenCalled();
  });

  it("lists only the signed-in owner's restaurants in self-service mode", async () => {
    const authClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: OPERATOR_ID, email: "operator@example.com" } },
          error: null,
        }),
      },
    };
    const membershipEq = vi.fn().mockResolvedValue({
      data: [{ workspace_id: WORKSPACE_ID }],
      error: null,
    });
    const workspaceOrder = vi.fn().mockResolvedValue({
      data: [{ id: WORKSPACE_ID, name: "Nova", slug: "nova", kind: "restaurant" }],
      error: null,
    });
    const workspaceIn = vi.fn(() => ({ order: workspaceOrder }));
    const databaseClient = {
      from: vi.fn((table) => ({
        select: vi.fn(() => (
          table === "workspace_members"
            ? { eq: membershipEq }
            : { in: workspaceIn }
        )),
      })),
    };
    const createServerClient = vi.fn()
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(databaseClient);
    const handler = createRestaurantsHandler({
      createServerClient,
      readServerConfig: () => serverConfig(new Set([ADMIN_ID]), true),
    });
    const res = responseRecorder();

    await handler(request("GET"), res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.canManageOtherRestaurants).toBe(false);
    expect(res.payload.restaurants).toEqual([
      expect.objectContaining({ id: WORKSPACE_ID, name: "Nova" }),
    ]);
    expect(membershipEq).toHaveBeenCalledWith("user_id", OPERATOR_ID);
    expect(workspaceIn).toHaveBeenCalledWith("id", [WORKSPACE_ID]);
  });

  it("calls the single atomic RPC with normalized configuration", async () => {
    const { handler, databaseClient } = handlerWith();
    const res = responseRecorder();
    await handler(request("POST", validBody), res);
    expect(res.statusCode).toBe(201);
    expect(databaseClient.rpc).toHaveBeenCalledTimes(1);
    expect(databaseClient.rpc).toHaveBeenCalledWith(
      "provision_managed_restaurant",
      expect.objectContaining({
        p_workspace_id: WORKSPACE_ID,
        p_admin_user_id: ADMIN_ID,
        p_operator_user_id: OPERATOR_ID,
        p_keep_operator_admin: true,
        p_restaurant_config: expect.objectContaining({
          name: "Nova",
          tables: [{ id: 1, label: "T01" }, { id: 2, label: "T02" }],
        }),
        p_operations_config: { version: 1, timezone: "Europe/Ljubljana" },
      }),
    );
  });

  it("invites a new Admin before provisioning and reports the invitation", async () => {
    const { handler, databaseClient } = handlerWith({ existingUser: false });
    const res = responseRecorder();
    await handler(request("POST", validBody), res);
    expect(res.statusCode).toBe(201);
    expect(databaseClient.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      "admin@example.com",
      { redirectTo: "https://preview.example.com/?set-password=1" },
    );
    expect(res.payload.invited).toBe(true);
  });

  it("rejects invalid restaurant input before Auth invitation or RPC", async () => {
    const { handler, databaseClient } = handlerWith();
    const res = responseRecorder();
    await handler(request("POST", { ...validBody, tables: [] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.fields.tables).toBeTruthy();
    expect(databaseClient.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(databaseClient.rpc).not.toHaveBeenCalled();
  });
});
