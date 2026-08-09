import type {
  Acknowledgement, AgentAuthenticationMethod, AgentAuthenticationState,
  AgentAuthenticationStatus, Capability, CapabilityAvailability,
  CapabilityInteraction, CapabilityMutationClass, CapabilitySnapshot,
  CapabilitySurface, ExecResult, Me, OpenSessionResult, Record, SessionAgent,
  SessionSnapshot, SessionStatus
} from "./types.js";
import type {
  AgentSession,
  AgentSessionAuthMode,
  AgentSessionDesiredState,
  AgentSessionPage,
  AgentSessionProcessState,
  AgentSessionRequestState,
  TerminalConnectionCapability,
  TerminalConnectionCapabilityAvailability,
  TerminalConnectionCapabilityName,
  TerminalConnectionGrant,
} from "./agent-sessions.js";
import type { Problem, ProblemAction } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RUNTIME_URL = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.runacode\.cloud$/;
const OPEN_URL = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.runacode\.cloud\/__runa\/auth\?t=[^&#]+$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const STATUSES = new Set<SessionStatus>(["creating", "running", "paused", "suspended", "stopped", "deleted", "error"]);
const AGENTS = new Set<SessionAgent>(["claude-code", "codex", "openclaw"]);
const AUTHENTICATION_METHODS = new Set<AgentAuthenticationMethod>([
  "none", "interactive_login", "api_key",
]);
const AUTHENTICATION_STATES = new Set<AgentAuthenticationState>([
  "not_applicable", "installing", "login_required", "authenticated",
  "configured", "unavailable",
]);
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
const TERMINAL_CONNECTION_URL = /^wss:\/\/api\.runacode\.io\/v1\/terminal-connections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/stream$/u;
const TERMINAL_CONNECTION_TOKEN = /^runa_tc_[A-Za-z0-9_-]{43}$/u;
const TERMINAL_CAPABILITY_NAMES = new Set<TerminalConnectionCapabilityName>([
  "acknowledgement", "heartbeat", "live_resize", "resume", "signals",
]);
const TERMINAL_CAPABILITY_AVAILABILITIES = new Set<TerminalConnectionCapabilityAvailability>([
  "supported", "unsupported", "unknown",
]);
const PROBLEM_CODE = /^[a-z][a-z0-9_]{2,63}$/u;
const PROBLEM_TYPE = /^https:\/\/api\.runacode\.io\/problems\/[a-z][a-z0-9_]{2,63}$/u;
const PROBLEM_ACTIONS = new Set<ProblemAction>([
  "retry", "sign_in", "open_web", "contact_support", "none",
]);

export class DecodeFailure {
  readonly kind = "decode_failure";
}
function malformed(): never { throw new DecodeFailure(); }
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
    ["process_epoch", "runtime_observed_at", "termination_requested_at"],
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
  const runtimeObservedAt = Object.hasOwn(source, "runtime_observed_at")
    ? dateTime(source.runtime_observed_at)
    : undefined;
  const terminationRequestedAt = Object.hasOwn(source, "termination_requested_at")
    ? dateTime(source.termination_requested_at)
    : undefined;
  return Object.freeze({
    id: uuid(source.id),
    machineId: uuid(source.machine_id),
    name,
    agent,
    cwd,
    authMode,
    desiredState,
    requestState,
    processState,
    ...(processEpoch === undefined ? {} : { processEpoch }),
    ...(runtimeObservedAt === undefined ? {} : { runtimeObservedAt }),
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

export function decodeTerminalConnectionGrant(value: unknown): TerminalConnectionGrant {
  const source = object(value);
  exact(source, [
    "terminal_session_id", "resume_handle", "connect_url", "connect_token",
    "protocol", "capabilities", "expires_at",
  ]);
  const connectUrl = string(source.connect_url);
  const connectToken = string(source.connect_token);
  if (!TERMINAL_CONNECTION_URL.test(connectUrl) ||
      !TERMINAL_CONNECTION_TOKEN.test(connectToken) ||
      connectUrl.includes(connectToken) || source.protocol !== "runa.terminal.v1" ||
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
  return Object.freeze({
    terminalSessionId: uuid(source.terminal_session_id),
    resumeHandle: uuid(source.resume_handle),
    connectUrl,
    connectToken,
    protocol: "runa.terminal.v1",
    capabilities: Object.freeze(capabilities),
    expiresAt: dateTime(source.expires_at),
  });
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
  return Object.freeze({ url });
}
export function decodeAgentAuthenticationStatus(
  value: unknown,
): AgentAuthenticationStatus {
  const source = object(value);
  exact(source, ["agent", "method", "state"]);
  const method = string(source.method);
  const state = string(source.state);
  if (!AUTHENTICATION_METHODS.has(method as AgentAuthenticationMethod) ||
      !AUTHENTICATION_STATES.has(state as AgentAuthenticationState)) malformed();
  const validPair = method === "none"
    ? state === "not_applicable"
    : method === "interactive_login"
      ? ["installing", "login_required", "authenticated", "unavailable"].includes(state)
      : ["installing", "configured", "unavailable"].includes(state);
  if (!validPair) malformed();
  let agent: SessionAgent | null = null;
  if (source.agent !== null) {
    const candidate = string(source.agent);
    if (!AGENTS.has(candidate as SessionAgent)) malformed();
    agent = candidate as SessionAgent;
  }
  return Object.freeze({
    agent,
    method: method as AgentAuthenticationMethod,
    state: state as AgentAuthenticationState,
  });
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
  if (subjectScope !== "account" && subjectScope !== "machine") malformed();
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
    exact(workspace, ["assigned", "usage"]);
    const usage = object(workspace.usage);
    if (["est_spend_usd", "est_remaining_usd", "note"].some((key) => !Object.hasOwn(usage, key))) malformed();
    return Object.freeze({
      id, email, workspace: Object.freeze({
        assigned: true as const,
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
