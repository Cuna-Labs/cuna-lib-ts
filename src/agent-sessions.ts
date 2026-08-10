import { ApiError } from "./errors.js";
import { assertUuid } from "./domain.js";
import type { ClientPort } from "./internal/client-port.js";
import type { SessionAgent } from "./types.js";

export type AgentSessionAuthMode =
  | "interactive_login"
  | "credential_binding";
export type AgentSessionAuthState =
  | "login_required"
  | "authenticated"
  | "configured"
  | "unavailable";
export type AgentSessionAuthEvidenceClass =
  | "provider_cli_login_status"
  | "credential_binding_authority"
  | "insufficient";

/**
 * Immutable, short-lived authentication evidence for one exact AgentSession
 * process generation. Positive evidence is accepted only while its lease is
 * fresh; `unavailable` deliberately carries an empty freshness interval.
 */
export interface AgentSessionAuth {
  readonly observationId: string;
  readonly agentSessionId: string;
  readonly processEpoch: string | null;
  readonly authMode: AgentSessionAuthMode;
  readonly agentVersion: string;
  readonly adapterVersion: "runa.agent-auth.v1";
  readonly evidenceClass: AgentSessionAuthEvidenceClass;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly state: AgentSessionAuthState;
}
export type AgentSessionDesiredState = "running" | "terminated";
export type AgentSessionRequestState =
  | "launch_pending"
  | "runtime_claimed"
  | "launched"
  | "termination_pending"
  | "terminal"
  | "failed";
export type AgentSessionProcessState =
  | "unknown"
  | "starting"
  | "ready"
  | "running"
  | "exited"
  | "failed"
  | "terminating"
  | "terminated";

/** Immutable AgentSession intent and observed process facts. */
export interface AgentSession {
  readonly id: string;
  readonly machineId: string;
  /** Immutable Runa workspace-sync binding identifier. Absent only on legacy sessions. */
  readonly workspaceBindingId?: string;
  /** Immutable committed workspace generation. Absent only on legacy sessions. */
  readonly workspaceGeneration?: number;
  readonly name: string;
  readonly agent: SessionAgent;
  readonly cwd: string;
  readonly authMode: AgentSessionAuthMode;
  readonly desiredState: AgentSessionDesiredState;
  readonly requestState: AgentSessionRequestState;
  readonly processState: AgentSessionProcessState;
  readonly processEpoch?: string;
  readonly runtimeObservedAt?: string;
  /** Authoritative expiry of the current leased runtime observation. */
  readonly runtimeExpiresAt?: string;
  readonly terminationRequestedAt?: string;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One bounded page; `nextCursor` is opaque and may only be replayed to list. */
export interface AgentSessionPage {
  readonly items: readonly AgentSession[];
  readonly nextCursor?: string;
}

export interface AgentSessionListOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AgentSessionCreateOptions {
  readonly idempotencyKey: string;
  readonly agent: SessionAgent;
  readonly cwd: string;
  /** Canonical owned workspace-sync binding selected for this session. */
  readonly workspaceBindingId: string;
  /** Exact committed workspace generation selected for this session. */
  readonly workspaceGeneration: number;
  readonly name?: string;
  readonly authMode?: AgentSessionAuthMode;
  readonly credentialBindingId?: string;
}

export type TerminalConnectionProtocol = "runa.terminal.v1";
export type TerminalConnectionCapabilityName =
  | "acknowledgement"
  | "heartbeat"
  | "live_resize"
  | "resume"
  | "signals";
export type TerminalConnectionCapabilityAvailability =
  | "supported"
  | "unsupported"
  | "unknown";

export interface TerminalConnectionCapability {
  readonly name: TerminalConnectionCapabilityName;
  readonly availability: TerminalConnectionCapabilityAvailability;
}

/** Metadata required to issue a short-lived terminal connection grant. */
export interface TerminalConnectionCreateOptions {
  readonly idempotencyKey: string;
  readonly clientInstanceId: string;
  readonly protocol?: TerminalConnectionProtocol;
  readonly resumeHandle?: string;
}

/**
 * One-use connection metadata. The SDK never consumes this grant or opens its
 * WebSocket URL; terminal runtimes must own that separate boundary.
 */
export interface TerminalConnectionGrant {
  readonly terminalSessionId: string;
  readonly resumeHandle: string;
  readonly connectUrl: string;
  readonly connectToken: string;
  readonly protocol: TerminalConnectionProtocol;
  readonly capabilities: readonly TerminalConnectionCapability[];
  readonly expiresAt: string;
}

/** Typed AgentSession operations. This manager does not open a terminal or perform provider login. */
export interface AgentSessionsManager {
  list(machineId: string, options?: AgentSessionListOptions): Promise<AgentSessionPage>;
  create(machineId: string, options: AgentSessionCreateOptions): Promise<AgentSession>;
  get(agentSessionId: string): Promise<AgentSession>;
  /** Reads auth evidence and binds it to the supplied admitted AgentSession. */
  agentAuth(agentSession: AgentSession): Promise<AgentSessionAuth>;
  rename(agentSessionId: string, name: string): Promise<AgentSession>;
  terminate(agentSessionId: string): Promise<AgentSession>;
  createTerminalConnection(
    agentSessionId: string,
    options: TerminalConnectionCreateOptions,
  ): Promise<TerminalConnectionGrant>;
}

const AGENTS = new Set<SessionAgent>(["claude-code", "codex", "openclaw"]);
const AUTH_MODES = new Set<AgentSessionAuthMode>([
  "interactive_login",
  "credential_binding",
]);
const CWD = /^\/workspace(?:\/.*)?$/u;
const IDEMPOTENCY_KEY = /^[!-~]{8,128}$/u;
const CREATE_FIELDS = new Set([
  "idempotencyKey",
  "agent",
  "cwd",
  "workspaceBindingId",
  "workspaceGeneration",
  "name",
  "authMode",
  "credentialBindingId",
]);
const LIST_FIELDS = new Set(["limit", "cursor"]);
const TERMINAL_CONNECTION_FIELDS = new Set([
  "idempotencyKey",
  "clientInstanceId",
  "protocol",
  "resumeHandle",
]);
const CLIENT_INSTANCE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const TERMINAL_PROTOCOL: TerminalConnectionProtocol = "runa.terminal.v1";

function length(value: string): number {
  return [...value].length;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && length(value) >= 1 && length(value) <= 80;
}

function validateCreate(options: AgentSessionCreateOptions): {
  readonly body: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
} {
  if (options === null || typeof options !== "object" ||
      Object.keys(options).some((key) => !CREATE_FIELDS.has(key))) {
    throw new TypeError("Invalid AgentSession create options.");
  }
  if (!AGENTS.has(options.agent) || typeof options.cwd !== "string" ||
      length(options.cwd) < 10 || length(options.cwd) > 1_024 || !CWD.test(options.cwd) ||
      typeof options.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(options.idempotencyKey) ||
      !Number.isSafeInteger(options.workspaceGeneration) || options.workspaceGeneration < 1) {
    throw new TypeError("Invalid AgentSession create options.");
  }
  assertUuid(options.workspaceBindingId);
  if (options.name !== undefined && !validName(options.name)) {
    throw new TypeError("Invalid AgentSession create options.");
  }
  if (options.authMode !== undefined && !AUTH_MODES.has(options.authMode)) {
    throw new TypeError("Invalid AgentSession create options.");
  }
  if (options.credentialBindingId !== undefined) assertUuid(options.credentialBindingId);
  const effectiveMode = options.authMode ??
    (options.agent === "openclaw" ? "credential_binding" : "interactive_login");
  if (
    (effectiveMode === "interactive_login" && options.credentialBindingId !== undefined) ||
    (effectiveMode === "credential_binding" && options.credentialBindingId === undefined)
  ) {
    throw new TypeError("Invalid AgentSession authentication binding.");
  }
  return Object.freeze({
    idempotencyKey: options.idempotencyKey,
    body: Object.freeze({
      agent: options.agent,
      cwd: options.cwd,
      workspace_binding_id: options.workspaceBindingId,
      workspace_generation: options.workspaceGeneration,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.authMode === undefined ? {} : { auth_mode: options.authMode }),
      ...(options.credentialBindingId === undefined
        ? {}
        : { credential_binding_id: options.credentialBindingId }),
    }),
  });
}

class AgentSessionsManagerImplementation implements AgentSessionsManager {
  readonly #owner: ClientPort;

  constructor(owner: ClientPort) {
    this.#owner = owner;
  }

  async list(
    machineId: string,
    options: AgentSessionListOptions = {},
  ): Promise<AgentSessionPage> {
    assertUuid(machineId);
    if (options === null || typeof options !== "object" ||
        Object.keys(options).some((key) => !LIST_FIELDS.has(key))) {
      throw new TypeError("Invalid AgentSession list options.");
    }
    if (options.limit !== undefined &&
        (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100)) {
      throw new TypeError("Invalid AgentSession list options.");
    }
    if (options.cursor !== undefined &&
        (typeof options.cursor !== "string" || length(options.cursor) < 1 || length(options.cursor) > 512)) {
      throw new TypeError("Invalid AgentSession list options.");
    }
    const page = (await this.#owner.invoke("agentSessions.list", {
      id: machineId,
      query: Object.freeze({
        ...(options.limit === undefined ? {} : { limit: String(options.limit) }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      }),
    })) as AgentSessionPage;
    if (page.items.some((item) => item.machineId !== machineId)) {
      throw new ApiError(200, "malformed_response");
    }
    return page;
  }

  async create(machineId: string, options: AgentSessionCreateOptions): Promise<AgentSession> {
    assertUuid(machineId);
    const input = validateCreate(options);
    const created = (await this.#owner.invoke("agentSessions.create", {
      id: machineId,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
    })) as AgentSession;
    if (created.machineId !== machineId || created.agent !== options.agent ||
        created.cwd !== options.cwd ||
        created.workspaceBindingId !== options.workspaceBindingId ||
        created.workspaceGeneration !== options.workspaceGeneration) {
      throw new ApiError(201, "malformed_response");
    }
    return created;
  }

  async get(agentSessionId: string): Promise<AgentSession> {
    return await this.#one("agentSessions.get", agentSessionId);
  }

  async agentAuth(agentSession: AgentSession): Promise<AgentSessionAuth> {
    if (agentSession === null || typeof agentSession !== "object") {
      throw new TypeError("Invalid AgentSession authentication authority.");
    }
    assertUuid(agentSession.id);
    const observation = (await this.#owner.invoke("agentSessions.agentAuth", {
      id: agentSession.id,
    })) as AgentSessionAuth;
    const expectedEpoch = agentSession.processEpoch ?? null;
    if (
      observation.agentSessionId !== agentSession.id ||
      observation.authMode !== agentSession.authMode ||
      observation.processEpoch !== expectedEpoch
    ) {
      throw new ApiError(200, "malformed_response");
    }
    return observation;
  }

  async rename(agentSessionId: string, name: string): Promise<AgentSession> {
    if (!validName(name)) throw new TypeError("Invalid AgentSession name.");
    const renamed = await this.#one("agentSessions.rename", agentSessionId, Object.freeze({ name }));
    if (renamed.name !== name) throw new ApiError(200, "malformed_response");
    return renamed;
  }

  async terminate(agentSessionId: string): Promise<AgentSession> {
    return await this.#one("agentSessions.terminate", agentSessionId);
  }

  async createTerminalConnection(
    agentSessionId: string,
    options: TerminalConnectionCreateOptions,
  ): Promise<TerminalConnectionGrant> {
    assertUuid(agentSessionId);
    if (options === null || typeof options !== "object" ||
        Object.keys(options).some((key) => !TERMINAL_CONNECTION_FIELDS.has(key)) ||
        typeof options.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(options.idempotencyKey) ||
        typeof options.clientInstanceId !== "string" || !CLIENT_INSTANCE_ID.test(options.clientInstanceId) ||
        (options.protocol !== undefined && options.protocol !== TERMINAL_PROTOCOL)) {
      throw new TypeError("Invalid terminal connection options.");
    }
    if (options.resumeHandle !== undefined) assertUuid(options.resumeHandle);
    return (await this.#owner.invoke("agentSessions.createTerminalConnection", {
      id: agentSessionId,
      idempotencyKey: options.idempotencyKey,
      body: Object.freeze({
        protocol: TERMINAL_PROTOCOL,
        client_instance_id: options.clientInstanceId,
        ...(options.resumeHandle === undefined
          ? {}
          : { resume_handle: options.resumeHandle }),
      }),
    })) as TerminalConnectionGrant;
  }

  async #one(
    operation: "agentSessions.get" | "agentSessions.rename" | "agentSessions.terminate",
    id: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<AgentSession> {
    assertUuid(id);
    const value = (await this.#owner.invoke(operation, {
      id,
      ...(body === undefined ? {} : { body }),
    })) as AgentSession;
    if (value.id !== id) throw new ApiError(200, "malformed_response");
    return value;
  }
}

export function constructAgentSessionsManager(owner: ClientPort): AgentSessionsManager {
  return new AgentSessionsManagerImplementation(owner);
}
