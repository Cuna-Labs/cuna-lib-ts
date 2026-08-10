import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import type {
  Acknowledgement, Capability, CapabilityAvailability,
  CapabilityInteraction, CapabilityMutationClass, CapabilitySnapshot,
  CapabilitySurface, ExecResult, Me, OpenSessionResult, Record, SessionAgent,
  SessionSnapshot, SessionStatus
} from "./types.js";
import type {
  AgentSession,
  AgentSessionAuth,
  AgentSessionAuthEvidenceClass,
  AgentSessionAuthMode,
  AgentSessionDesiredState,
  AgentSessionPage,
  AgentSessionProcessState,
  AgentSessionRequestState,
  TerminalConnectionCapability,
  TerminalConnectionCapabilityAvailability,
  TerminalConnectionCapabilityName,
  TerminalConnectionGrant,
  TerminalConnectionProtocol,
} from "./agent-sessions.js";
import type { Problem, ProblemAction } from "./errors.js";
import type { MachineCreateRequest } from "./machine-creates.js";
import type { WorkspaceBinding } from "./workspace-bindings.js";
import {
  brandedCredentialPattern,
  brandedProtocols,
  brandedZonePattern,
} from "./internal/wire-namespaces.js";
import type { BrandedProtocol, Covers } from "./internal/wire-namespaces.js";
import type {
  WorkspaceSyncCapability,
  WorkspaceSyncChangeItem,
  WorkspaceSyncChangePage,
  WorkspaceSyncChunkReceipt,
  WorkspaceSyncChunkContent,
  WorkspaceSyncCommitReceipt,
  WorkspaceSyncEnvelope,
  WorkspaceSyncManifestEntry,
  WorkspaceSyncManifestReceipt,
  WorkspaceSyncProblem,
  WorkspaceSyncReconcileReceipt,
  WorkspaceSyncSession,
} from "./workspace-sync.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RUNTIME_URL = brandedZonePattern();
const OPEN_URL = brandedZonePattern("/__runa/auth\\?t=[^&#]+");
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const STATUSES = new Set<SessionStatus>(["creating", "running", "paused", "suspended", "stopped", "deleted", "error"]);
const AGENTS = new Set<SessionAgent>(["claude-code", "codex", "openclaw"]);
const CAPABILITY_AVAILABILITIES = new Set<CapabilityAvailability>([
  "supported", "unsupported", "temporarily_unavailable", "unknown",
]);
const CAPABILITY_SURFACES = new Set<CapabilitySurface>(["cli", "web", "sdk"]);
const CAPABILITY_INTERACTIONS = new Set<CapabilityInteraction>([
  "native", "read_only", "browser_handoff",
]);
const CAPABILITY_MUTATION_CLASSES = new Set<CapabilityMutationClass>([
  "none", "reversible", "destructive", "secret_revealing", "financial",
]);
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const PERMISSION = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/;
const REASON_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const ETAG = /^[0-9a-f]{64}$/;
const AGENT_SESSION_AUTH_MODES = new Set<AgentSessionAuthMode>([
  "interactive_login", "credential_binding",
]);
const AGENT_SESSION_AUTH_EVIDENCE = new Set<AgentSessionAuthEvidenceClass>([
  "provider_cli_login_status", "credential_binding_authority", "insufficient",
]);
const AGENT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const AGENT_AUTH_ADAPTERS: ReadonlySet<AgentSessionAuth["adapterVersion"]> =
  brandedProtocols("agent-auth.v1");
type _AgentAuthAdapterCoverage =
  Covers<AgentSessionAuth["adapterVersion"], BrandedProtocol<"agent-auth.v1">>;
const MAX_AGENT_AUTH_TTL_MS = 30_000;
const MAX_AGENT_AUTH_FUTURE_SKEW_MS = 5_000;
const AGENT_SESSION_DESIRED_STATES = new Set<AgentSessionDesiredState>([
  "running", "terminated",
]);
const AGENT_SESSION_REQUEST_STATES = new Set<AgentSessionRequestState>([
  "launch_pending", "runtime_claimed", "launched", "termination_pending", "terminal", "failed",
]);
const AGENT_SESSION_PROCESS_STATES = new Set<AgentSessionProcessState>([
  "unknown", "starting", "ready", "running", "exited", "failed", "terminating", "terminated",
]);
const AGENT_SESSION_CWD = /^\/workspace(?:\/.*)?$/u;
const TERMINAL_CONNECTION_URL = /^wss:\/\/api\.(?:getcuna\.com|runacode\.io)\/v1\/terminal-connections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/stream$/u;
const TERMINAL_CONNECTION_TOKEN = brandedCredentialPattern("tc", "[A-Za-z0-9_-]{43}");
const TERMINAL_PROTOCOLS: ReadonlySet<TerminalConnectionProtocol> =
  brandedProtocols("terminal.v1");
type _TerminalProtocolCoverage =
  Covers<TerminalConnectionProtocol, BrandedProtocol<"terminal.v1">>;
const TERMINAL_CAPABILITY_NAMES = new Set<TerminalConnectionCapabilityName>([
  "acknowledgement", "heartbeat", "live_resize", "resume", "signals",
]);
const TERMINAL_CAPABILITY_AVAILABILITIES = new Set<TerminalConnectionCapabilityAvailability>([
  "supported", "unsupported", "unknown",
]);
const PROBLEM_CODE = /^[a-z][a-z0-9_]{2,63}$/u;
const PROBLEM_TYPE = /^https:\/\/api\.(?:getcuna\.com|runacode\.io)\/problems\/[a-z][a-z0-9_]{2,63}$/u;
const PROBLEM_ACTIONS = new Set<ProblemAction>([
  "retry", "sign_in", "open_web", "contact_support", "none",
]);
const MACHINE_CREATE_STATES = new Set<MachineCreateRequest["state"]>([
  "prepared", "in_progress", "unknown", "provider_succeeded", "settled", "terminal_failed",
]);
const MACHINE_CREATE_ACTIONS = new Set<MachineCreateRequest["action"]>([
  "retry_create", "reconcile", "wait", "none",
]);
const WORKSPACE_SYNC_CAPABILITIES = new Set<WorkspaceSyncCapability>([
  "atomic_generation_commit",
  "bounded_manifest_pages",
  "content_digest_verification",
  "explicit_reconciliation",
  "ordered_generation_changes",
  "policy_bound_admission",
]);

export class DecodeFailure {
  readonly kind = "decode_failure";
}
function malformed(): never { throw new DecodeFailure(); }

/** The value substituted for a credential when a result is serialized. */
const REDACTED = "[redacted]";

/** Node's opt-in rendering hook, the one `util.inspect` consults. */
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Freeze a result whose named fields are live capabilities, and attach one
 * non-enumerable redacting hook for every sink that offers one.
 *
 * A plain frozen object hands its secret to `JSON.stringify` verbatim, and
 * `JSON.stringify` is what every structured logger, crash reporter, and
 * outbound request body calls. The type system cannot object: the field is a
 * `string` like any other.
 *
 * Exactly two sinks in the platform accept a hook, and both are installed here:
 *
 * - `toJSON` — `JSON.stringify`, and `util.format("%j")` through it.
 * - `Symbol.for("nodejs.util.inspect.custom")` — `util.inspect`, which is what
 *   `console.log`, `util.format("%o")` and Node's own uncaught-exception
 *   printer call.
 *
 * The serialization boundary is NOT "the only place the guard survives", and
 * believing that sentence is what left `console.log(grant)` printing the token
 * in full for as long as `toJSON` was the sole hook. Every sink that copies the
 * object's own data properties reads the real value and accepts no hook at all:
 * object spread, `Object.entries`, `structuredClone`, `URLSearchParams`,
 * `Object.values().join()`. Three of those hand the plain copy straight back to
 * `JSON.stringify`, the very sink this guard claims to own — the copy has no
 * `toJSON`, so the secret is emitted. There is no hook that closes them; each
 * needs its own guard where the copy is made. The list of hooks above is a
 * floor and may only ever GROW.
 *
 * Both hooks are non-enumerable, so the object's own key set, spreads, and
 * `deepStrictEqual` comparisons are unchanged, and the caller still reads the
 * real value off the property.
 */
function redactOnSerialize<T extends object>(
  value: T,
  secretKeys: readonly (keyof T & string)[],
): T {
  function redacted(this: T): globalThis.Record<string, unknown> {
    const safe: globalThis.Record<string, unknown> = Object.fromEntries(
      Object.entries(this),
    );
    for (const key of secretKeys) {
      if (Object.hasOwn(safe, key)) safe[key] = REDACTED;
    }
    return safe;
  }
  for (const hook of [INSPECT_CUSTOM, "toJSON"] as const) {
    Object.defineProperty(value, hook, {
      value: redacted,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(value);
}

function object(value: unknown): globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) malformed();
  return value as globalThis.Record<string, unknown>;
}
function exact(source: globalThis.Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(source, key)) || Object.keys(source).some((key) => !allowed.has(key))) malformed();
}
function string(value: unknown): string {
  if (typeof value !== "string") malformed();
  return value;
}
function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum) malformed();
  return value as number;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) malformed();
  return value;
}
function uuid(value: unknown): string {
  const result = string(value);
  if (!UUID.test(result)) malformed();
  return result;
}
function dateTime(value: unknown): string {
  const result = string(value);
  const match = RFC3339.exec(result);
  if (match === null) malformed();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const days = month === 2
    ? ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 ||
      minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
      Number.isNaN(Date.parse(result))) malformed();
  return result;
}
export function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError("Invalid session ID.");
}

export function decodeSession(value: unknown): SessionSnapshot {
  const source = object(value);
  exact(source, ["id", "user_id", "slug", "name", "vcpus", "memory_mib", "status", "running_seconds", "created_at", "updated_at", "url"], ["agent"]);
  const slug = string(source.slug);
  const status = string(source.status);
  const url = string(source.url);
  if (!SLUG.test(slug) || !STATUSES.has(status as SessionStatus) || !RUNTIME_URL.test(url)) malformed();
  let agent: SessionAgent | undefined;
  if (Object.hasOwn(source, "agent")) {
    if (typeof source.agent !== "string" || !AGENTS.has(source.agent as SessionAgent)) malformed();
    agent = source.agent as SessionAgent;
  }
  return Object.freeze({
    id: uuid(source.id), userId: uuid(source.user_id), slug, name: string(source.name),
    ...(agent === undefined ? {} : { agent }),
    vcpus: integer(source.vcpus, 0), memoryMiB: integer(source.memory_mib, 0),
    status: status as SessionStatus, runningSeconds: integer(source.running_seconds, 0),
    createdAt: dateTime(source.created_at), updatedAt: dateTime(source.updated_at), url
  });
}
export function decodeSessions(value: unknown): readonly SessionSnapshot[] {
  if (!Array.isArray(value)) malformed();
  return Object.freeze(value.map(decodeSession));
}

export function decodeAgentSessionAuth(
  value: unknown,
  nowMs = Date.now(),
): AgentSessionAuth {
  const source = object(value);
  exact(source, [
    "observation_id", "agent_session_id", "process_epoch", "auth_mode",
    "agent_version", "adapter_version", "evidence_class", "observed_at",
    "valid_until", "state",
  ]);
  const observationId = uuid(source.observation_id);
  const agentSessionId = uuid(source.agent_session_id);
  const processEpoch = source.process_epoch === null ? null : uuid(source.process_epoch);
  const authMode = enumValue(source.auth_mode, AGENT_SESSION_AUTH_MODES);
  const agentVersion = string(source.agent_version);
  const adapterVersion = string(source.adapter_version);
  const evidenceClass = enumValue(source.evidence_class, AGENT_SESSION_AUTH_EVIDENCE);
  const observedAt = dateTime(source.observed_at);
  const validUntil = dateTime(source.valid_until);
  const state = string(source.state);
  const observedMs = Date.parse(observedAt);
  const validUntilMs = Date.parse(validUntil);
  const unavailable = evidenceClass === "insufficient" && state === "unavailable";
  const interactive = authMode === "interactive_login" &&
    evidenceClass === "provider_cli_login_status" &&
    (state === "login_required" || state === "authenticated");
  const credential = authMode === "credential_binding" &&
    evidenceClass === "credential_binding_authority" && state === "configured";
  if (
    !AGENT_AUTH_ADAPTERS.has(adapterVersion as AgentSessionAuth["adapterVersion"]) ||
    (!unavailable && !interactive && !credential) ||
    (unavailable && validUntilMs !== observedMs) ||
    (!unavailable && (
      processEpoch === null ||
      !AGENT_VERSION.test(agentVersion) ||
      validUntilMs <= observedMs ||
      validUntilMs - observedMs > MAX_AGENT_AUTH_TTL_MS ||
      observedMs > nowMs + MAX_AGENT_AUTH_FUTURE_SKEW_MS ||
      validUntilMs <= nowMs
    ))
  ) malformed();
  return Object.freeze({
    observationId,
    agentSessionId,
    processEpoch,
    authMode,
    agentVersion,
    // The accepted spelling is echoed, not normalized: the service is the
    // authority on which one it minted, and a caller that compares it must see
    // what actually arrived.
    adapterVersion: adapterVersion as AgentSessionAuth["adapterVersion"],
    evidenceClass,
    observedAt,
    validUntil,
    state,
  }) as AgentSessionAuth;
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  const result = string(value);
  const size = [...result].length;
  if (size < minimum || size > maximum) malformed();
  return result;
}

function safeInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) malformed();
  return value as number;
}

export function decodeAgentSession(value: unknown): AgentSession {
  const source = object(value);
  exact(
    source,
    [
      "id", "machine_id", "name", "agent", "cwd", "auth_mode", "desired_state",
      "request_state", "process_state", "row_version", "created_at", "updated_at",
    ],
    [
      "process_epoch",
      "workspace_binding_id",
      "workspace_generation",
      "runtime_observed_at",
      "runtime_expires_at",
      "termination_requested_at",
    ],
  );
  const name = boundedString(source.name, 1, 80);
  const agent = enumValue(source.agent, AGENTS);
  const cwd = boundedString(source.cwd, 10, 1_024);
  if (!AGENT_SESSION_CWD.test(cwd)) malformed();
  const authMode = enumValue(source.auth_mode, AGENT_SESSION_AUTH_MODES);
  const desiredState = enumValue(source.desired_state, AGENT_SESSION_DESIRED_STATES);
  const requestState = enumValue(source.request_state, AGENT_SESSION_REQUEST_STATES);
  const processState = enumValue(source.process_state, AGENT_SESSION_PROCESS_STATES);
  const processEpoch = Object.hasOwn(source, "process_epoch")
    ? uuid(source.process_epoch)
    : undefined;
  const hasWorkspaceBindingId = Object.hasOwn(source, "workspace_binding_id");
  const hasWorkspaceGeneration = Object.hasOwn(source, "workspace_generation");
  if (hasWorkspaceBindingId !== hasWorkspaceGeneration) malformed();
  const workspaceBindingId = hasWorkspaceBindingId
    ? uuid(source.workspace_binding_id)
    : undefined;
  const workspaceGeneration = hasWorkspaceGeneration
    ? safeInteger(source.workspace_generation, 1)
    : undefined;
  const runtimeObservedAt = Object.hasOwn(source, "runtime_observed_at")
    ? dateTime(source.runtime_observed_at)
    : undefined;
  const runtimeExpiresAt = Object.hasOwn(source, "runtime_expires_at")
    ? dateTime(source.runtime_expires_at)
    : undefined;
  const terminationRequestedAt = Object.hasOwn(source, "termination_requested_at")
    ? dateTime(source.termination_requested_at)
    : undefined;
  return Object.freeze({
    id: uuid(source.id),
    machineId: uuid(source.machine_id),
    ...(workspaceBindingId === undefined ? {} : { workspaceBindingId }),
    ...(workspaceGeneration === undefined ? {} : { workspaceGeneration }),
    name,
    agent,
    cwd,
    authMode,
    desiredState,
    requestState,
    processState,
    ...(processEpoch === undefined ? {} : { processEpoch }),
    ...(runtimeObservedAt === undefined ? {} : { runtimeObservedAt }),
    ...(runtimeExpiresAt === undefined ? {} : { runtimeExpiresAt }),
    ...(terminationRequestedAt === undefined ? {} : { terminationRequestedAt }),
    rowVersion: safeInteger(source.row_version, 0),
    createdAt: dateTime(source.created_at),
    updatedAt: dateTime(source.updated_at),
  });
}

export function decodeAgentSessionPage(value: unknown): AgentSessionPage {
  const source = object(value);
  exact(source, ["items"], ["next_cursor"]);
  if (!Array.isArray(source.items) || source.items.length > 100) malformed();
  const nextCursor = Object.hasOwn(source, "next_cursor")
    ? boundedString(source.next_cursor, 1, 512)
    : undefined;
  return Object.freeze({
    items: Object.freeze(source.items.map(decodeAgentSession)),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}

function sha256(value: unknown): string {
  const result = string(value);
  if (!ETAG.test(result)) malformed();
  return result;
}

function syncProtocol(value: unknown): 1 | 2 {
  const result = safeInteger(value, 1);
  if (result !== 1 && result !== 2) malformed();
  return result;
}

function syncCapabilities(value: unknown): readonly WorkspaceSyncCapability[] {
  if (!Array.isArray(value) || value.length !== WORKSPACE_SYNC_CAPABILITIES.size) malformed();
  const capabilities = value.map((item) => enumValue(item, WORKSPACE_SYNC_CAPABILITIES));
  if (new Set(capabilities).size !== WORKSPACE_SYNC_CAPABILITIES.size ||
      [...WORKSPACE_SYNC_CAPABILITIES].some((item) => !capabilities.includes(item))) malformed();
  return Object.freeze(capabilities);
}

function syncManifestEntry(value: unknown): WorkspaceSyncManifestEntry {
  const source = object(value);
  exact(source, ["path", "kind", "byte_length", "executable", "chunks", "link_target"]);
  const path = boundedString(source.path, 1, 4096);
  const kind = enumValue(source.kind, new Set(["directory", "file", "symlink"] as const));
  if (typeof source.executable !== "boolean" || !Array.isArray(source.chunks) ||
      source.chunks.length > 4096 ||
      (source.link_target !== null && typeof source.link_target !== "string")) malformed();
  const linkTarget = source.link_target === null
    ? null
    : boundedString(source.link_target, 0, 4096);
  const chunks = source.chunks.map((value) => {
    const chunk = object(value);
    exact(chunk, ["digest", "byte_length"]);
    const byteLength = safeInteger(chunk.byte_length, 0);
    if (byteLength > 8_388_608) malformed();
    return Object.freeze({ digest: sha256(chunk.digest), byteLength });
  });
  return Object.freeze({
    path,
    kind,
    byteLength: safeInteger(source.byte_length, 0),
    executable: source.executable,
    chunks: Object.freeze(chunks),
    linkTarget,
  });
}

function syncSession(value: unknown): WorkspaceSyncSession {
  const source = object(value);
  exact(source, [
    "id", "workspace_id", "machine_id", "base_generation", "exclusion_policy_digest",
    "selected_protocol", "capabilities", "state", "manifest_entry_count",
    "manifest_encoded_bytes", "content_bytes", "expires_at", "created_at", "updated_at",
  ], ["last_page_index", "committed_generation", "committed_manifest_root"]);
  const selectedProtocol = syncProtocol(source.selected_protocol);
  const capabilities = syncCapabilities(source.capabilities);
  const lastPageIndex = Object.hasOwn(source, "last_page_index")
    ? safeInteger(source.last_page_index, 0)
    : undefined;
  const committedGeneration = Object.hasOwn(source, "committed_generation")
    ? safeInteger(source.committed_generation, 1)
    : undefined;
  const committedManifestRoot = Object.hasOwn(source, "committed_manifest_root")
    ? sha256(source.committed_manifest_root)
    : undefined;
  return Object.freeze({
    id: uuid(source.id),
    workspaceId: uuid(source.workspace_id),
    machineId: uuid(source.machine_id),
    baseGeneration: safeInteger(source.base_generation, 0),
    exclusionPolicyDigest: sha256(source.exclusion_policy_digest),
    selectedProtocol,
    capabilities,
    state: enumValue(source.state, new Set(["staging", "committed", "conflicted", "expired"] as const)),
    manifestEntryCount: safeInteger(source.manifest_entry_count, 0),
    manifestEncodedBytes: safeInteger(source.manifest_encoded_bytes, 0),
    contentBytes: safeInteger(source.content_bytes, 0),
    ...(lastPageIndex === undefined ? {} : { lastPageIndex }),
    ...(committedGeneration === undefined ? {} : { committedGeneration }),
    ...(committedManifestRoot === undefined ? {} : { committedManifestRoot }),
    expiresAt: dateTime(source.expires_at),
    createdAt: dateTime(source.created_at),
    updatedAt: dateTime(source.updated_at),
  });
}

function syncManifestReceipt(value: unknown): WorkspaceSyncManifestReceipt {
  const source = object(value);
  exact(source, ["sync", "page_index", "page_digest", "missing_digests"]);
  if (!Array.isArray(source.missing_digests)) malformed();
  return Object.freeze({
    sync: syncSession(source.sync),
    pageIndex: safeInteger(source.page_index, 0),
    pageDigest: sha256(source.page_digest),
    missingDigests: Object.freeze(source.missing_digests.map(sha256)),
  });
}

function syncChunkReceipt(value: unknown): WorkspaceSyncChunkReceipt {
  const source = object(value);
  exact(source, ["selected_protocol", "digest", "byte_length", "stored"]);
  const byteLength = safeInteger(source.byte_length, 0);
  if (byteLength > 8_388_608 || typeof source.stored !== "boolean") malformed();
  return Object.freeze({
    selectedProtocol: syncProtocol(source.selected_protocol),
    digest: sha256(source.digest),
    byteLength,
    stored: source.stored,
  });
}

function syncChunkContent(value: unknown): WorkspaceSyncChunkContent {
  const source = object(value);
  exact(source, [
    "selected_protocol", "digest", "byte_length", "minimum_reader", "content_base64",
  ]);
  const selectedProtocol = syncProtocol(source.selected_protocol);
  const expectedDigest = sha256(source.digest);
  const byteLength = safeInteger(source.byte_length, 0);
  const minimumReader = safeInteger(source.minimum_reader, 1);
  if (byteLength > 8_388_608 || minimumReader > 2 || minimumReader > selectedProtocol ||
      typeof source.content_base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
        .test(source.content_base64)) malformed();
  const decoded = Buffer.from(source.content_base64, "base64");
  if (decoded.byteLength !== byteLength ||
      decoded.toString("base64") !== source.content_base64 ||
      createHash("sha256").update(decoded).digest("hex") !== expectedDigest) malformed();
  return Object.freeze({
    selectedProtocol,
    digest: expectedDigest,
    byteLength,
    minimumReader,
    bytes: new Uint8Array(decoded),
  });
}

function syncCommitReceipt(value: unknown): WorkspaceSyncCommitReceipt {
  const source = object(value);
  exact(source, [
    "selected_protocol", "state", "generation", "manifest_root", "committed_at",
    "minimum_reader", "minimum_writer",
  ]);
  if (source.state !== "committed") malformed();
  return Object.freeze({
    selectedProtocol: syncProtocol(source.selected_protocol),
    state: "committed",
    generation: safeInteger(source.generation, 1),
    manifestRoot: sha256(source.manifest_root),
    committedAt: dateTime(source.committed_at),
    minimumReader: safeInteger(source.minimum_reader, 1),
    minimumWriter: safeInteger(source.minimum_writer, 1),
  });
}

function syncChangeItem(value: unknown): WorkspaceSyncChangeItem {
  const source = object(value);
  exact(source, [
    "generation", "operation", "path", "entry", "manifest_root",
    "exclusion_policy_digest", "committed_at", "minimum_reader", "minimum_writer",
  ]);
  const operation = enumValue(source.operation, new Set(["revision", "upsert", "delete"] as const));
  const path = source.path === null ? null : boundedString(source.path, 0, 4096);
  const entry = source.entry === null ? null : syncManifestEntry(source.entry);
  if ((operation === "revision" && (path !== null || entry !== null)) ||
      (operation === "delete" && (path === null || entry !== null)) ||
      (operation === "upsert" && (path === null || entry === null))) malformed();
  return Object.freeze({
    generation: safeInteger(source.generation, 1),
    operation,
    path,
    entry,
    manifestRoot: sha256(source.manifest_root),
    exclusionPolicyDigest: sha256(source.exclusion_policy_digest),
    committedAt: dateTime(source.committed_at),
    minimumReader: safeInteger(source.minimum_reader, 1),
    minimumWriter: safeInteger(source.minimum_writer, 1),
  });
}

function syncChangePage(value: unknown): WorkspaceSyncChangePage {
  const source = object(value);
  exact(source, ["selected_protocol", "items", "next_cursor"]);
  if (!Array.isArray(source.items) || source.items.length > 1000 ||
      (source.next_cursor !== null && typeof source.next_cursor !== "string")) malformed();
  const nextCursor = source.next_cursor === null
    ? null
    : boundedString(source.next_cursor, 0, 1024);
  const items = source.items.map(syncChangeItem);
  if (items.some((item, index) => index > 0 &&
      item.generation < items[index - 1]!.generation)) malformed();
  return Object.freeze({
    selectedProtocol: syncProtocol(source.selected_protocol),
    items: Object.freeze(items),
    nextCursor,
  });
}

function syncReconcileReceipt(value: unknown): WorkspaceSyncReconcileReceipt {
  const source = object(value);
  exact(source, [
    "selected_protocol", "status", "active_generation", "active_manifest_root",
    "exclusion_policy_digest",
  ]);
  return Object.freeze({
    selectedProtocol: syncProtocol(source.selected_protocol),
    status: enumValue(source.status, new Set(["converged", "reconciliation_required"] as const)),
    activeGeneration: safeInteger(source.active_generation, 0),
    activeManifestRoot: sha256(source.active_manifest_root),
    exclusionPolicyDigest: sha256(source.exclusion_policy_digest),
  });
}

type WorkspaceSyncOperation =
  | "workspaces.sync.begin"
  | "workspaces.sync.negotiate"
  | "workspaces.sync.chunk"
  | "workspaces.sync.chunkDownload"
  | "workspaces.sync.commit"
  | "workspaces.sync.changes"
  | "workspaces.sync.reconcile";

/** Decode one operation-specific closed workspace-sync envelope. */
export function decodeWorkspaceSyncEnvelope(
  operation: WorkspaceSyncOperation,
  value: unknown,
): WorkspaceSyncEnvelope<unknown> {
  const source = object(value);
  exact(source, ["request_id", "selected_protocol", "capabilities", "data"]);
  const selectedProtocol = syncProtocol(source.selected_protocol);
  const capabilities = syncCapabilities(source.capabilities);
  const data = operation === "workspaces.sync.begin"
    ? syncSession(source.data)
    : operation === "workspaces.sync.negotiate"
      ? syncManifestReceipt(source.data)
      : operation === "workspaces.sync.chunk"
        ? syncChunkReceipt(source.data)
        : operation === "workspaces.sync.chunkDownload"
          ? syncChunkContent(source.data)
        : operation === "workspaces.sync.commit"
          ? syncCommitReceipt(source.data)
          : operation === "workspaces.sync.changes"
            ? syncChangePage(source.data)
            : syncReconcileReceipt(source.data);
  const nestedProtocol = "selectedProtocol" in data ? data.selectedProtocol
    : "sync" in data ? data.sync.selectedProtocol : undefined;
  if (nestedProtocol !== undefined && nestedProtocol !== selectedProtocol) malformed();
  if ("capabilities" in data &&
      (data.capabilities.length !== capabilities.length ||
        data.capabilities.some((capability, index) => capability !== capabilities[index]))) malformed();
  return Object.freeze({
    requestId: uuid(source.request_id),
    selectedProtocol,
    capabilities,
    data,
  });
}

/** Decode one exact canonical WorkspaceBinding projection. */
export function decodeWorkspaceBinding(value: unknown): WorkspaceBinding {
  const source = object(value);
  exact(source, [
    "binding_id", "workspace_id", "project_id", "local_instance_id", "machine_id",
    "remote_root", "exclusion_policy_digest", "active_generation", "active_manifest_root",
    "binding_epoch", "minimum_reader", "minimum_writer", "created_at", "updated_at",
  ]);
  const projectId = uuid(source.project_id);
  const remoteRoot = string(source.remote_root);
  if (remoteRoot !== `/workspace/projects/${projectId}`) malformed();
  return Object.freeze({
    bindingId: uuid(source.binding_id),
    workspaceId: uuid(source.workspace_id),
    projectId,
    localInstanceId: uuid(source.local_instance_id),
    machineId: uuid(source.machine_id),
    remoteRoot,
    exclusionPolicyDigest: sha256(source.exclusion_policy_digest),
    activeGeneration: safeInteger(source.active_generation, 0),
    activeManifestRoot: sha256(source.active_manifest_root),
    bindingEpoch: safeInteger(source.binding_epoch, 1),
    minimumReader: safeInteger(source.minimum_reader, 1),
    minimumWriter: safeInteger(source.minimum_writer, 1),
    createdAt: dateTime(source.created_at),
    updatedAt: dateTime(source.updated_at),
  });
}

/** Decode one closed machine-create recovery observation. */
export function decodeMachineCreateRequest(value: unknown): MachineCreateRequest {
  const source = object(value);
  exact(source, ["id", "machine_id", "state", "retryable", "action", "updated_at"]);
  if (typeof source.retryable !== "boolean") malformed();
  return Object.freeze({
    id: uuid(source.id),
    machineId: uuid(source.machine_id),
    state: enumValue(source.state, MACHINE_CREATE_STATES),
    retryable: source.retryable,
    action: enumValue(source.action, MACHINE_CREATE_ACTIONS),
    updatedAt: dateTime(source.updated_at),
  });
}

export function decodeTerminalConnectionGrant(value: unknown): TerminalConnectionGrant {
  const source = object(value);
  exact(source, [
    "terminal_session_id", "resume_handle", "connect_url", "connect_token",
    "protocol", "capabilities", "expires_at",
  ]);
  const terminalSessionId = uuid(source.terminal_session_id);
  const connectUrl = string(source.connect_url);
  const connectToken = string(source.connect_token);
  const expectedConnectUrls = new Set([
    `wss://api.getcuna.com/v1/terminal-connections/${terminalSessionId}/stream`,
    `wss://api.runacode.io/v1/terminal-connections/${terminalSessionId}/stream`,
  ]);
  const protocol = enumValue(source.protocol, TERMINAL_PROTOCOLS);
  if (!TERMINAL_CONNECTION_URL.test(connectUrl) || !expectedConnectUrls.has(connectUrl) ||
      !TERMINAL_CONNECTION_TOKEN.test(connectToken) ||
      connectUrl.includes(connectToken) ||
      !Array.isArray(source.capabilities) || source.capabilities.length !== 5) malformed();
  const capabilities = source.capabilities.map((item): TerminalConnectionCapability => {
    const capability = object(item);
    exact(capability, ["name", "availability"]);
    return Object.freeze({
      name: enumValue(capability.name, TERMINAL_CAPABILITY_NAMES),
      availability: enumValue(
        capability.availability,
        TERMINAL_CAPABILITY_AVAILABILITIES,
      ),
    });
  });
  const names = capabilities.map((capability) => capability.name);
  if (new Set(names).size !== TERMINAL_CAPABILITY_NAMES.size ||
      [...TERMINAL_CAPABILITY_NAMES].some((name) => !names.includes(name))) malformed();
  // `connectUrl` is the non-secret half and is checked above never to contain
  // the token; `connectToken` is the one-use credential and must not be the
  // default output of `JSON.stringify`.
  return redactOnSerialize({
    terminalSessionId,
    resumeHandle: uuid(source.resume_handle),
    connectUrl,
    connectToken,
    protocol,
    capabilities: Object.freeze(capabilities),
    expiresAt: dateTime(source.expires_at),
  }, ["connectToken"]);
}

export function decodeProblem(value: unknown, expectedStatus: number): Problem {
  const source = object(value);
  exact(
    source,
    ["type", "title", "status", "code", "request_id", "retryable"],
    ["detail", "action"],
  );
  const type = string(source.type);
  const title = boundedString(source.title, 1, 120);
  const status = safeInteger(source.status, 400);
  const code = string(source.code);
  if (status > 599 || status !== expectedStatus || !PROBLEM_CODE.test(code) ||
      !PROBLEM_TYPE.test(type) || typeof source.retryable !== "boolean") malformed();
  const detail = Object.hasOwn(source, "detail")
    ? boundedString(source.detail, 0, 500)
    : undefined;
  const action = Object.hasOwn(source, "action")
    ? enumValue(source.action, PROBLEM_ACTIONS)
    : undefined;
  return Object.freeze({
    type,
    title,
    status,
    code,
    requestId: uuid(source.request_id),
    retryable: source.retryable,
    ...(detail === undefined ? {} : { detail }),
    ...(action === undefined ? {} : { action }),
  });
}

export function decodeWorkspaceSyncProblem(
  value: unknown,
  expectedStatus: number,
): WorkspaceSyncProblem {
  const source = object(value);
  exact(source, [
    "type", "title", "status", "code", "request_id", "retryable", "action",
    "selected_protocol", "capabilities", "detail",
  ]);
  const status = safeInteger(source.status, 400);
  const code = string(source.code);
  const type = string(source.type);
  if (status > 599 || status !== expectedStatus ||
      !/^workspace_sync_[a-z0-9_]{2,48}$/u.test(code) ||
      (type !== `https://api.getcuna.com/problems/${code}` &&
        type !== `https://api.runacode.io/problems/${code}`) ||
      typeof source.retryable !== "boolean" ||
      (source.action !== "retry" && source.action !== "none") ||
      (source.selected_protocol !== null &&
        source.selected_protocol !== 1 && source.selected_protocol !== 2)) malformed();
  const capabilities = source.selected_protocol === null
    ? (() => {
        if (!Array.isArray(source.capabilities) || source.capabilities.length !== 0) malformed();
        return Object.freeze([]) as readonly WorkspaceSyncCapability[];
      })()
    : syncCapabilities(source.capabilities);
  return Object.freeze({
    type,
    title: boundedString(source.title, 1, 120),
    status,
    code: code as `workspace_sync_${string}`,
    requestId: uuid(source.request_id),
    retryable: source.retryable,
    action: source.action,
    selectedProtocol: source.selected_protocol,
    capabilities,
    detail: boundedString(source.detail, 1, 500),
  });
}
export function decodeExec(value: unknown): ExecResult {
  const source = object(value);
  exact(source, ["exit_code", "stdout", "stderr", "duration_ms", "stdout_truncated", "stderr_truncated"]);
  if (typeof source.stdout_truncated !== "boolean" || typeof source.stderr_truncated !== "boolean") malformed();
  return Object.freeze({
    exitCode: integer(source.exit_code), stdout: string(source.stdout), stderr: string(source.stderr),
    durationMs: integer(source.duration_ms, 0), stdoutTruncated: source.stdout_truncated,
    stderrTruncated: source.stderr_truncated
  });
}
export function decodeAcknowledgement(value: unknown): Acknowledgement {
  const source = object(value);
  exact(source, ["ok"]);
  if (source.ok !== true) malformed();
  return Object.freeze({ ok: true });
}
export function decodeOpen(value: unknown): OpenSessionResult {
  const source = object(value);
  exact(source, ["url"]);
  const url = string(source.url);
  if (!OPEN_URL.test(url)) malformed();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "" ||
        parsed.hash !== "" || parsed.pathname !== "/__runa/auth" || [...parsed.searchParams.keys()].length !== 1 ||
        parsed.searchParams.get("t") === null || parsed.searchParams.get("t") === "") malformed();
  } catch (error) {
    if (error instanceof DecodeFailure) throw error;
    malformed();
  }
  // The `t` query member IS the capability: this URL opens the session for
  // whoever holds it. Its own doc comment says never log or persist it, so it
  // must not be the default output of `JSON.stringify`.
  return redactOnSerialize({ url }, ["url"]);
}
function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  const candidate = string(value);
  if (!allowed.has(candidate as T)) malformed();
  return candidate as T;
}
function uniqueStrings(
  value: unknown,
  maximum: number,
  pattern: RegExp,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) malformed();
  const items = value.map((item) => string(item));
  if (items.some((item) => !pattern.test(item)) || new Set(items).size !== items.length) malformed();
  return Object.freeze(items);
}
function decodeCapability(value: unknown): Capability {
  const source = object(value);
  exact(
    source,
    ["id", "availability", "surfaces", "interaction", "mutation_class", "required_permissions"],
    ["reason_code"],
  );
  const id = string(source.id);
  if (!CAPABILITY_ID.test(id) || !Array.isArray(source.surfaces) ||
      source.surfaces.length < 1 || source.surfaces.length > 3) malformed();
  const surfaces = source.surfaces.map((surface) =>
    enumValue(surface, CAPABILITY_SURFACES));
  if (new Set(surfaces).size !== surfaces.length) malformed();
  let reasonCode: string | undefined;
  if (Object.hasOwn(source, "reason_code")) {
    reasonCode = string(source.reason_code);
    if (!REASON_CODE.test(reasonCode)) malformed();
  }
  return Object.freeze({
    id,
    availability: enumValue(source.availability, CAPABILITY_AVAILABILITIES),
    surfaces: Object.freeze(surfaces),
    interaction: enumValue(source.interaction, CAPABILITY_INTERACTIONS),
    mutationClass: enumValue(source.mutation_class, CAPABILITY_MUTATION_CLASSES),
    requiredPermissions: uniqueStrings(source.required_permissions, 16, PERMISSION),
    ...(reasonCode === undefined ? {} : { reasonCode }),
  });
}
export function decodeCapabilitySnapshot(value: unknown): CapabilitySnapshot {
  const source = object(value);
  exact(
    source,
    ["schema_version", "subject_scope", "observed_at", "expires_at", "etag", "capabilities"],
    ["subject_id"],
  );
  if (source.schema_version !== "1.0") malformed();
  const subjectScope = string(source.subject_scope);
  if (subjectScope !== "account" && subjectScope !== "machine" &&
      subjectScope !== "agent_session") malformed();
  const observedAt = dateTime(source.observed_at);
  const expiresAt = dateTime(source.expires_at);
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) malformed();
  const etag = string(source.etag);
  if (!ETAG.test(etag) || !Array.isArray(source.capabilities) ||
      source.capabilities.length > 128) malformed();
  let subjectId: string | undefined;
  if (Object.hasOwn(source, "subject_id")) subjectId = uuid(source.subject_id);
  return Object.freeze({
    schemaVersion: "1.0",
    subjectScope,
    ...(subjectId === undefined ? {} : { subjectId }),
    observedAt,
    expiresAt,
    etag,
    capabilities: Object.freeze(source.capabilities.map(decodeCapability)),
  });
}
export function decodeRecords(value: unknown): readonly Record[] {
  if (!Array.isArray(value)) malformed();
  return Object.freeze(value.map((item) => {
    const source = object(item);
    exact(source, ["id", "session_id", "kind", "summary", "detail", "created_at"]);
    return Object.freeze({
      id: uuid(source.id), sessionId: uuid(source.session_id), kind: string(source.kind),
      summary: string(source.summary), detail: source.detail, createdAt: dateTime(source.created_at)
    });
  }));
}
export function decodeMe(value: unknown): Me {
  const source = object(value);
  exact(source, ["id", "email", "workspace"]);
  const id = uuid(source.id);
  const email = string(source.email);
  const workspace = object(source.workspace);
  if (workspace.assigned === true) {
    exact(workspace, ["assigned", "id", "usage"]);
    const usage = object(workspace.usage);
    if (["est_spend_usd", "est_remaining_usd", "note"].some((key) => !Object.hasOwn(usage, key))) malformed();
    return Object.freeze({
      id, email, workspace: Object.freeze({
        assigned: true as const,
        id: uuid(workspace.id),
        usage: Object.freeze({
          estimatedSpendUsd: number(usage.est_spend_usd),
          estimatedRemainingUsd: number(usage.est_remaining_usd),
          note: string(usage.note)
        })
      })
    });
  }
  if (workspace.assigned === false) {
    exact(workspace, ["assigned", "waitlist_position"]);
    return Object.freeze({
      id, email, workspace: Object.freeze({
        assigned: false as const,
        waitlistPosition: integer(workspace.waitlist_position, 0)
      })
    });
  }
  malformed();
}
