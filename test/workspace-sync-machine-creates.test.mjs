import assert from "node:assert/strict";
import { test } from "vitest";

import { ApiError, Cuna } from "../dist/index.js";
import { API_KEY, jsonResponse } from "./helpers.mjs";

const WORKSPACE_ID = "77777777-7777-4777-8777-777777777777";
const BINDING_ID = "88888888-8888-4888-8888-888888888888";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const LOCAL_INSTANCE_ID = "55555555-5555-4555-8555-555555555555";
const MACHINE_ID = "11111111-1111-4111-8111-111111111111";
const SYNC_ID = "99999999-9999-4999-8999-999999999999";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POLICY_DIGEST = "a".repeat(64);
const MANIFEST_ROOT = "b".repeat(64);
const CHUNK_DIGEST = "c".repeat(64);
const DOWNLOAD_BYTES = new Uint8Array([1, 2, 3]);
const DOWNLOAD_DIGEST = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const PAGE_DIGEST = "d".repeat(64);
const CAPABILITIES = [
  "atomic_generation_commit",
  "bounded_manifest_pages",
  "content_digest_verification",
  "explicit_reconciliation",
  "ordered_generation_changes",
  "policy_bound_admission",
];

function binding(overrides = {}) {
  return {
    binding_id: BINDING_ID,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    local_instance_id: LOCAL_INSTANCE_ID,
    machine_id: MACHINE_ID,
    remote_root: `/workspace/projects/${PROJECT_ID}`,
    exclusion_policy_digest: POLICY_DIGEST,
    active_generation: 4,
    active_manifest_root: MANIFEST_ROOT,
    binding_epoch: 1,
    minimum_reader: 1,
    minimum_writer: 2,
    created_at: "2026-08-09T12:00:00Z",
    updated_at: "2026-08-09T12:01:00+00:00",
    ...overrides,
  };
}

function syncSession(overrides = {}) {
  return {
    id: SYNC_ID,
    workspace_id: WORKSPACE_ID,
    machine_id: MACHINE_ID,
    base_generation: 4,
    exclusion_policy_digest: POLICY_DIGEST,
    selected_protocol: 2,
    capabilities: CAPABILITIES,
    state: "staging",
    manifest_entry_count: 0,
    manifest_encoded_bytes: 0,
    content_bytes: 0,
    expires_at: "2026-08-09T12:15:00Z",
    created_at: "2026-08-09T12:00:00Z",
    updated_at: "2026-08-09T12:00:00Z",
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    path: "src/index.ts",
    kind: "file",
    byte_length: 3,
    executable: false,
    chunks: [{ digest: CHUNK_DIGEST, byte_length: 3 }],
    link_target: null,
    ...overrides,
  };
}

function envelope(data, overrides = {}) {
  return {
    request_id: REQUEST_ID,
    selected_protocol: 2,
    capabilities: CAPABILITIES,
    data,
    ...overrides,
  };
}

function machineCreate(overrides = {}) {
  return {
    id: REQUEST_ID,
    machine_id: MACHINE_ID,
    state: "in_progress",
    retryable: true,
    action: "wait",
    updated_at: "2026-08-09T12:00:00Z",
    ...overrides,
  };
}

function responseFor(url, method = "GET") {
  const pathname = new URL(url).pathname;
  if (pathname === "/v1/workspace-bindings" || pathname.includes(BINDING_ID)) return binding();
  if (pathname.endsWith("/sync-sessions")) return envelope(syncSession());
  if (pathname.endsWith("/manifests")) return envelope({
    sync: syncSession({ last_page_index: 0 }),
    page_index: 0,
    page_digest: PAGE_DIGEST,
    missing_digests: [CHUNK_DIGEST],
  });
  if (pathname.includes("/chunks/")) {
    if (method === "GET") return envelope({
      selected_protocol: 2,
      digest: DOWNLOAD_DIGEST,
      byte_length: DOWNLOAD_BYTES.byteLength,
      minimum_reader: 1,
      content_base64: Buffer.from(DOWNLOAD_BYTES).toString("base64"),
    });
    return envelope({
      selected_protocol: 2,
      digest: CHUNK_DIGEST,
      byte_length: 3,
      stored: true,
    });
  }
  if (pathname.endsWith("/commit")) return envelope({
    selected_protocol: 2,
    state: "committed",
    generation: 5,
    manifest_root: MANIFEST_ROOT,
    committed_at: "2026-08-09T12:02:00Z",
    minimum_reader: 1,
    minimum_writer: 2,
  });
  if (pathname.endsWith("/changes")) return envelope({
    selected_protocol: 2,
    items: [
      {
        generation: 5,
        operation: "revision",
        path: null,
        entry: null,
        manifest_root: MANIFEST_ROOT,
        exclusion_policy_digest: POLICY_DIGEST,
        committed_at: "2026-08-09T12:02:00Z",
        minimum_reader: 1,
        minimum_writer: 2,
      },
      {
        generation: 5,
        operation: "upsert",
        path: "src/index.ts",
        entry: entry(),
        manifest_root: MANIFEST_ROOT,
        exclusion_policy_digest: POLICY_DIGEST,
        committed_at: "2026-08-09T12:02:00Z",
        minimum_reader: 1,
        minimum_writer: 2,
      },
      {
        generation: 5,
        operation: "delete",
        path: "old.ts",
        entry: null,
        manifest_root: MANIFEST_ROOT,
        exclusion_policy_digest: POLICY_DIGEST,
        committed_at: "2026-08-09T12:02:00Z",
        minimum_reader: 1,
        minimum_writer: 2,
      },
    ],
    next_cursor: null,
  });
  if (pathname.endsWith("/reconcile")) {
    return pathname.includes("machine-creates") ? machineCreate() : envelope({
      selected_protocol: 2,
      status: "converged",
      active_generation: 4,
      active_manifest_root: MANIFEST_ROOT,
      exclusion_policy_digest: POLICY_DIGEST,
    });
  }
  if (pathname.includes("machine-creates")) return machineCreate();
  throw new Error(`Unexpected test URL: ${url}`);
}

const identity = {
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  localInstanceId: LOCAL_INSTANCE_ID,
  machineId: MACHINE_ID,
  exclusionPolicyDigest: POLICY_DIGEST,
};

test("OpenAPI 1.7 WorkspaceBinding and sync methods preserve exact public authority", async () => {
  const calls = [];
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(responseFor(String(url), init.method));
    },
  });
  const createdBinding = await runa.workspaceBindings.create({
    ...identity,
    excludedPrefixes: [".git", "node_modules/cache"],
  }, "workspace-binding-create-1");
  const readBinding = await runa.workspaceBindings.get(BINDING_ID, identity);
  const protocol = { minimum: 1, maximum: 2 };
  const begun = await runa.workspaceSync.begin(WORKSPACE_ID, {
    workspaceBindingId: BINDING_ID,
    machineId: MACHINE_ID,
    baseGeneration: 4,
    exclusionPolicyDigest: POLICY_DIGEST,
    protocol,
    minimumReader: 1,
    minimumWriter: 2,
  }, "workspace-begin-1");
  const manifest = await runa.workspaceSync.negotiate(SYNC_ID, {
    pageIndex: 0,
    isLast: true,
    minimumReader: 1,
    minimumWriter: 2,
    entries: [],
  }, "workspace-manifest-1");
  const chunk = await runa.workspaceSync.uploadChunk(
    SYNC_ID, CHUNK_DIGEST, new Uint8Array([1, 2, 3]), "workspace-chunk-1",
  );
  const downloaded = await runa.workspaceSync.downloadChunk(SYNC_ID, DOWNLOAD_DIGEST);
  const committed = await runa.workspaceSync.commit(SYNC_ID, {
    expectedGeneration: 4,
    exclusionPolicyDigest: POLICY_DIGEST,
    manifestRoot: MANIFEST_ROOT,
    minimumReader: 1,
    minimumWriter: 2,
  }, "workspace-commit-1");
  const changes = await runa.workspaceSync.changes(SYNC_ID, {
    readerVersion: 2,
    cursor: "opaque",
    limit: 25,
  });
  const reconciled = await runa.workspaceSync.reconcile(WORKSPACE_ID, {
    workspaceBindingId: BINDING_ID,
    machineId: MACHINE_ID,
    observedGeneration: 4,
    exclusionPolicyDigest: POLICY_DIGEST,
    manifestRoot: MANIFEST_ROOT,
    protocol,
  }, "workspace-reconcile-1");

  assert.equal(createdBinding.bindingId, BINDING_ID);
  assert.equal(createdBinding.remoteRoot, `/workspace/projects/${PROJECT_ID}`);
  assert.equal(readBinding.workspaceId, WORKSPACE_ID);
  assert.equal(begun.data.id, SYNC_ID);
  assert.equal(begun.data.workspaceId, WORKSPACE_ID);
  assert.equal(manifest.data.sync.lastPageIndex, 0);
  assert.deepEqual(manifest.data.missingDigests, [CHUNK_DIGEST]);
  assert.equal(chunk.data.byteLength, 3);
  assert.deepEqual([...downloaded], [...DOWNLOAD_BYTES]);
  assert.equal(committed.data.generation, 5);
  assert.deepEqual(changes.data.items.map((item) => item.operation), ["revision", "upsert", "delete"]);
  assert.equal(changes.data.items[1].entry.chunks[0].digest, CHUNK_DIGEST);
  assert.equal(reconciled.data.status, "converged");
  for (const value of [createdBinding, readBinding, begun, begun.data, manifest.data, changes.data]) {
    assert.equal(Object.isFrozen(value), true);
  }

  assert.deepEqual(JSON.parse(calls[0].init.body), {
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    local_instance_id: LOCAL_INSTANCE_ID,
    machine_id: MACHINE_ID,
    exclusion_policy_digest: POLICY_DIGEST,
    excluded_prefixes: [".git", "node_modules/cache"],
  });
  assert.equal(calls[0].init.headers["Idempotency-Key"], "workspace-binding-create-1");
  assert.equal(calls[1].url,
    `https://api.getcuna.com/v1/workspace-bindings/${BINDING_ID}` +
    `?workspace_id=${WORKSPACE_ID}&project_id=${PROJECT_ID}` +
    `&local_instance_id=${LOCAL_INSTANCE_ID}&machine_id=${MACHINE_ID}` +
    `&exclusion_policy_digest=${POLICY_DIGEST}`);
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    workspace_binding_id: BINDING_ID,
    machine_id: MACHINE_ID,
    base_generation: 4,
    exclusion_policy_digest: POLICY_DIGEST,
    protocol: { minimum: 1, maximum: 2 },
    minimum_reader: 1,
    minimum_writer: 2,
  });
  assert.deepEqual([...new Uint8Array(calls[4].init.body)], [1, 2, 3]);
  assert.equal(calls[4].init.headers["Content-Type"], "application/octet-stream");
  assert.equal(calls[5].url,
    `https://api.getcuna.com/v1/workspace-sync/${SYNC_ID}/chunks/${DOWNLOAD_DIGEST}`);
  assert.equal(calls[7].url,
    `https://api.getcuna.com/v1/workspace-sync/${SYNC_ID}/changes?reader_version=2&cursor=opaque&limit=25`);
  assert.deepEqual(JSON.parse(calls[8].init.body), {
    workspace_binding_id: BINDING_ID,
    machine_id: MACHINE_ID,
    observed_generation: 4,
    exclusion_policy_digest: POLICY_DIGEST,
    manifest_root: MANIFEST_ROOT,
    protocol: { minimum: 1, maximum: 2 },
  });
  await runa.close();
});

test("workspace authority inputs fail closed before I/O", async () => {
  let calls = 0;
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => {
      calls += 1;
      return jsonResponse(binding());
    },
  });
  const validBinding = { ...identity, excludedPrefixes: [".git"] };
  const validBegin = {
    workspaceBindingId: BINDING_ID,
    machineId: MACHINE_ID,
    baseGeneration: 0,
    exclusionPolicyDigest: POLICY_DIGEST,
    protocol: { minimum: 1, maximum: 2 },
    minimumReader: 1,
    minimumWriter: 1,
  };
  const cases = [
    () => runa.workspaceBindings.create({ ...validBinding, excludedPrefixes: ["../secret"] }, "binding-valid-key"),
    () => runa.workspaceBindings.create({ ...validBinding, extra: true }, "binding-valid-key"),
    () => runa.workspaceBindings.create(validBinding, "short"),
    () => runa.workspaceBindings.get(BINDING_ID, { ...identity, projectId: "not-a-uuid" }),
    () => runa.workspaceSync.begin("not-a-uuid", validBegin, "workspace-valid-1"),
    () => runa.workspaceSync.begin(WORKSPACE_ID, { ...validBegin, workspaceBindingId: "not-a-uuid" }, "workspace-valid-1"),
    () => runa.workspaceSync.begin(WORKSPACE_ID, { ...validBegin, protocol: { minimum: 2, maximum: 1 } }, "workspace-valid-1"),
    () => runa.workspaceSync.begin(WORKSPACE_ID, { ...validBegin, extra: true }, "workspace-valid-1"),
    () => runa.workspaceSync.uploadChunk(SYNC_ID, "not-a-digest", new Uint8Array(), "workspace-valid-2"),
    () => runa.workspaceSync.downloadChunk(SYNC_ID, "not-a-digest"),
    () => runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1, cursor: "x".repeat(1025) }),
    () => runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1, limit: 1001 }),
  ];
  for (const invoke of cases) await assert.rejects(invoke, TypeError);
  assert.equal(calls, 0);
  await runa.close();
});

const malformedCases = [
  ["binding unknown field", () => binding({ internal_provider: "hidden" }),
    (runa) => runa.workspaceBindings.get(BINDING_ID, identity)],
  ["binding identity substitution", () => binding({ workspace_id: PROJECT_ID }),
    (runa) => runa.workspaceBindings.get(BINDING_ID, identity)],
  ["begin private namespace substitution", () => envelope(syncSession({ workspace_id: PROJECT_ID })),
    (runa) => runa.workspaceSync.begin(WORKSPACE_ID, {
      workspaceBindingId: BINDING_ID, machineId: MACHINE_ID, baseGeneration: 4,
      exclusionPolicyDigest: POLICY_DIGEST, protocol: { minimum: 1, maximum: 2 },
      minimumReader: 1, minimumWriter: 2,
    }, "workspace-begin-2")],
  ["begin protocol downgrade", () => envelope(syncSession({
    selected_protocol: 1,
  }), { selected_protocol: 1 }),
    (runa) => runa.workspaceSync.begin(WORKSPACE_ID, {
      workspaceBindingId: BINDING_ID, machineId: MACHINE_ID, baseGeneration: 4,
      exclusionPolicyDigest: POLICY_DIGEST, protocol: { minimum: 2, maximum: 2 },
      minimumReader: 1, minimumWriter: 2,
    }, "workspace-begin-3")],
  ["manifest malformed session", () => envelope({
    sync: syncSession({ internal_provider: "hidden" }), page_index: 0,
    page_digest: PAGE_DIGEST, missing_digests: [],
  }), (runa) => runa.workspaceSync.negotiate(SYNC_ID, {
    pageIndex: 0, isLast: true, minimumReader: 1, minimumWriter: 1, entries: [],
  }, "workspace-manifest-2")],
  ["chunk protocol mismatch", () => envelope({
    selected_protocol: 1, digest: CHUNK_DIGEST, byte_length: 3, stored: true,
  }), (runa) => runa.workspaceSync.uploadChunk(
    SYNC_ID, CHUNK_DIGEST, new Uint8Array([1, 2, 3]), "workspace-chunk-2",
  )],
  ["downloaded chunk digest mismatch", () => envelope({
    selected_protocol: 2, digest: CHUNK_DIGEST, byte_length: 3,
    minimum_reader: 1, content_base64: "AQID",
  }), (runa) => runa.workspaceSync.downloadChunk(SYNC_ID, DOWNLOAD_DIGEST)],
  ["downloaded chunk content hash mismatch", () => envelope({
    selected_protocol: 2, digest: DOWNLOAD_DIGEST, byte_length: 3,
    minimum_reader: 1, content_base64: "BAUG",
  }), (runa) => runa.workspaceSync.downloadChunk(SYNC_ID, DOWNLOAD_DIGEST)],
  ["downloaded chunk noncanonical base64", () => envelope({
    selected_protocol: 2, digest: DOWNLOAD_DIGEST, byte_length: 3,
    minimum_reader: 1, content_base64: "AQID=",
  }), (runa) => runa.workspaceSync.downloadChunk(SYNC_ID, DOWNLOAD_DIGEST)],
  ["commit generation substitution", () => envelope({
    selected_protocol: 2, state: "committed", generation: 6,
    manifest_root: MANIFEST_ROOT, committed_at: "2026-08-09T12:02:00Z",
    minimum_reader: 1, minimum_writer: 2,
  }), (runa) => runa.workspaceSync.commit(SYNC_ID, {
    expectedGeneration: 4, exclusionPolicyDigest: POLICY_DIGEST,
    manifestRoot: MANIFEST_ROOT, minimumReader: 1, minimumWriter: 2,
  }, "workspace-commit-2")],
  ["change protocol exceeds reader", () => envelope({
    selected_protocol: 2, items: [], next_cursor: null,
  }), (runa) => runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1 })],
  ["change operation shape mismatch", () => envelope({
    selected_protocol: 2,
    items: [{
      generation: 1, operation: "delete", path: null, entry: null,
      manifest_root: MANIFEST_ROOT, exclusion_policy_digest: POLICY_DIGEST,
      committed_at: "2026-08-09T12:02:00Z", minimum_reader: 1, minimum_writer: 1,
    }],
    next_cursor: null,
  }), (runa) => runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1 })],
];

for (const [name, response, invoke] of malformedCases) {
  test(`OpenAPI 1.7 decoder rejects ${name}`, async () => {
    const runa = new Cuna({ apiKey: API_KEY, fetch: async () => jsonResponse(response()) });
    await assert.rejects(
      invoke(runa),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
    await runa.close();
  });
}

test("WorkspaceBinding and sync Problem responses remain typed and safe", async () => {
  const problem = {
    type: "https://api.runacode.io/problems/workspace_binding_conflict",
    title: "Workspace binding conflict",
    status: 409,
    code: "workspace_binding_conflict",
    request_id: REQUEST_ID,
    retryable: false,
    action: "none",
  };
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(problem, 409, { "content-type": "application/problem+json" }),
  });
  await assert.rejects(
    runa.workspaceBindings.create({ ...identity, excludedPrefixes: [] }, "workspace-binding-conflict"),
    (error) => error instanceof ApiError && error.status === 409 &&
      error.problem?.code === "workspace_binding_conflict" &&
      !Object.hasOwn(error.problem, "internal_provider"),
  );
  await runa.close();
});

test("specialized WorkspaceSyncProblem preserves negotiated public recovery metadata", async () => {
  const problem = {
    type: "https://api.runacode.io/problems/workspace_sync_protocol_mismatch",
    title: "Workspace sync protocol mismatch",
    status: 426,
    code: "workspace_sync_protocol_mismatch",
    request_id: REQUEST_ID,
    retryable: false,
    action: "none",
    selected_protocol: 2,
    capabilities: CAPABILITIES,
    detail: "The requested protocol range is not supported.",
  };
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(problem, 426, { "content-type": "application/problem+json" }),
  });
  await assert.rejects(
    runa.workspaceSync.begin(WORKSPACE_ID, {
      workspaceBindingId: BINDING_ID,
      machineId: MACHINE_ID,
      baseGeneration: 4,
      exclusionPolicyDigest: POLICY_DIGEST,
      protocol: { minimum: 1, maximum: 2 },
      minimumReader: 1,
      minimumWriter: 2,
    }, "workspace-begin-problem"),
    (error) => error instanceof ApiError && error.status === 426 &&
      error.problem?.code === "workspace_sync_protocol_mismatch" &&
      error.problem.selectedProtocol === 2 &&
      error.problem.capabilities.length === 6,
  );
  await runa.close();
});

test("specialized WorkspaceSyncProblem rejects inconsistent protocol capability metadata", async () => {
  const malformed = {
    type: "https://api.runacode.io/problems/workspace_sync_authority_unavailable",
    title: "Workspace sync authority unavailable",
    status: 503,
    code: "workspace_sync_authority_unavailable",
    request_id: REQUEST_ID,
    retryable: true,
    action: "retry",
    selected_protocol: null,
    capabilities: CAPABILITIES,
    detail: "Cuna could not confirm the workspace sync operation.",
  };
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(malformed, 503, { "content-type": "application/problem+json" }),
  });
  await assert.rejects(
    runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1 }),
    (error) => error instanceof ApiError && error.status === 503 && error.problem === undefined,
  );
  await runa.close();
});

test("workspace sync accepts the contract's generic application/json Problem fallback", async () => {
  const problem = {
    type: "https://api.runacode.io/problems/resource_not_found",
    title: "Resource not found",
    status: 404,
    code: "resource_not_found",
    request_id: REQUEST_ID,
    retryable: false,
    action: "none",
  };
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(problem, 404),
  });
  await assert.rejects(
    runa.workspaceSync.changes(SYNC_ID, { readerVersion: 1 }),
    (error) => error instanceof ApiError && error.status === 404 &&
      error.problem?.code === "resource_not_found" &&
      !("selectedProtocol" in error.problem),
  );
  await runa.close();
});

for (const [name, value] of [
  ["unknown member", machineCreate({ internal_provider: "hidden" })],
  ["invalid id", machineCreate({ id: "not-a-uuid" })],
  ["future state", machineCreate({ state: "future" })],
  ["non-boolean retryability", machineCreate({ retryable: 1 })],
  ["future action", machineCreate({ action: "future" })],
  ["invalid timestamp", machineCreate({ updated_at: "not-a-date" })],
]) {
  test(`machine-create recovery rejects ${name}`, async () => {
    const runa = new Cuna({ apiKey: API_KEY, fetch: async () => jsonResponse(value) });
    await assert.rejects(
      runa.machineCreates.get(REQUEST_ID),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
    await runa.close();
  });
}

test("the SDK surface contains no CLI runtime, PTY, watcher, login, companion, or automatic-sync behavior", async () => {
  const runa = new Cuna({ apiKey: API_KEY, fetch: async () => jsonResponse(binding()) });
  for (const forbidden of [
    "tui", "pty", "watchFiles", "login", "companion", "automaticSync", "syncAutomatically",
  ]) assert.equal(forbidden in runa, false);
  await runa.close();
});
