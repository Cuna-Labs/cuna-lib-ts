import assert from "node:assert/strict";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { format, inspect } from "node:util";
import { test } from "vitest";

import { Cuna } from "../dist/index.js";
import { API_KEY, SESSION_ID, jsonResponse, openUrl, sessionFixture } from "./helpers.mjs";

/*
 * Credential-holding results must not hand their secret to a sink that accepts
 * a redacting hook.
 *
 * A plain frozen object hands it to every sink. `JSON.stringify` is what every
 * structured logger, crash reporter, analytics call and outbound request body
 * reaches for; `util.inspect` is what `console.log`, `util.format("%o")` and
 * Node's uncaught-exception printer reach for. Nothing in the type system
 * objects: the field is a `string`.
 *
 * Serialization is NOT the only place a guard survives, and this file said it
 * was while `console.log(grant)` printed the connect token in full. Two sinks
 * take a hook and both are covered below. The sinks that copy the object's own
 * data properties — object spread, `Object.entries`, `structuredClone`,
 * `URLSearchParams`, `Object.values().join()` — take no hook at all and still
 * read the real value; three of them then hand the hookless copy back to
 * `JSON.stringify`. Closing those needs a guard where the copy is made, not a
 * better hook here.
 *
 * The floor below may only ever GROW. Each case names its object so a removed
 * guard fails by name.
 */

const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TERMINAL_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const RESUME_HANDLE = "55555555-5555-4555-8555-555555555555";
const CONNECT_TOKEN = `runa_tc_${"a".repeat(43)}`;
const REDACTED = "[redacted]";

function terminalGrantFixture() {
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
  };
}

function agentSessionFixture() {
  return {
    id: AGENT_SESSION_ID,
    machine_id: MACHINE_ID,
    workspace_binding_id: "77777777-7777-4777-8777-777777777777",
    workspace_generation: 7,
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
  };
}

test("SEC-5 OpenSessionResult never serializes its capability URL", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    baseUrl: "https://api.runacode.io",
    fetch: async (url) =>
      new URL(url).pathname.endsWith("/open")
        ? jsonResponse({ url: openUrl() })
        : jsonResponse(sessionFixture()),
  });
  const session = await runa.sessions.get(SESSION_ID);
  const result = await session.open();

  // The caller still reads the real capability off the property.
  assert.equal(result.url, openUrl());
  assert.equal(Object.isFrozen(result), true);

  const serialized = JSON.stringify(result);
  assert.equal(
    serialized.includes(openUrl()),
    false,
    "OpenSessionResult.url reached JSON.stringify",
  );
  assert.deepEqual(JSON.parse(serialized), { url: REDACTED });
  // Nested and array positions go through the same `toJSON`.
  assert.equal(JSON.stringify({ result }).includes(openUrl()), false);
  assert.equal(JSON.stringify([result]).includes(openUrl()), false);
  // The redaction must not add an enumerable key or disturb the shape.
  assert.deepEqual(Object.keys(result), ["url"]);
  await runa.close();
});

test("SEC-5 TerminalConnectionGrant never serializes its connect token", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    baseUrl: "https://api.runacode.io",
    fetch: async (url) =>
      new URL(url).pathname.endsWith("/terminal-connections")
        ? jsonResponse(terminalGrantFixture(), 201)
        : jsonResponse(agentSessionFixture()),
  });
  const grant = await runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
    idempotencyKey: "terminal-connection-1",
    clientInstanceId: "typescript-sdk.test:1",
    resumeHandle: RESUME_HANDLE,
  });

  assert.equal(grant.connectToken, CONNECT_TOKEN);
  assert.equal(Object.isFrozen(grant), true);

  const serialized = JSON.stringify(grant);
  assert.equal(
    serialized.includes(CONNECT_TOKEN),
    false,
    "TerminalConnectionGrant.connectToken reached JSON.stringify",
  );
  assert.equal(JSON.parse(serialized).connectToken, REDACTED);
  // The non-secret half is deliberately still serializable: the decoder
  // refuses any grant whose URL contains the token, so the URL stays loggable.
  assert.equal(JSON.parse(serialized).connectUrl, grant.connectUrl);
  assert.equal(JSON.stringify({ grant }).includes(CONNECT_TOKEN), false);
  assert.equal(Object.keys(grant).includes("toJSON"), false);
  await runa.close();
});

/**
 * Capture the bytes `console.log` actually writes, rather than asserting about
 * the function it is documented to call.
 *
 * This builds a real `node:console` Console — the same class the global
 * `console` is an instance of, running the same `util.inspect` path — over a
 * stream owned by the test. The global `console` is unusable here: the test
 * runner replaces it, so asserting against it would prove something about
 * Vitest instead of about this SDK.
 */
function consoleOutput(value) {
  const written = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk));
      done();
    },
  });
  new Console({ stdout: sink, colorMode: false }).log(value);
  return written.join("");
}

test("SEC-5 OpenSessionResult never renders its capability URL to a console", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    baseUrl: "https://api.runacode.io",
    fetch: async (url) =>
      new URL(url).pathname.endsWith("/open")
        ? jsonResponse({ url: openUrl() })
        : jsonResponse(sessionFixture()),
  });
  const session = await runa.sessions.get(SESSION_ID);
  const result = await session.open();

  for (const [sink, rendered] of [
    ["console.log", consoleOutput(result)],
    ["util.inspect", inspect(result)],
    ["util.inspect depth", inspect({ nested: [result] }, { depth: 5 })],
    ["util.format %o", format("%o", result)],
    ["util.format %s", format("%s", result)],
    ["util.format %j", format("%j", result)],
  ]) {
    assert.equal(rendered.includes(openUrl()), false, `OpenSessionResult.url reached ${sink}`);
    assert.equal(rendered.includes(REDACTED), true, `${sink} rendered no redaction marker`);
  }
  // The caller still reads the real capability off the property.
  assert.equal(result.url, openUrl());
  await runa.close();
});

test("SEC-5 TerminalConnectionGrant never renders its connect token to a console", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    baseUrl: "https://api.runacode.io",
    fetch: async (url) =>
      new URL(url).pathname.endsWith("/terminal-connections")
        ? jsonResponse(terminalGrantFixture(), 201)
        : jsonResponse(agentSessionFixture()),
  });
  const grant = await runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
    idempotencyKey: "terminal-connection-1",
    clientInstanceId: "typescript-sdk.test:1",
    resumeHandle: RESUME_HANDLE,
  });

  for (const [sink, rendered] of [
    ["console.log", consoleOutput(grant)],
    ["util.inspect", inspect(grant)],
    ["util.inspect depth", inspect({ nested: [grant] }, { depth: 5 })],
    ["util.format %o", format("%o", grant)],
    ["util.format %s", format("%s", grant)],
    ["util.format %j", format("%j", grant)],
  ]) {
    assert.equal(
      rendered.includes(CONNECT_TOKEN),
      false,
      `TerminalConnectionGrant.connectToken reached ${sink}`,
    );
    assert.equal(rendered.includes(REDACTED), true, `${sink} rendered no redaction marker`);
    // The non-secret half stays visible, or the guard has made the object
    // useless to read rather than safe to log.
    assert.equal(rendered.includes(TERMINAL_SESSION_ID), true, `${sink} hid the whole grant`);
  }
  assert.equal(grant.connectToken, CONNECT_TOKEN);
  // The hook must stay invisible to the object's own shape.
  assert.deepEqual(Object.keys(grant).sort(), [
    "capabilities", "connectToken", "connectUrl", "expiresAt", "protocol",
    "resumeHandle", "terminalSessionId",
  ]);
  await runa.close();
});
