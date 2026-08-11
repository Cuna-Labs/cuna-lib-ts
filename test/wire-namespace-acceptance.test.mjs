import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";

import { ApiError, ConfigError, Cuna } from "../dist/index.js";
import { resolveConfig } from "../dist/config.js";
import {
  WIRE_BRANDS,
  brandedApiHostPattern,
  brandedApiOrigins,
  brandedCredentialPrefixes,
  brandedEnvNames,
  brandedReservedPaths,
} from "../dist/internal/wire-namespaces.js";
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
  return new Cuna({ apiKey: API_KEY, baseUrl: "https://api.runacode.io", fetch: route });
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
 * The API host was the half of this concept that derived from nothing.
 *
 * The runtime zone above has had an authority since `brandedZonePattern`; the
 * API host in the very same file did not, so `getcuna.com|runacode.io` was
 * written out by hand five times — the terminal `connect_url` pattern, the
 * problem `type` pattern, the two expected `wss://` origins, the workspace-sync
 * problem `type`, and the two accepted base URLs one module over. Half of one
 * namespace governed by an append-only list and half copied by hand.
 *
 * Both spellings must keep being accepted, and the direction is not symmetric.
 * `api.runacode.io` is serving production traffic right now, so a narrowing
 * here is an outage rather than a cleanup; `api.getcuna.com` is what the
 * service is moving to. Every case below therefore states all three directions
 * — new accepted, old accepted, foreign rejected — and spells its hosts by
 * hand. A case list drawn from `brandedApiOrigins` would narrow along with the
 * derivation and go green on single-brand code, which is exactly how the
 * equivalent test in `libs/python` passed a reverted fix.
 */

const CANONICAL_API_ORIGIN = "https://api.getcuna.com";
const LEGACY_API_ORIGIN = "https://api.runacode.io";
const CANONICAL_STREAM_ORIGIN = "wss://api.getcuna.com";
const LEGACY_STREAM_ORIGIN = "wss://api.runacode.io";
const STREAM_PATH = `/v1/terminal-connections/${TERMINAL_SESSION_ID}/stream`;
const OTHER_TERMINAL_SESSION_ID = "66666666-6666-4666-8666-666666666666";
const WORKSPACE_ID = "77777777-7777-4777-8777-777777777777";
const BINDING_ID = "88888888-8888-4888-8888-888888888888";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POLICY_DIGEST = "a".repeat(64);
const SYNC_CAPABILITIES = [
  "atomic_generation_commit",
  "bounded_manifest_pages",
  "content_digest_verification",
  "explicit_reconciliation",
  "ordered_generation_changes",
  "policy_bound_admission",
];

/**
 * A rejected Problem is not an exception here: the transport drops metadata it
 * cannot decode and reports `api_error` with no `problem`. So `problem.type`
 * present means accepted and `problem === undefined` means rejected, which is
 * a sharper oracle than "it threw".
 */
async function problemFor(type) {
  const runa = clientFor(async () => jsonResponse({
    type,
    title: "Attachment conflict",
    status: 409,
    code: "attachment_conflict",
    request_id: REQUEST_ID,
    retryable: false,
  }, 409));
  try {
    await runa.agentSessions.get(AGENT_SESSION_ID);
  } catch (error) {
    if (error instanceof ApiError) return error.problem;
    throw error;
  } finally {
    await runa.close();
  }
  throw new Error(`a 409 Problem response resolved: ${type}`);
}

/** The same question for the second problem decoder, which compares whole strings. */
async function syncProblemFor(type) {
  const runa = clientFor(async () => jsonResponse({
    type,
    title: "Workspace sync protocol mismatch",
    status: 426,
    code: "workspace_sync_protocol_mismatch",
    request_id: REQUEST_ID,
    retryable: false,
    action: "none",
    selected_protocol: 2,
    capabilities: SYNC_CAPABILITIES,
    detail: "The requested protocol range is not supported.",
  }, 426, { "content-type": "application/problem+json" }));
  try {
    await runa.workspaceSync.begin(WORKSPACE_ID, {
      workspaceBindingId: BINDING_ID,
      machineId: MACHINE_ID,
      baseGeneration: 4,
      exclusionPolicyDigest: POLICY_DIGEST,
      protocol: { minimum: 1, maximum: 2 },
      minimumReader: 1,
      minimumWriter: 2,
    }, "workspace-begin-host-probe");
  } catch (error) {
    if (error instanceof ApiError) return error.problem;
    throw error;
  } finally {
    await runa.close();
  }
  throw new Error(`a 426 workspace-sync Problem response resolved: ${type}`);
}

/*
 * S-3's literal oracle for the API host, spelled by hand.
 *
 * Position 0 and position 1 are asserted as exact strings because a mutation
 * that merely reverses the authority's order would reverse a derived
 * expectation with it and still pass. Length is deliberately NOT asserted: an
 * accepted host ranks nothing the way an environment-variable name does, so a
 * further spelling must be able to widen this surface without a test edit.
 */
test("the accepted API origins are the authority's hosts, canonical first", () => {
  const https = brandedApiOrigins("https");
  assert.equal(https[0], "https://api.getcuna.com");
  assert.equal(https[1], "https://api.runacode.io");
  const wss = brandedApiOrigins("wss");
  assert.equal(wss[0], "wss://api.getcuna.com");
  assert.equal(wss[1], "wss://api.runacode.io");
});

test("the accepted reserved capability paths are the authority's spellings, canonical first", () => {
  const paths = brandedReservedPaths("auth");
  assert.equal(paths[0], "/__cuna/auth");
  assert.equal(paths[1], "/__runa/auth");
});

test("the API-host pattern admits both hosts and nothing adjacent to them", () => {
  const pattern = brandedApiHostPattern("/probe");
  assert.equal(pattern.test("https://api.getcuna.com/probe"), true);
  assert.equal(pattern.test("https://api.runacode.io/probe"), true);
  const rejected = [
    // An unescaped `.` in the alternation would accept this one.
    "https://apixgetcuna.com/probe",
    "https://api.getnuna.com/probe",
    "https://api.runacode.cloud/probe",
    "https://evil.api.getcuna.com/probe",
    "https://api.getcuna.com.evil.invalid/probe",
    "http://api.getcuna.com/probe",
    "https://api.getcuna.com/probe/more",
  ];
  for (const candidate of rejected) {
    assert.equal(pattern.test(candidate), false, `${candidate} was accepted`);
  }
  const stream = brandedApiHostPattern("/probe", "wss");
  assert.equal(stream.test("wss://api.getcuna.com/probe"), true);
  assert.equal(stream.test("wss://api.runacode.io/probe"), true);
  assert.equal(stream.test("https://api.runacode.io/probe"), false);
});

test("terminal grants are accepted on both branded API hosts", async () => {
  for (const origin of [CANONICAL_STREAM_ORIGIN, LEGACY_STREAM_ORIGIN]) {
    const connect_url = `${origin}${STREAM_PATH}`;
    const grant = await grantFor({ connect_url });
    assert.equal(grant.connectUrl, connect_url, `${origin} was rejected`);
  }
});

test("terminal grants on a host outside the authority are still rejected", async () => {
  const rejected = [
    `wss://apixgetcuna.com${STREAM_PATH}`,
    `wss://api.getnuna.com${STREAM_PATH}`,
    `wss://api.runacode.cloud${STREAM_PATH}`,
    `wss://evil.api.getcuna.com${STREAM_PATH}`,
    `https://api.getcuna.com${STREAM_PATH}`,
    // Right host, wrong session: the equality check binds the URL to the id
    // the grant itself declared, which the pattern alone cannot.
    `wss://api.getcuna.com/v1/terminal-connections/${OTHER_TERMINAL_SESSION_ID}/stream`,
  ];
  for (const connect_url of rejected) {
    await assert.rejects(grantFor({ connect_url }), malformed, connect_url);
  }
});

test("Problem types are accepted on both branded API hosts", async () => {
  for (const origin of [CANONICAL_API_ORIGIN, LEGACY_API_ORIGIN]) {
    const type = `${origin}/problems/attachment_conflict`;
    const problem = await problemFor(type);
    assert.equal(problem?.type, type, `${origin} was rejected`);
  }
});

test("Problem types on a host outside the authority are still discarded", async () => {
  const rejected = [
    "https://apixgetcuna.com/problems/attachment_conflict",
    "https://api.getnuna.com/problems/attachment_conflict",
    "https://api.runacode.cloud/problems/attachment_conflict",
    "https://evil.api.getcuna.com/problems/attachment_conflict",
    "http://api.getcuna.com/problems/attachment_conflict",
  ];
  for (const type of rejected) {
    assert.equal(await problemFor(type), undefined, `${type} was accepted`);
  }
});

test("workspace-sync Problem types are accepted on both branded API hosts", async () => {
  for (const origin of [CANONICAL_API_ORIGIN, LEGACY_API_ORIGIN]) {
    const type = `${origin}/problems/workspace_sync_protocol_mismatch`;
    const problem = await syncProblemFor(type);
    assert.equal(problem?.type, type, `${origin} was rejected`);
  }
});

test("workspace-sync Problem types on a host outside the authority are still discarded", async () => {
  const rejected = [
    "https://apixgetcuna.com/problems/workspace_sync_protocol_mismatch",
    "https://api.getnuna.com/problems/workspace_sync_protocol_mismatch",
    "https://api.runacode.cloud/problems/workspace_sync_protocol_mismatch",
    // Right host, wrong code: the type must name the code the body declared.
    `${CANONICAL_API_ORIGIN}/problems/workspace_sync_authority_unavailable`,
  ];
  for (const type of rejected) {
    assert.equal(await syncProblemFor(type), undefined, `${type} was accepted`);
  }
});

test("both branded API origins are accepted as a base URL, with or without a trailing slash", () => {
  for (const origin of [CANONICAL_API_ORIGIN, LEGACY_API_ORIGIN]) {
    for (const value of [origin, `${origin}/`]) {
      const resolved = withEnv(
        { ...CLEARED },
        () => resolveConfig({ apiKey: CANONICAL_KEY, baseUrl: value }),
      );
      assert.equal(resolved.baseUrl, origin, `${value} was rejected`);
    }
  }
});

test("a base URL on a host outside the authority is still rejected", () => {
  const rejected = [
    "https://apixgetcuna.com",
    "https://api.getnuna.com",
    "https://api.runacode.cloud",
    "https://evil.api.getcuna.com",
    "http://api.getcuna.com",
    `${CANONICAL_API_ORIGIN}//`,
  ];
  for (const baseUrl of rejected) {
    assert.throws(
      () => withEnv({ ...CLEARED }, () => resolveConfig({ apiKey: CANONICAL_KEY, baseUrl })),
      ConfigError,
      `${baseUrl} was accepted`,
    );
  }
});

/*
 * Open capability URLs carry a branded PATH as well as a branded zone, and it
 * was compared twice inside one function: once as raw text by the pattern and
 * once as `parsed.pathname` after the URL is re-parsed. The double check stays
 * — the parse asserts things no pattern over the raw text can, such as the
 * absence of credentials, a port or a fragment — but both halves now read one
 * derived accept set, so they cannot disagree about which paths are a
 * capability, and both widened together.
 */
test("open capability URLs are accepted in both reserved-path spellings", async () => {
  for (const reserved of ["/__cuna/auth", "/__runa/auth"]) {
    const url = `https://synthetic-session.cunacode.cloud${reserved}?t=synthetic`;
    assert.equal(await openedUrl(url), url, `${reserved} was rejected`);
  }
});

test("open capability URLs on an unknown reserved path are still rejected", async () => {
  const rejected = [
    "https://synthetic-session.cunacode.cloud/__nuna/auth?t=synthetic",
    "https://synthetic-session.cunacode.cloud/_cuna/auth?t=synthetic",
    "https://synthetic-session.cunacode.cloud/__cuna/authorize?t=synthetic",
    "https://synthetic-session.cunacode.cloud/__cuna/auth/more?t=synthetic",
    "https://synthetic-session.cunacode.cloud/__cuna/auth#t=synthetic",
  ];
  for (const url of rejected) {
    await assert.rejects(openedUrl(url), malformed, url);
  }
});

/*
 * S-4(a)'s detector, and the only kind that can see that mutation.
 *
 * Reverting any call site to its hand-written alternation preserves behaviour
 * exactly today — a copy agrees with the authority right up until the authority
 * grows — so no behavioural assertion above can fire on it. Absence of the
 * spelling is the one property a copy cannot satisfy.
 *
 * This is an ABSENCE detector, which is why it survives the trap that killed
 * the `CUNA_BASE_URL` occurrence count: a correct implementation scores zero
 * and a defective one scores more, so abstracting the source correctly cannot
 * make it read like a fix. The allowlist is exact rather than a skip rule, so
 * a new file that spells a host has to be argued for here.
 */
const API_HOST_AUTHORITY = "src/internal/wire-namespaces.ts";
const API_HOST_PROSE = "src/types.ts";

/*
 * The labels, not the whole hosts, and the source is read with backslashes
 * removed. Measured: the first version of this detector searched for
 * `getcuna.com`, applied the S-4(a) mutation — the terminal-connection pattern
 * reverted to its hand-written alternation — and stayed GREEN, because a regex
 * spells the host `getcuna\.com` and the dot is not there to find. A detector
 * that a correct revert walks straight past is decorative, which is the whole
 * complaint this commit is about, reappearing one layer up.
 */
const API_HOST_SPELLINGS = ["getcuna", "runacode"];
const unescaped = (source) => source.toLowerCase().replaceAll("\\", "");

/**
 * Hand-written modules only. `src/internal/contract/generated/` is a projection
 * of the canonical OpenAPI artifact and is regenerated, never edited, so a
 * spelling there is the contract's to change and not this package's.
 */
const GENERATED = "src/internal/contract/generated";

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name).replaceAll("\\", "/");
    if (target === GENERATED) continue;
    if (entry.isDirectory()) found.push(...await sourceFiles(target));
    else if (entry.name.endsWith(".ts")) found.push(target);
  }
  return found;
}

test("no module outside the API-host authority spells an API host", async () => {
  const files = await sourceFiles("src");
  assert.ok(files.length > 10, "src was not walked");
  assert.ok(files.includes("src/domain.ts"), "src/domain.ts was not read");
  assert.ok(files.includes("src/config.ts"), "src/config.ts was not read");
  const offenders = [];
  for (const file of files) {
    if (file === API_HOST_AUTHORITY || file === API_HOST_PROSE) continue;
    const source = unescaped(await readFile(file, "utf8"));
    for (const host of API_HOST_SPELLINGS) {
      if (source.includes(host)) offenders.push(`${file} spells ${host}`);
    }
  }
  assert.deepEqual(offenders, []);
  // Negative control: the two allowed files really do spell them, so a misread
  // or renamed tree cannot pass this vacuously.
  const authority = unescaped(await readFile(API_HOST_AUTHORITY, "utf8"));
  for (const host of API_HOST_SPELLINGS) {
    assert.equal(authority.includes(host), true, `${API_HOST_AUTHORITY} was not read`);
  }
});

test("no module outside the wire-namespace authority spells a reserved capability path", async () => {
  const files = await sourceFiles("src");
  const offenders = [];
  for (const file of files) {
    if (file === API_HOST_AUTHORITY) continue;
    const source = unescaped(await readFile(file, "utf8"));
    for (const brand of WIRE_BRANDS) {
      if (source.includes(`__${brand}/`)) offenders.push(`${file} spells __${brand}/`);
    }
  }
  assert.deepEqual(offenders, []);
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

/*
 * A literal oracle over the derivation itself, and the reason every case below
 * spells its variable names out by hand instead of looping over
 * `brandedEnvNames(...)`.
 *
 * A dual-accept test that draws its cases from the list under test can only
 * ever confirm that the implementation agrees with itself. Revert the fix so
 * the resolver reads one spelling and such a test does not fail — the missing
 * case simply stops existing and the suite goes green on defective code. That
 * is this workspace's recurring defect class reappearing inside the test
 * written to prevent it, so the oracle has to be independent of its subject.
 *
 * `Covers<>` in `config.ts` catches one half of this: SHRINKING `WIRE_BRANDS`
 * is a compile error. It does not catch the other half. Reordering the list
 * compiles cleanly and silently swaps which variable wins, because precedence
 * is list order. The type system guards the source; only a literal oracle
 * guards the order.
 *
 * Appending a third brand is meant to fail this test. The list is append-only
 * and now decides precedence, so a new spelling landing in a ranked position
 * should require a deliberate edit here rather than inheriting a rank in
 * silence.
 */
test("the configuration names derive to exactly both spellings, canonical first", () => {
  assert.deepEqual(brandedEnvNames("BASE_URL"), ["CUNA_BASE_URL", "RUNA_BASE_URL"]);
  assert.deepEqual(brandedEnvNames("API_KEY"), ["CUNA_API_KEY", "RUNA_API_KEY"]);
});

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

/*
 * The API key is the branded namespace with the highest cost of a narrow
 * accept, and its predicate was the last place in this package still comparing
 * against two hand-written spellings. `config.ts` imports the brand authority
 * for the variable NAMES and then, a hundred lines lower, wrote the credential
 * prefixes out by hand — the same producer/consumer split as every case above,
 * this time in shipped authentication.
 *
 * Keys in the legacy spelling are issued and customer-held, so the direction
 * this predicate may move is fixed: it must accept everything it accepts today
 * plus whatever the authority gains, and lose nothing. A rejected key does not
 * even report itself as a key problem — `resolveConfig` fails closed with
 * `ConfigError`, "configuration is invalid", for a credential that is valid.
 *
 * Every case is spelled by hand rather than drawn from `brandedCredentialPrefixes`.
 * A dual-accept test parametrized over its own subject narrows with the subject:
 * revert the fix and the case that would have failed simply stops existing.
 */

const secretKey = (brand) => [brand, "sk", "synthetic"].join("_");

/*
 * S-3's literal oracle. Position 0 is asserted as an exact string because a
 * mutation that merely reverses the authority would reverse a derived
 * expectation with it and still pass. Length is deliberately NOT asserted:
 * unlike `brandedEnvNames`, where order decides which variable wins and an
 * append must be reviewed, an accepted credential prefix ranks nothing, so a
 * further spelling must be able to widen this surface in silence.
 */
test("the accepted API-key prefixes are the authority's spellings, canonical first", () => {
  const prefixes = brandedCredentialPrefixes("sk");
  assert.equal(prefixes[0], "cuna_sk_");
  assert.equal(prefixes[1], "runa_sk_");
});

test("an API key is accepted in both brand spellings of the secret-key prefix", () => {
  for (const name of ["CUNA_API_KEY", "RUNA_API_KEY"]) {
    for (const key of [secretKey("cuna"), secretKey("runa")]) {
      const resolved = withEnv({ ...CLEARED, [name]: key }, () => resolveConfig());
      assert.equal(resolved.apiKey, key, `${key} was rejected via ${name}`);
      assert.equal(resolved.apiKeySource, "environment", `${key} was rejected via ${name}`);
    }
  }
});

test("an API key is accepted in both brand spellings from the constructor too", () => {
  for (const key of [secretKey("cuna"), secretKey("runa")]) {
    const resolved = withEnv({ ...CLEARED }, () => resolveConfig({ apiKey: key }));
    assert.equal(resolved.apiKey, key, `${key} was rejected by the constructor`);
    assert.equal(resolved.apiKeySource, "constructor", `${key} was rejected by the constructor`);
  }
});

test("a value outside every accepted secret-key prefix is still rejected", () => {
  const rejected = [
    secretKey("nuna"),
    ["cuna", "tc", "synthetic"].join("_"),
    ["cuna", "sk"].join("_"),
    ["sk", "synthetic"].join("_"),
    "synthetic",
    "   ",
    "",
  ];
  for (const key of rejected) {
    assert.throws(
      () => withEnv({ ...CLEARED, CUNA_API_KEY: key }, () => resolveConfig()),
      ConfigError,
      `${JSON.stringify(key)} was accepted as an API key`,
    );
  }
});

/*
 * Reverting to the two hand-written prefixes preserves behaviour exactly today,
 * so no assertion above can see it — and agreeing with the authority right up
 * until the authority grows is precisely what a copy does. Absence of the
 * spelling is the one property a copy cannot satisfy.
 *
 * Scoped to the credential prefix, not to the whole file: `config.ts`
 * deliberately spells the environment-variable names, which have their own
 * literal oracle above. The presence assertion is the negative control — a
 * misread or renamed file would otherwise pass this vacuously.
 */
test("the configuration module spells no secret-key prefix of its own", async () => {
  const source = (await readFile("src/config.ts", "utf8")).toLowerCase();
  assert.equal(source.includes("cuna_api_key"), true, "config.ts was not read");
  assert.equal(source.includes("cuna_sk"), false, "the canonical prefix is spelled in config.ts");
  for (const brand of WIRE_BRANDS) {
    assert.equal(
      source.includes(`${brand}_sk`),
      false,
      `${brand} spells a secret-key prefix in config.ts`,
    );
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
