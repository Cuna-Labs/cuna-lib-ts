import { resolveConfig, type EffectiveConfig } from "./config.js";
import { randomBytes } from "node:crypto";
import { assertUuid } from "./domain.js";
import { ApiError } from "./errors.js";
import {
  constructAgentSessionsManager,
  type AgentSessionsManager,
} from "./agent-sessions.js";
import type { ClientPort } from "./internal/client-port.js";
import type { OperationKey } from "./internal/contract/index.js";
import {
  FetchTransport,
  type DispatchInput,
  type DispatchResult,
} from "./internal/transport.js";
import {
  type ClientTransport,
} from "./internal/performance-seam.js";
import { createDefaultTransport } from "./internal/test-seams.js";
import { Session, constructSession } from "./session.js";
import {
  constructWorkspaceSyncManager,
  type WorkspaceSyncManager,
} from "./workspace-sync.js";
import {
  constructWorkspaceBindingsManager,
  type WorkspaceBindingsManager,
} from "./workspace-bindings.js";
import {
  constructMachineCreatesManager,
  type MachineCreatesManager,
} from "./machine-creates.js";
import type {
  CapabilityScope,
  CapabilitySnapshot,
  Me,
  Record,
  CunaConfig,
  SessionAgent,
  SessionCreateOptions,
  SessionSnapshot,
} from "./types.js";

/**
 * Client-owned entry point for creating, listing, and retrieving sessions.
 * @cuna-contract sessionsmanager-summary PRD-027#R-027-01
 */
export interface SessionsManager {
  /**
   * Creates one session and returns its client-owned handle.
   * @param name Session name containing between one and eighty characters.
   * @param options Optional agent, resource, host, and runtime-port settings.
   * @returns A client-owned handle for the created session.
   * @throws ApiError when the API rejects the operation or returns an invalid response.
   * @example docs/reference/examples/workflows.ts#sessions-create
   * @cuna-contract sessionsmanager-create-description PRD-028#R-028-01
   * @cuna-contract sessionsmanager-create-param-name PRD-028#R-028-01
   * @cuna-contract sessionsmanager-create-param-options PRD-028#R-028-01
   * @cuna-contract sessionsmanager-create-returns PRD-028#R-028-01
   * @cuna-contract sessionsmanager-create-throws-api PRD-024#R-024-03
   * @cuna-contract sessionsmanager-create-example PRD-028#R-028-01
   */
  create(
    name: string,
    options?: SessionCreateOptions,
  ): Promise<Session>;
  /**
   * Lists the sessions available to the caller.
   * @returns A fresh readonly ordered collection of client-owned session handles.
   * @throws ApiError when the API rejects the operation or returns an invalid response.
   * @example docs/reference/examples/workflows.ts#sessions-list
   * @cuna-contract sessionsmanager-list-description PRD-029#R-029-01
   * @cuna-contract sessionsmanager-list-returns PRD-029#R-029-01
   * @cuna-contract sessionsmanager-list-throws-api PRD-024#R-024-03
   * @cuna-contract sessionsmanager-list-example PRD-029#R-029-01
   */
  list(): Promise<readonly Session[]>;
  /**
   * Retrieves one session by canonical identifier.
   * @param id Exact canonical lowercase session UUID.
   * @returns A client-owned handle for the requested session.
   * @throws ApiError when the API rejects the operation or returns an invalid response.
   * @example docs/reference/examples/workflows.ts#sessions-get
   * @cuna-contract sessionsmanager-get-description PRD-030#R-030-01
   * @cuna-contract sessionsmanager-get-param-id PRD-030#R-030-01
   * @cuna-contract sessionsmanager-get-returns PRD-030#R-030-01
   * @cuna-contract sessionsmanager-get-throws-api PRD-024#R-024-03
   * @cuna-contract sessionsmanager-get-example PRD-030#R-030-01
   */
  get(id: string): Promise<Session>;
}

/**
 * Client-owned entry point for listing records.
 * @cuna-contract recordsmanager-summary PRD-027#R-027-01
 */
export interface RecordsManager {
  /**
   * Lists records available to the caller.
   * @returns A fresh readonly ordered collection of records.
   * @throws ApiError when the API rejects the operation or returns an invalid response.
   * @example docs/reference/examples/workflows.ts#records-list
   * @cuna-contract recordsmanager-list-description PRD-037#R-037-01
   * @cuna-contract recordsmanager-list-returns PRD-037#R-037-01
   * @cuna-contract recordsmanager-list-throws-api PRD-024#R-024-03
   * @cuna-contract recordsmanager-list-example PRD-037#R-037-01
   */
  list(): Promise<readonly Record[]>;
}

/** Client-owned entry point for discovering current feature availability. */
export interface CapabilitiesManager {
  /**
   * Gets leased capability evidence. Discovery never authorizes a mutation.
   * Agent-session discovery is sent explicitly and currently returns the
   * canonical unsupported API error.
   */
  get(scope: CapabilityScope, resourceId?: string): Promise<CapabilitySnapshot>;
}

class ClientContext implements ClientPort {
  readonly #config: EffectiveConfig;
  #transport: ClientTransport | undefined;
  #state: "open" | "closing" | "closed" = "open";
  #active = 0;
  #closePromise: Promise<void> | undefined;
  #closeResolver: (() => void) | undefined;

  constructor(config: EffectiveConfig) {
    this.#config = config;
  }

  async invoke(
    operationKey: OperationKey,
    input: DispatchInput = {},
  ): Promise<DispatchResult> {
    if (this.#state !== "open") {
      throw new TypeError("The Cuna client is closed.");
    }
    this.#active += 1;
    try {
      if (this.#transport === undefined) {
        this.#transport = this.#config.fetch === undefined
          ? createDefaultTransport(this.#config)
          : new FetchTransport(this.#config);
      }
      return await this.#transport.execute(operationKey, input);
    } finally {
      this.#active -= 1;
      this.#finishClose();
    }
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#state = "closing";
    this.#closePromise = new Promise<void>((resolve) => {
      this.#closeResolver = resolve;
    });
    this.#finishClose();
    return this.#closePromise;
  }

  #finishClose(): void {
    if (
      this.#state !== "closing" ||
      this.#active !== 0 ||
      this.#closeResolver === undefined
    ) {
      return;
    }
    this.#transport?.close();
    this.#transport = undefined;
    this.#state = "closed";
    const resolve = this.#closeResolver;
    this.#closeResolver = undefined;
    resolve();
  }
}

function own(
  source: globalThis.Record<string, unknown>,
  key: string,
): boolean {
  return Object.hasOwn(source, key);
}

function createBody(
  name: string,
  options?: SessionCreateOptions,
): Readonly<globalThis.Record<string, unknown>> {
  if (typeof name !== "string" || [...name].length < 1 || [...name].length > 80) {
    throw new TypeError("Invalid session create options.");
  }
  const body: globalThis.Record<string, unknown> = { name };
  if (options === undefined) return Object.freeze(body);
  if (options === null || typeof options !== "object") {
    throw new TypeError("Invalid session create options.");
  }
  const source = options as SessionCreateOptions &
    globalThis.Record<string, unknown>;
  if (Object.keys(source).some((key) =>
    !["idempotencyKey", "agent", "vcpus", "memoryMiB", "allowedHosts", "outboundPolicy", "runtimePort"].includes(key)
  )) {
    throw new TypeError("Invalid session create options.");
  }
  if (own(source, "agent")) {
    const allowed = new Set<SessionAgent>([
      "claude-code",
      "codex",
      "openclaw",
    ]);
    if (
      typeof source.agent !== "string" ||
      !allowed.has(source.agent as SessionAgent)
    ) {
      throw new TypeError("Invalid session create options.");
    }
    body.agent = source.agent;
  }
  if (own(source, "vcpus") && source.vcpus !== undefined) {
    if (!Number.isInteger(source.vcpus) || source.vcpus < 1 || source.vcpus > 8) {
      throw new TypeError("Invalid session create options.");
    }
    body.vcpus = source.vcpus;
  }
  if (own(source, "memoryMiB") && source.memoryMiB !== undefined) {
    if (!Number.isInteger(source.memoryMiB) || source.memoryMiB < 512 || source.memoryMiB > 16_384) {
      throw new TypeError("Invalid session create options.");
    }
    body.memory_mib = source.memoryMiB;
  }
  if (own(source, "allowedHosts") && source.allowedHosts !== undefined) {
    if (!Array.isArray(source.allowedHosts) || source.allowedHosts.length > 128 || source.allowedHosts.some((host) => typeof host !== "string" || host.length === 0)) {
      throw new TypeError("Invalid session create options.");
    }
    body.allowed_hosts = Object.freeze([...source.allowedHosts]);
  }
  if (source.allowedHosts !== undefined && source.outboundPolicy !== undefined) {
    throw new TypeError("Invalid session create options.");
  }
  if (own(source, "outboundPolicy") && source.outboundPolicy !== undefined) {
    const policy = source.outboundPolicy as unknown;
    if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
      throw new TypeError("Invalid session create options.");
    }
    const record = policy as globalThis.Record<string, unknown>;
    const hosts = record.hosts;
    const hostPattern = /^(?:\*\.)?(?![0-9]{1,3}(?:\.[0-9]{1,3}){3}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
    if (
      Object.keys(record).some((key) => !["mode", "hosts"].includes(key)) ||
      !["allowlist", "denylist"].includes(record.mode as string) ||
      !Array.isArray(hosts) ||
      hosts.length > 128 ||
      hosts.some((host) => typeof host !== "string" || host.length < 3 || host.length > 253 || !hostPattern.test(host)) ||
      new Set(hosts).size !== hosts.length
    ) {
      throw new TypeError("Invalid session create options.");
    }
    body.outbound_policy = Object.freeze({
      mode: record.mode,
      hosts: Object.freeze([...hosts]),
    });
  }
  if (own(source, "runtimePort") && source.runtimePort !== undefined) {
    if (!Number.isInteger(source.runtimePort) || source.runtimePort < 1 || source.runtimePort > 65_535) {
      throw new TypeError("Invalid session create options.");
    }
    body.runtime_port = source.runtimePort;
  }
  return Object.freeze(body);
}

class SessionsManagerImplementation implements SessionsManager {
  readonly #owner: ClientPort;

  constructor(owner: ClientPort) {
    this.#owner = owner;
  }

  async create(
    name: string,
    options: SessionCreateOptions = {},
  ): Promise<Session> {
    if (
      options.idempotencyKey !== undefined &&
        (typeof options.idempotencyKey !== "string" ||
          !/^[\x21-\x7e]{8,128}$/.test(options.idempotencyKey))
    ) {
      throw new TypeError("The Cuna idempotency key is invalid.");
    }
    const body = createBody(name, options);
    const snapshot = (await this.#owner.invoke("sessions.create", {
      body,
      idempotencyKey: options.idempotencyKey ??
        `cuna_sdk_${randomBytes(18).toString("base64url")}`,
    })) as SessionSnapshot;
    return constructSession(this.#owner, snapshot);
  }

  async list(): Promise<readonly Session[]> {
    const snapshots = (await this.#owner.invoke(
      "sessions.list",
    )) as readonly SessionSnapshot[];
    return Object.freeze(
      snapshots.map((snapshot) => constructSession(this.#owner, snapshot)),
    );
  }

  async get(id: string): Promise<Session> {
    assertUuid(id);
    const snapshot = (await this.#owner.invoke("sessions.get", {
      id,
    })) as SessionSnapshot;
    if (snapshot.id !== id) {
      throw new ApiError(200, "malformed_response");
    }
    return constructSession(this.#owner, snapshot);
  }

}

class RecordsManagerImplementation implements RecordsManager {
  readonly #owner: ClientPort;

  constructor(owner: ClientPort) {
    this.#owner = owner;
  }

  async list(): Promise<readonly Record[]> {
    const records = (await this.#owner.invoke(
      "records.list",
    )) as readonly Record[];
    return Object.freeze([...records]);
  }
}

class CapabilitiesManagerImplementation implements CapabilitiesManager {
  readonly #owner: ClientPort;

  constructor(owner: ClientPort) {
    this.#owner = owner;
  }

  async get(
    scope: CapabilityScope,
    resourceId?: string,
  ): Promise<CapabilitySnapshot> {
    if (scope !== "account" && scope !== "machine" && scope !== "agent_session") {
      throw new TypeError("Invalid capability scope.");
    }
    if (scope === "account") {
      if (resourceId !== undefined) throw new TypeError("Invalid capability scope.");
    } else {
      assertUuid(resourceId);
    }
    const snapshot = (await this.#owner.invoke("capabilities.get", {
      query: Object.freeze({
        scope,
        ...(resourceId === undefined ? {} : { resource_id: resourceId }),
      }),
    })) as CapabilitySnapshot;
    if (snapshot.subjectScope !== scope ||
        (scope !== "account" && snapshot.subjectId !== resourceId)) {
      throw new ApiError(200, "malformed_response");
    }
    return snapshot;
  }
}

/**
 * Constructible Cuna client that owns managers, transport lifecycle, and cleanup.
 * @cuna-contract cuna-summary PRD-023#R-023-01
 */
export class Cuna {
  readonly #context: ClientContext;
  #agentSessions: AgentSessionsManager | undefined;
  #capabilities: CapabilitiesManager | undefined;
  #sessions: SessionsManager | undefined;
  #workspaceBindings: WorkspaceBindingsManager | undefined;
  #workspaceSync: WorkspaceSyncManager | undefined;
  #machineCreates: MachineCreatesManager | undefined;
  #records: RecordsManager | undefined;

  /**
   * Constructs one configured Cuna client.
   * @param config Optional client configuration resolved under the documented precedence rules.
   * @returns A configured Cuna client.
   * @throws ConfigError when selected client configuration is invalid.
   * @example docs/reference/examples/workflows.ts#cuna-constructor
   * @cuna-contract cuna-constructor-description PRD-023#R-023-01
   * @cuna-contract cuna-constructor-param-config PRD-023#R-023-01
   * @cuna-contract cuna-constructor-returns PRD-023#R-023-01
   * @cuna-contract cuna-constructor-throws-config PRD-023#R-023-06
   * @cuna-contract cuna-constructor-example PRD-023#R-023-01
   */
  constructor(config?: CunaConfig) {
    this.#context = new ClientContext(resolveConfig(config));
  }

  /** Stable sessions manager owned by this client. */
  get sessions(): SessionsManager {
    this.#sessions ??= new SessionsManagerImplementation(this.#context);
    return this.#sessions;
  }

  /** Stable manager for canonical public workspace bindings. */
  get workspaceBindings(): WorkspaceBindingsManager {
    this.#workspaceBindings ??= constructWorkspaceBindingsManager(this.#context);
    return this.#workspaceBindings;
  }

  /** Explicit bounded workspace synchronization protocol operations. */
  get workspaceSync(): WorkspaceSyncManager {
    this.#workspaceSync ??= constructWorkspaceSyncManager(this.#context);
    return this.#workspaceSync;
  }

  /** Read and reconcile non-secret machine-create request state. */
  get machineCreates(): MachineCreatesManager {
    this.#machineCreates ??= constructMachineCreatesManager(this.#context);
    return this.#machineCreates;
  }

  /** Stable manager for multiple agent processes owned by one machine. */
  get agentSessions(): AgentSessionsManager {
    this.#agentSessions ??= constructAgentSessionsManager(this.#context);
    return this.#agentSessions;
  }

  /** Stable capability discovery manager owned by this client. */
  get capabilities(): CapabilitiesManager {
    this.#capabilities ??= new CapabilitiesManagerImplementation(this.#context);
    return this.#capabilities;
  }

  /** Stable records manager owned by this client. */
  get records(): RecordsManager {
    this.#records ??= new RecordsManagerImplementation(this.#context);
    return this.#records;
  }

  /**
   * Reads the caller profile and workspace state.
   * @returns The caller profile and workspace state.
   * @throws ApiError when the API rejects the operation or returns an invalid response.
   * @example docs/reference/examples/workflows.ts#cuna-me
   * @cuna-contract cuna-me-description PRD-036#R-036-01
   * @cuna-contract cuna-me-returns PRD-036#R-036-01
   * @cuna-contract cuna-me-throws-api PRD-024#R-024-03
   * @cuna-contract cuna-me-example PRD-036#R-036-01
   */
  async me(): Promise<Me> {
    return (await this.#context.invoke("me.get")) as Me;
  }

  /**
   * Closes this client after already admitted work completes.
   * @returns A promise that resolves after client-owned cleanup completes.
   * @example docs/reference/examples/workflows.ts#cuna-close
   * @cuna-contract cuna-close-description PRD-027#R-027-10
   * @cuna-contract cuna-close-returns PRD-027#R-027-10
   * @cuna-contract cuna-close-example PRD-027#R-027-10
   */
  close(): Promise<void> {
    return this.#context.close();
  }
}
