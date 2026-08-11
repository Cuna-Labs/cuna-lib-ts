import assert from "node:assert/strict";
import { test } from "vitest";

import { ApiError, Cuna } from "../dist/index.js";
import { API_KEY, jsonResponse } from "./helpers.mjs";

const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "77777777-7777-4777-8777-777777777777";
const WORKSPACE_GENERATION = 7;
const TERMINAL_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const RESUME_HANDLE = "55555555-5555-4555-8555-555555555555";
const CONNECT_TOKEN = `runa_tc_${"a".repeat(43)}`;

function terminalGrant(overrides = {}) {
  return {
    terminal_session_id: TERMINAL_SESSION_ID,
    resume_handle: RESUME_HANDLE,
    connect_url: `wss://api.getcuna.com/v1/terminal-connections/${TERMINAL_SESSION_ID}/stream`,
    connect_token: CONNECT_TOKEN,
    protocol: "runa.terminal.v1",
    capabilities: [
      { name: "acknowledgement", availability: "supported" },
      { name: "heartbeat", availability: "supported" },
      { name: "live_resize", availability: "unknown" },
      { name: "resume", availability: "supported" },
      { name: "signals", availability: "unsupported" },
    ],
    expires_at: "2026-08-08T12:00:30Z",
    ...overrides,
  };
}

function fixture(overrides = {}) {
  return {
    id: AGENT_SESSION_ID,
    machine_id: MACHINE_ID,
    workspace_binding_id: WORKSPACE_ID,
    workspace_generation: WORKSPACE_GENERATION,
    name: "review",
    agent: "codex",
    cwd: "/workspace/repo",
    auth_mode: "interactive_login",
    desired_state: "running",
    request_state: "launched",
    process_state: "running",
    process_epoch: "33333333-3333-4333-8333-333333333333",
    runtime_observed_at: "2026-08-08T12:00:00Z",
    runtime_expires_at: "2026-08-08T12:00:30Z",
    row_version: 3,
    created_at: "2026-08-08T11:59:00Z",
    updated_at: "2026-08-08T12:00:00Z",
    ...overrides,
  };
}

function authFixture(overrides = {}) {
  const observed = new Date(Date.now() - 1_000);
  const validUntil = new Date(observed.getTime() + 20_000);
  return {
    observation_id: "99999999-9999-4999-8999-999999999999",
    agent_session_id: AGENT_SESSION_ID,
    process_epoch: "33333333-3333-4333-8333-333333333333",
    auth_mode: "interactive_login",
    agent_version: "0.147.0",
    adapter_version: "runa.agent-auth.v1",
    evidence_class: "provider_cli_login_status",
    observed_at: observed.toISOString(),
    valid_until: validUntil.toISOString(),
    state: "authenticated",
    ...overrides,
  };
}

test("AgentSession auth is child-scoped, immutable, fresh, and authority-bound", async () => {
  const calls = [];
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const path = new URL(url).pathname;
      if (path.endsWith("/agent-auth")) {
        return jsonResponse(authFixture(), 200, { "cache-control": "no-store" });
      }
      return jsonResponse(fixture());
    },
  });
  const session = await runa.agentSessions.get(AGENT_SESSION_ID);
  const auth = await runa.agentSessions.agentAuth(session);
  assert.equal(Object.isFrozen(auth), true);
  assert.deepEqual(auth, {
    observationId: "99999999-9999-4999-8999-999999999999",
    agentSessionId: AGENT_SESSION_ID,
    processEpoch: "33333333-3333-4333-8333-333333333333",
    authMode: "interactive_login",
    agentVersion: "0.147.0",
    adapterVersion: "runa.agent-auth.v1",
    evidenceClass: "provider_cli_login_status",
    observedAt: auth.observedAt,
    validUntil: auth.validUntil,
    state: "authenticated",
  });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/agent-sessions/${AGENT_SESSION_ID}`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}/agent-auth`,
  ]);
  await runa.close();
});

test("AgentSession auth rejects stale, contradictory, cacheable, and sibling evidence", async () => {
  const now = Date.now();
  const cases = [
    { payload: authFixture({ extra: true }) },
    { payload: authFixture({ agent_session_id: "88888888-8888-4888-8888-888888888888" }) },
    { payload: authFixture({ process_epoch: "77777777-7777-4777-8777-777777777777" }) },
    { payload: authFixture({ auth_mode: "credential_binding", evidence_class: "credential_binding_authority", state: "configured" }) },
    { payload: authFixture({ adapter_version: "runa.agent-auth.v2" }) },
    { payload: authFixture({ evidence_class: "insufficient", state: "authenticated" }) },
    { payload: authFixture({ observed_at: new Date(now - 40_000).toISOString(), valid_until: new Date(now - 10_000).toISOString() }) },
    { payload: authFixture({ observed_at: new Date(now - 1_000).toISOString(), valid_until: new Date(now + 31_000).toISOString() }) },
    { payload: authFixture({ observed_at: new Date(now + 6_000).toISOString(), valid_until: new Date(now + 20_000).toISOString() }) },
    { payload: authFixture(), headers: {} },
  ];
  for (const item of cases) {
    const runa = new Cuna({
      apiKey: API_KEY,
      fetch: async (url) => new URL(url).pathname.endsWith("/agent-auth")
        ? jsonResponse(item.payload, 200, item.headers ?? { "cache-control": "no-store" })
        : jsonResponse(fixture()),
    });
    const session = await runa.agentSessions.get(AGENT_SESSION_ID);
    await assert.rejects(
      runa.agentSessions.agentAuth(session),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
    await runa.close();
  }
});

test("AgentSession unavailable auth preserves an empty evidence lease", async () => {
  const observed = new Date().toISOString();
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url) => new URL(url).pathname.endsWith("/agent-auth")
      ? jsonResponse(authFixture({
        agent_version: "unavailable",
        evidence_class: "insufficient",
        observed_at: observed,
        valid_until: observed,
        state: "unavailable",
      }), 200, { "cache-control": "no-store" })
      : jsonResponse(fixture()),
  });
  const session = await runa.agentSessions.get(AGENT_SESSION_ID);
  const auth = await runa.agentSessions.agentAuth(session);
  assert.equal(auth.state, "unavailable");
  assert.equal(auth.validUntil, auth.observedAt);
  await runa.close();
});

test("AgentSession methods preserve the authoritative wire contract", async () => {
  const calls = [];
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const path = new URL(url).pathname;
      if (path.endsWith("/terminal-connections")) {
        return jsonResponse(terminalGrant(), 201);
      }
      if (path.endsWith("/agent-sessions") && init.method === "GET") {
        return jsonResponse({ items: [fixture()], next_cursor: "next" });
      }
      if (path.endsWith("/agent-sessions") && init.method === "POST") {
        return jsonResponse(fixture({ request_state: "launch_pending", process_state: "unknown" }), 201);
      }
      if (init.method === "PATCH") return jsonResponse(fixture({ name: "renamed" }));
      if (path.endsWith("/terminate")) {
        return jsonResponse(fixture({ desired_state: "terminated", request_state: "termination_pending" }));
      }
      return jsonResponse(fixture());
    },
  });

  const page = await runa.agentSessions.list(MACHINE_ID, { limit: 25, cursor: "opaque" });
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.items), true);
  assert.equal(page.items[0].processEpoch, "33333333-3333-4333-8333-333333333333");
  assert.equal(page.items[0].workspaceBindingId, WORKSPACE_ID);
  assert.equal(page.items[0].workspaceGeneration, WORKSPACE_GENERATION);
  assert.equal(page.items[0].runtimeExpiresAt, "2026-08-08T12:00:30Z");
  await runa.agentSessions.create(MACHINE_ID, {
    idempotencyKey: "agent-session-create-1",
    agent: "codex",
    cwd: "/workspace/repo",
    workspaceBindingId: WORKSPACE_ID,
    workspaceGeneration: WORKSPACE_GENERATION,
    name: "review",
  });
  await runa.agentSessions.get(AGENT_SESSION_ID);
  await runa.agentSessions.rename(AGENT_SESSION_ID, "renamed");
  await runa.agentSessions.terminate(AGENT_SESSION_ID);
  const grant = await runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
    idempotencyKey: "terminal-connection-1",
    clientInstanceId: "typescript-sdk.test:1",
    resumeHandle: RESUME_HANDLE,
  });

  assert.equal(new URL(calls[0].url).search, "?limit=25&cursor=opaque");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "agent-session-create-1");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    agent: "codex",
    cwd: "/workspace/repo",
    workspace_binding_id: WORKSPACE_ID,
    workspace_generation: WORKSPACE_GENERATION,
    name: "review",
  });
  assert.equal(calls[5].init.headers["Idempotency-Key"], "terminal-connection-1");
  assert.deepEqual(JSON.parse(calls[5].init.body), {
    protocol: "runa.terminal.v1",
    client_instance_id: "typescript-sdk.test:1",
    resume_handle: RESUME_HANDLE,
  });
  assert.equal(grant.terminalSessionId, TERMINAL_SESSION_ID);
  assert.equal(grant.connectToken, CONNECT_TOKEN);
  assert.equal(grant.capabilities.length, 5);
  assert.equal(Object.isFrozen(grant), true);
  assert.equal(Object.isFrozen(grant.capabilities), true);
  assert.equal(Object.isFrozen(grant.capabilities[0]), true);
  assert.deepEqual(calls.map((call) => call.init.method), ["GET", "POST", "GET", "PATCH", "POST", "POST"]);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/sessions/${MACHINE_ID}/agent-sessions`,
    `/v1/sessions/${MACHINE_ID}/agent-sessions`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}/terminate`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}/terminal-connections`,
  ]);
  await runa.close();
});

test("terminal connection input and grant decoding are closed and effect-bounded", async () => {
  let calls = 0;
  let webSocketCalls = 0;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor() { webSocketCalls += 1; }
  };
  try {
    const invalid = [
      terminalGrant({ tenant_id: MACHINE_ID }),
      terminalGrant({ connect_url: `wss://api.runacode.io/v1/terminal-connections/${TERMINAL_SESSION_ID}/stream?token=x` }),
      terminalGrant({ connect_url: "wss://api.runacode.io/v1/terminal-connections/77777777-7777-4777-8777-777777777777/stream" }),
      terminalGrant({ connect_token: "invalid" }),
      terminalGrant({ protocol: "future" }),
      terminalGrant({ capabilities: terminalGrant().capabilities.slice(0, 4) }),
      terminalGrant({ capabilities: [
        ...terminalGrant().capabilities.slice(0, 4),
        { name: "resume", availability: "supported" },
      ] }),
    ];
    const runa = new Cuna({
      apiKey: API_KEY,
      fetch: async () => {
        calls += 1;
        return jsonResponse(invalid.shift(), 201);
      },
    });
    for (let index = 0; index < 7; index += 1) {
      await assert.rejects(
        runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
          idempotencyKey: `terminal-invalid-${index}`,
          clientInstanceId: "typescript-sdk.test",
        }),
        (error) => error instanceof ApiError && error.code === "malformed_response",
      );
    }
    for (const options of [
      { idempotencyKey: "short", clientInstanceId: "client" },
      { idempotencyKey: "terminal-valid-1", clientInstanceId: "client with spaces" },
      { idempotencyKey: "terminal-valid-2", clientInstanceId: "client", protocol: "future" },
      { idempotencyKey: "terminal-valid-3", clientInstanceId: "client", extra: true },
    ]) {
      await assert.rejects(
        runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, options),
        TypeError,
      );
    }
    assert.equal(calls, 7);
    assert.equal(webSocketCalls, 0);
    await runa.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("terminal connection Problem responses remain typed without exposing raw fields", async () => {
  const problem = {
    type: "https://api.getcuna.com/problems/attachment_conflict",
    title: "Attachment conflict",
    status: 409,
    code: "attachment_conflict",
    request_id: "66666666-6666-4666-8666-666666666666",
    retryable: false,
    detail: "Another client owns the attachment.",
    action: "none",
  };
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(problem, 409),
  });
  await assert.rejects(
    runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
      idempotencyKey: "terminal-conflict-1",
      clientInstanceId: "typescript-sdk.test",
    }),
    (error) => {
      assert(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.problem, {
        type: problem.type,
        title: problem.title,
        status: 409,
        code: problem.code,
        requestId: problem.request_id,
        retryable: false,
        detail: problem.detail,
        action: "none",
      });
      assert.equal(Object.isFrozen(error.problem), true);
      assert.equal("provider" in error.problem, false);
      return true;
    },
  );
  await runa.close();
});

test("malformed Problem metadata is discarded instead of widening the public error", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse({
      type: "https://api.runacode.io/problems/attachment_conflict",
      title: "Attachment conflict",
      status: 409,
      code: "attachment_conflict",
      request_id: "66666666-6666-4666-8666-666666666666",
      retryable: false,
      provider: "internal",
    }, 409),
  });
  await assert.rejects(
    runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
      idempotencyKey: "terminal-conflict-2",
      clientInstanceId: "typescript-sdk.test",
    }),
    (error) => {
      assert(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "api_error");
      assert.equal(error.problem, undefined);
      return true;
    },
  );
  await runa.close();
});

test("AgentSession validation and strict decoding fail closed", async () => {
  let calls = 0;
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => {
      calls += 1;
      return jsonResponse(fixture({ unknown_field: true }));
    },
  });
  await assert.rejects(
    runa.agentSessions.create(MACHINE_ID, {
      idempotencyKey: "short",
      agent: "codex",
      cwd: "/workspace/repo",
      workspaceBindingId: WORKSPACE_ID,
      workspaceGeneration: WORKSPACE_GENERATION,
    }),
    TypeError,
  );
  await assert.rejects(
    runa.agentSessions.create(MACHINE_ID, {
      idempotencyKey: "agent-session-create-3",
      agent: "codex",
      cwd: "/workspace/repo",
    }),
    TypeError,
  );
  await assert.rejects(
    runa.agentSessions.create(MACHINE_ID, {
      idempotencyKey: "agent-session-create-old-field",
      agent: "codex",
      cwd: "/workspace/repo",
      workspaceId: WORKSPACE_ID,
      workspaceGeneration: WORKSPACE_GENERATION,
    }),
    TypeError,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    runa.agentSessions.get(AGENT_SESSION_ID),
    (error) => error instanceof ApiError && error.code === "malformed_response",
  );
  assert.equal(calls, 1);
  await runa.close();

  const expiredLease = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(fixture({ runtime_expires_at: "not-a-date" })),
  });
  await assert.rejects(
    expiredLease.agentSessions.get(AGENT_SESSION_ID),
    (error) => error instanceof ApiError && error.code === "malformed_response",
  );
  await expiredLease.close();

  for (const partial of [
    fixture({ workspace_generation: undefined }),
    fixture({ workspace_binding_id: undefined }),
    fixture({ workspace_generation: 0 }),
  ]) {
    for (const key of Object.keys(partial)) {
      if (partial[key] === undefined) delete partial[key];
    }
    const invalidWorkspace = new Cuna({
      apiKey: API_KEY,
      fetch: async () => jsonResponse(partial),
    });
    await assert.rejects(
      invalidWorkspace.agentSessions.get(AGENT_SESSION_ID),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
    await invalidWorkspace.close();
  }

  const legacy = fixture();
  delete legacy.workspace_binding_id;
  delete legacy.workspace_generation;
  const legacyReader = new Cuna({ apiKey: API_KEY, fetch: async () => jsonResponse(legacy) });
  const legacySession = await legacyReader.agentSessions.get(AGENT_SESSION_ID);
  assert.equal(legacySession.workspaceBindingId, undefined);
  assert.equal(legacySession.workspaceGeneration, undefined);
  await legacyReader.close();

  const renamedWireField = fixture();
  renamedWireField.workspace_id = renamedWireField.workspace_binding_id;
  delete renamedWireField.workspace_binding_id;
  const renamedWireReader = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(renamedWireField),
  });
  await assert.rejects(
    renamedWireReader.agentSessions.get(AGENT_SESSION_ID),
    (error) => error instanceof ApiError && error.code === "malformed_response",
  );
  await renamedWireReader.close();
});

test("AgentSession create rejects substituted workspace authority", async () => {
  for (const substitution of [
    { workspace_binding_id: "88888888-8888-4888-8888-888888888888" },
    { workspace_generation: WORKSPACE_GENERATION + 1 },
  ]) {
    const runa = new Cuna({
      apiKey: API_KEY,
      fetch: async () => jsonResponse(fixture(substitution), 201),
    });
    await assert.rejects(
      runa.agentSessions.create(MACHINE_ID, {
        idempotencyKey: "agent-session-create-4",
        agent: "codex",
        cwd: "/workspace/repo",
        workspaceBindingId: WORKSPACE_ID,
        workspaceGeneration: WORKSPACE_GENERATION,
      }),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
    await runa.close();
  }
});
