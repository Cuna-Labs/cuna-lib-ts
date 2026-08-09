import assert from "node:assert/strict";
import { test } from "vitest";

import { ApiError, Runa } from "../dist/index.js";
import { API_KEY, jsonResponse } from "./helpers.mjs";

const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_SESSION_ID = "22222222-2222-4222-8222-222222222222";

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

  assert.equal(new URL(calls[0].url).search, "?limit=25&cursor=opaque");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "agent-session-create-1");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    agent: "codex", cwd: "/workspace/repo", name: "review",
  });
  assert.deepEqual(calls.map((call) => call.init.method), ["GET", "POST", "GET", "PATCH", "POST"]);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/sessions/${MACHINE_ID}/agent-sessions`,
    `/v1/sessions/${MACHINE_ID}/agent-sessions`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}`,
    `/v1/agent-sessions/${AGENT_SESSION_ID}/terminate`,
  ]);
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
