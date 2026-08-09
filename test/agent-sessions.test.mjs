import assert from "node:assert/strict";
import { test } from "vitest";

import { ApiError, Runa } from "../dist/index.js";
import { API_KEY, jsonResponse } from "./helpers.mjs";

const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TERMINAL_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const RESUME_HANDLE = "55555555-5555-4555-8555-555555555555";
const CONNECT_TOKEN = `runa_tc_${"a".repeat(43)}`;

function terminalGrant(overrides = {}) {
  return {
    terminal_session_id: TERMINAL_SESSION_ID,
    resume_handle: RESUME_HANDLE,
    connect_url: `wss://api.runacode.io/v1/terminal-connections/${TERMINAL_SESSION_ID}/stream`,
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
    name: "review",
    agent: "codex",
    cwd: "/workspace/repo",
    auth_mode: "interactive_login",
    desired_state: "running",
    request_state: "launched",
    process_state: "running",
    process_epoch: "33333333-3333-4333-8333-333333333333",
    runtime_observed_at: "2026-08-08T12:00:00Z",
    row_version: 3,
    created_at: "2026-08-08T11:59:00Z",
    updated_at: "2026-08-08T12:00:00Z",
    ...overrides,
  };
}

test("AgentSession methods preserve the authoritative wire contract", async () => {
  const calls = [];
  const runa = new Runa({
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
  await runa.agentSessions.create(MACHINE_ID, {
    idempotencyKey: "agent-session-create-1",
    agent: "codex",
    cwd: "/workspace/repo",
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
    agent: "codex", cwd: "/workspace/repo", name: "review",
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
    const runa = new Runa({
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
    type: "https://api.runacode.io/problems/attachment_conflict",
    title: "Attachment conflict",
    status: 409,
    code: "attachment_conflict",
    request_id: "66666666-6666-4666-8666-666666666666",
    retryable: false,
    detail: "Another client owns the attachment.",
    action: "none",
  };
  const runa = new Runa({
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
  const runa = new Runa({
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
  const runa = new Runa({
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
});
