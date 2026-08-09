import { ApiError } from "./errors.js";
import { assertUuid } from "./domain.js";
import type { ClientPort } from "./internal/client-port.js";
import type { SessionAgent } from "./types.js";

export type AgentSessionAuthMode =
  | "interactive_login"
  | "credential_binding";
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
  readonly name: string;
  readonly agent: SessionAgent;
  readonly cwd: string;
  readonly authMode: AgentSessionAuthMode;
  readonly desiredState: AgentSessionDesiredState;
  readonly requestState: AgentSessionRequestState;
  readonly processState: AgentSessionProcessState;
  readonly processEpoch?: string;
  readonly runtimeObservedAt?: string;
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
  readonly name?: string;
  readonly authMode?: AgentSessionAuthMode;
  readonly credentialBindingId?: string;
}

/** Typed AgentSession operations. This manager does not open a terminal or perform provider login. */
export interface AgentSessionsManager {
  list(machineId: string, options?: AgentSessionListOptions): Promise<AgentSessionPage>;
  create(machineId: string, options: AgentSessionCreateOptions): Promise<AgentSession>;
  get(agentSessionId: string): Promise<AgentSession>;
  rename(agentSessionId: string, name: string): Promise<AgentSession>;
  terminate(agentSessionId: string): Promise<AgentSession>;
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
  "name",
  "authMode",
  "credentialBindingId",
]);
const LIST_FIELDS = new Set(["limit", "cursor"]);

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
      typeof options.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(options.idempotencyKey)) {
    throw new TypeError("Invalid AgentSession create options.");
  }
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
    if (created.machineId !== machineId || created.agent !== options.agent || created.cwd !== options.cwd) {
      throw new ApiError(201, "malformed_response");
    }
    return created;
  }

  async get(agentSessionId: string): Promise<AgentSession> {
    return await this.#one("agentSessions.get", agentSessionId);
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
