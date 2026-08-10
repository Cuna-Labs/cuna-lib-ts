import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { ApiError, ConfigError, Runa } from "../dist/index.js";
import { resolveConfig } from "../dist/config.js";
import { API_KEY, SESSION_ID, jsonResponse, sessionFixture } from "./helpers.mjs";

/*
 * Every wire identity this SDK accepts must admit BOTH brand spellings, keep
 * admitting the one production mints today, and still refuse a malformed one.
 *
 * The failure being prevented is not hypothetical and not deferrable. The
 * service mints these values; the client compares them. On the day a spelling
 * flips, a single-brand comparison rejects a valid response — and a rejected
 * terminal grant or open URL is a single-use 60-second capability destroyed,
 * not retried. Widening costs nothing while the old spelling is still minted,
 * so the widening lands before the flip, never after.
 *
 * Each case below is stated in all three directions on purpose: new accepted,
 * old accepted, malformed rejected. A test that only proves the first would
 * pass just as well against a validator that accepts everything.
 */

const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TERMINAL_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const RESUME_HANDLE = "55555555-5555-4555-8555-555555555555";
const CONNECT_TOKEN_BODY = "a".repeat(43);

function agentSessionFixture(overrides = {}) {
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
    ...overrides,
  };
}

function terminalGrantFixture(overrides = {}) {
  return {
    terminal_session_id: TERMINAL_SESSION_ID,
    resume_handle: RESUME_HANDLE,
    connect_url: `wss://api.getcuna.com/v1/terminal-connections/${TERMINAL_SESSION_ID}/stream`,
    connect_token: `runa_tc_${CONNECT_TOKEN_BODY}`,
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

function authFixture(overrides = {}) {
  const observed = new Date(Date.now() - 1_000);
  return {
    observation_id: "99999999-9999-4999-8999-999999999999",
    agent_session_id: AGENT_SESSION_ID,
    process_epoch: "33333333-3333-4333-8333-333333333333",
    auth_mode: "interactive_login",
    agent_version: "0.147.0",
    adapter_version: "runa.agent-auth.v1",
    evidence_class: "provider_cli_login_status",
    observed_at: observed.toISOString(),
    valid_until: new Date(observed.getTime() + 20_000).toISOString(),
    state: "authenticated",
    ...overrides,
  };
}

function clientFor(route) {
  return new Runa({ apiKey: API_KEY, baseUrl: "https://api.runacode.io", fetch: route });
}

async function grantFor(overrides, record = []) {
  const runa = clientFor(async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/terminal-connections")) {
      record.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonResponse(terminalGrantFixture(overrides), 201);
    }
    return jsonResponse(agentSessionFixture());
  });
  try {
    return await runa.agentSessions.createTerminalConnection(AGENT_SESSION_ID, {
      idempotencyKey: "terminal-connection-1",
      clientInstanceId: "typescript-sdk.test:1",
      resumeHandle: RESUME_HANDLE,
    });
  } finally {
    await runa.close();
  }
}

async function authFor(overrides) {
  const runa = clientFor(async (url) =>
    new URL(url).pathname.endsWith("/agent-auth")
      ? jsonResponse(authFixture(overrides), 200, { "cache-control": "no-store" })
      : jsonResponse(agentSessionFixture()));
  try {
    const session = await runa.agentSessions.get(AGENT_SESSION_ID);
    return await runa.agentSessions.agentAuth(session);
  } finally {
    await runa.close();
  }
}

async function openedUrl(url) {
  const runa = clientFor(async (target) =>
    new URL(target).pathname.endsWith("/open")
      ? jsonResponse({ url })
      : jsonResponse(sessionFixture()));
  try {
    const session = await runa.sessions.get(SESSION_ID);
    return (await session.open()).url;
  } finally {
    await runa.close();
  }
}

async function sessionUrl(url) {
  const runa = clientFor(async () => jsonResponse(sessionFixture({ url })));
  try {
    return (await runa.sessions.get(SESSION_ID)).snapshot.url;
  } finally {
    await runa.close();
  }
}

const malformed = (error) => error instanceof ApiError && error.code === "malformed_response";

test("terminal connect tokens are accepted in both brand spellings", async () => {
  for (const brand of ["cuna", "runa"]) {
    const token = `${brand}_tc_${CONNECT_TOKEN_BODY}`;
    const grant = await grantFor({ connect_token: token });
    assert.equal(grant.connectToken, token, `${brand}_tc_ was rejected`);
  }
});

test("terminal connect tokens of the wrong brand or length are still rejected", async () => {
  const rejected = [
    `nuna_tc_${CONNECT_TOKEN_BODY}`,
    `cuna_tc_${"a".repeat(42)}`,
    `cuna_tc_${"a".repeat(44)}`,
    `cuna_sk_${CONNECT_TOKEN_BODY}`,
    `cuna_tc_${"a".repeat(42)}!`,
  ];
  for (const connect_token of rejected) {
    await assert.rejects(grantFor({ connect_token }), malformed, connect_token);
  }
});

test("terminal protocol is accepted in both brand spellings and echoed, never normalized", async () => {
  for (const protocol of ["cuna.terminal.v1", "runa.terminal.v1"]) {
    const grant = await grantFor({ protocol });
    assert.equal(grant.protocol, protocol, `${protocol} was rejected or rewritten`);
  }
});

test("terminal protocol of an unknown brand or version is still rejected", async () => {
  for (const protocol of ["nuna.terminal.v1", "cuna.terminal.v2", "terminal.v1", "cuna.terminal"]) {
    await assert.rejects(grantFor({ protocol }), malformed, protocol);
  }
});

test("the requested terminal protocol widens without changing what is emitted", async () => {
  const bodies = [];
  await grantFor({}, bodies);
  assert.deepEqual(bodies.map((body) => body.protocol), ["runa.terminal.v1"]);
});

test("agent-auth adapter version is accepted in both brand spellings and echoed", async () => {
  for (const adapter of ["cuna.agent-auth.v1", "runa.agent-auth.v1"]) {
    const auth = await authFor({ adapter_version: adapter });
    assert.equal(auth.adapterVersion, adapter, `${adapter} was rejected or rewritten`);
  }
});

test("agent-auth adapter version of an unknown brand or version is still rejected", async () => {
  for (const adapter of ["nuna.agent-auth.v1", "cuna.agent-auth.v2", "agent-auth.v1"]) {
    await assert.rejects(authFor({ adapter_version: adapter }), malformed, adapter);
  }
});

test("open capability URLs are accepted in both runtime zones", async () => {
  for (const zone of ["cunacode", "runacode"]) {
    const url = `https://synthetic-session.${zone}.cloud/__runa/auth?t=synthetic`;
    assert.equal(await openedUrl(url), url, `${zone}.cloud was rejected`);
  }
});

test("open capability URLs outside a single-label runtime zone are still rejected", async () => {
  const rejected = [
    "https://synthetic-session.cuna.cloud/__runa/auth?t=synthetic",
    "https://synthetic-session.cunacode.io/__runa/auth?t=synthetic",
    "https://a.synthetic-session.cunacode.cloud/__runa/auth?t=synthetic",
    "http://synthetic-session.cunacode.cloud/__runa/auth?t=synthetic",
    "https://synthetic-session.cunacode.cloud/__runa/auth?t=",
    "https://synthetic-session.cunacode.cloud/elsewhere?t=synthetic",
  ];
  for (const url of rejected) {
    await assert.rejects(openedUrl(url), malformed, url);
  }
});

test("session runtime URLs are accepted in both runtime zones", async () => {
  for (const zone of ["cunacode", "runacode"]) {
    const url = `https://synthetic-session.${zone}.cloud`;
    assert.equal(await sessionUrl(url), url, `${zone}.cloud was rejected`);
  }
});

test("session runtime URLs outside a single-label runtime zone are still rejected", async () => {
  const rejected = [
    "https://synthetic-session.cuna.cloud",
    "https://a.synthetic-session.cunacode.cloud",
    "https://synthetic-session.cunacode.cloud/",
    "http://synthetic-session.cunacode.cloud",
  ];
  for (const url of rejected) {
    await assert.rejects(sessionUrl(url), malformed, url);
  }
});

/*
 * Configuration variable names are a branded namespace too, and they broke the
 * same way. The name is minted by the documentation and accepted by
 * `config.ts`, in different files, compared independently — so `CUNA_API_KEY`
 * was dual-accepted while `CUNA_BASE_URL` in the very same config block was
 * read nowhere. That failure is worse than a rejected response: an unread
 * endpoint variable does not error, it falls through to the default host, and
 * the user believes they are pointed somewhere else.
 *
 * The same three directions apply, plus a fourth that only a precedence
 * question has: when both spellings are set, which one wins and does anything
 * say so.
 */

const CANONICAL_URL = "https://api.getcuna.com";
const LEGACY_URL = "https://api.runacode.io";
const CANONICAL_KEY = ["cuna", "sk", "synthetic"].join("_");

function withEnv(values, body) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  try {
    return body();
  } finally {
    vi.unstubAllEnvs();
  }
}

const CLEARED = {
  CUNA_API_KEY: undefined,
  RUNA_API_KEY: undefined,
  CUNA_BASE_URL: undefined,
  RUNA_BASE_URL: undefined,
};

test("the API endpoint is read in both brand spellings", () => {
  for (const [name, url] of [
    ["CUNA_BASE_URL", LEGACY_URL],
    ["RUNA_BASE_URL", LEGACY_URL],
  ]) {
    const resolved = withEnv(
      { ...CLEARED, CUNA_API_KEY: CANONICAL_KEY, [name]: url },
      () => resolveConfig(),
    );
    assert.equal(resolved.baseUrl, url, `${name} was not read`);
    assert.equal(resolved.baseUrlSource, "environment", `${name} was not read`);
  }
});

test("the API key is read in both brand spellings", () => {
  for (const [name, key] of [
    ["CUNA_API_KEY", CANONICAL_KEY],
    ["RUNA_API_KEY", API_KEY],
  ]) {
    const resolved = withEnv({ ...CLEARED, [name]: key }, () => resolveConfig());
    assert.equal(resolved.apiKey, key, `${name} was not read`);
    assert.equal(resolved.apiKeySource, "environment", `${name} was not read`);
  }
});

test("a malformed value in either brand spelling is still rejected", () => {
  const rejected = [
    ["CUNA_BASE_URL", "https://example.invalid"],
    ["RUNA_BASE_URL", "https://example.invalid"],
    ["CUNA_BASE_URL", `http://${"api.getcuna.com"}`],
    ["CUNA_BASE_URL", `${CANONICAL_URL}/v1`],
    ["CUNA_BASE_URL", ""],
    ["RUNA_BASE_URL", ""],
  ];
  for (const [name, value] of rejected) {
    assert.throws(
      () => withEnv(
        { ...CLEARED, CUNA_API_KEY: CANONICAL_KEY, [name]: value },
        () => resolveConfig(),
      ),
      ConfigError,
      `${name}=${value} was accepted`,
    );
  }
  for (const name of ["CUNA_API_KEY", "RUNA_API_KEY"]) {
    assert.throws(
      () => withEnv({ ...CLEARED, [name]: "invalid" }, () => resolveConfig()),
      ConfigError,
      `${name}=invalid was accepted`,
    );
  }
});

test("the canonical spelling wins when both are set, and the loser is named", () => {
  const warnings = [];
  vi.spyOn(process, "emitWarning").mockImplementation((...args) => {
    warnings.push(args);
  });
  try {
    const resolved = withEnv(
      {
        ...CLEARED,
        CUNA_API_KEY: CANONICAL_KEY,
        RUNA_API_KEY: API_KEY,
        CUNA_BASE_URL: CANONICAL_URL,
        RUNA_BASE_URL: LEGACY_URL,
      },
      () => resolveConfig(),
    );
    assert.equal(resolved.apiKey, CANONICAL_KEY);
    assert.equal(resolved.baseUrl, CANONICAL_URL);
    assert.deepEqual(
      warnings.map(([, type]) => type),
      ["CunaConfigWarning", "CunaConfigWarning"],
    );
    assert.match(warnings[0][0], /^RUNA_API_KEY is set to a different value than CUNA_API_KEY\./u);
    assert.match(warnings[1][0], /^RUNA_BASE_URL is set to a different value than CUNA_BASE_URL\./u);
    for (const [text] of warnings) {
      assert.equal(text.includes(CANONICAL_KEY), false, "a warning leaked a value");
      assert.equal(text.includes(API_KEY), false, "a warning leaked a value");
    }
  } finally {
    vi.restoreAllMocks();
  }
});

test("agreeing spellings and a lone legacy spelling are resolved without a warning", () => {
  const warnings = [];
  vi.spyOn(process, "emitWarning").mockImplementation((...args) => {
    warnings.push(args);
  });
  try {
    const agreeing = withEnv(
      {
        ...CLEARED,
        CUNA_API_KEY: CANONICAL_KEY,
        RUNA_API_KEY: CANONICAL_KEY,
        CUNA_BASE_URL: LEGACY_URL,
        RUNA_BASE_URL: LEGACY_URL,
      },
      () => resolveConfig(),
    );
    assert.equal(agreeing.baseUrl, LEGACY_URL);
    const legacyOnly = withEnv(
      { ...CLEARED, RUNA_API_KEY: API_KEY, RUNA_BASE_URL: LEGACY_URL },
      () => resolveConfig(),
    );
    assert.equal(legacyOnly.baseUrl, LEGACY_URL);
    assert.deepEqual(warnings, []);
  } finally {
    vi.restoreAllMocks();
  }
});

test("a present but invalid canonical variable never falls through to its legacy alias", () => {
  assert.throws(
    () => withEnv(
      {
        ...CLEARED,
        CUNA_API_KEY: CANONICAL_KEY,
        CUNA_BASE_URL: "https://example.invalid",
        RUNA_BASE_URL: LEGACY_URL,
      },
      () => resolveConfig(),
    ),
    ConfigError,
    "an invalid CUNA_BASE_URL fell through to RUNA_BASE_URL",
  );
  assert.throws(
    () => withEnv(
      { ...CLEARED, CUNA_API_KEY: "invalid", RUNA_API_KEY: API_KEY },
      () => resolveConfig(),
    ),
    ConfigError,
    "an invalid CUNA_API_KEY fell through to RUNA_API_KEY",
  );
});
