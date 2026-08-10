import { randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";

import type { EffectiveConfig } from "../config.js";
import {
  decodeAcknowledgement,
  decodeAgentSessionAuth,
  decodeAgentSession,
  decodeAgentSessionPage,
  decodeWorkspaceBinding,
  decodeMachineCreateRequest,
  decodeProblem,
  decodeTerminalConnectionGrant,
  decodeCapabilitySnapshot,
  decodeExec,
  decodeMe,
  decodeOpen,
  decodeRecords,
  decodeSession,
  decodeSessions,
  decodeWorkspaceSyncEnvelope,
  decodeWorkspaceSyncProblem,
  DecodeFailure,
} from "../domain.js";
import { ApiError, ConfigError, apiErrorWithProblem } from "../errors.js";
import type {
  Acknowledgement,
  CapabilitySnapshot,
  ExecResult,
  Me,
  OpenSessionResult,
  Record,
  SessionSnapshot,
} from "../types.js";
import type { AgentSession, AgentSessionAuth, AgentSessionPage } from "../agent-sessions.js";
import type { TerminalConnectionGrant } from "../agent-sessions.js";
import {
  operationDescriptor,
  type OperationKey,
} from "./contract/index.js";
import { OperationObserver } from "./observer.js";
import { sanitizeWire } from "./sanitize.js";
import { SDK_VERSION } from "../version.js";
import type { MachineCreateRequest } from "../machine-creates.js";
import type { WorkspaceBinding } from "../workspace-bindings.js";
import type { WorkspaceSyncEnvelope } from "../workspace-sync.js";

const MAX_RESPONSE_BYTES = 16_777_216;
const READS = new Set<OperationKey>([
  "agentSessions.list",
  "agentSessions.get",
  "agentSessions.agentAuth",
  "capabilities.get",
  "me.get",
  "sessions.list",
  "sessions.get",
  "records.list",
  "workspaces.sync.changes",
  "workspaces.sync.chunkDownload",
  "machineCreates.get",
  "workspaceBindings.get",
]);

export interface DispatchInput {
  readonly id?: string;
  readonly query?: Readonly<globalThis.Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutSecs?: number;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
  readonly bindingId?: string;
  readonly digest?: string;
  readonly bytes?: Uint8Array;
}

export type DispatchResult =
  | Acknowledgement
  | AgentSession
  | AgentSessionAuth
  | AgentSessionPage
  | TerminalConnectionGrant
  | CapabilitySnapshot
  | ExecResult
  | Me
  | OpenSessionResult
  | readonly Record[]
  | SessionSnapshot
  | readonly SessionSnapshot[]
  | WorkspaceSyncEnvelope<unknown>
  | MachineCreateRequest
  | WorkspaceBinding;

export interface CancelableTimer {
  cancel(): void;
}

export interface TransportRuntime {
  now(): number;
  timer(callback: () => void, delayMs: number): CancelableTimer;
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
  randomUint32(): number;
  requestId(): string;
}

interface PreparedRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers: Readonly<globalThis.Record<string, string>>;
  readonly body?: BodyInit;
}

function safeTransportFailure(): TypeError {
  return new TypeError("The Runa request failed.");
}

function timeoutFailure(): DOMException {
  return new DOMException("The Runa request timed out.", "TimeoutError");
}

function renderPath(
  template: string,
  id?: string,
  digest?: string,
  bindingId?: string,
): string {
  if (template.includes(":id")) {
    if (id === undefined) throw new TypeError("Invalid session ID.");
    template = template.replace(":id", id);
  }
  else if (id !== undefined) throw new TypeError("Invalid session ID.");
  if (template.includes(":digest")) {
    if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) throw new TypeError("Invalid workspace sync digest.");
    template = template.replace(":digest", digest);
  }
  else if (digest !== undefined) throw new TypeError("Invalid workspace sync digest.");
  if (template.includes(":binding_id")) {
    if (bindingId === undefined) throw new TypeError("Invalid workspace binding ID.");
    return template.replace(":binding_id", bindingId);
  }
  if (bindingId !== undefined) throw new TypeError("Invalid workspace binding ID.");
  return template;
}

function prepare(
  config: EffectiveConfig,
  operationKey: OperationKey,
  input: DispatchInput,
): PreparedRequest {
  const descriptor = operationDescriptor(operationKey);
  const path = renderPath(
    descriptor.pathTemplate,
    input.id,
    input.digest,
    input.bindingId,
  );
  const target = new URL(path, `${config.baseUrl}/`);
  if (input.query !== undefined) {
    for (const [key, value] of Object.entries(input.query)) {
      target.searchParams.append(key, value);
    }
  }
  const expectedHref = `${config.baseUrl}${path}${target.search}`;
  if (target.origin !== config.baseUrl || target.href !== expectedHref) {
    throw new ConfigError();
  }
  let body: BodyInit | undefined;
  const binaryBody = operationKey === "workspaces.sync.chunk";
  if (binaryBody) {
    if (!(input.bytes instanceof Uint8Array) || input.body !== undefined) throw new TypeError("The Runa request body is invalid.");
    body = input.bytes.slice().buffer;
  } else if (descriptor.hasRequestBody) {
    try {
      body = JSON.stringify(input.body);
    } catch {
      throw new TypeError("The Runa request body is invalid.");
    }
    if (body === undefined) {
      throw new TypeError("The Runa request body is invalid.");
    }
  } else if (input.body !== undefined) {
    throw new TypeError("The Runa request body is invalid.");
  }
  const needsIdempotencyKey = operationKey === "agentSessions.create" ||
    operationKey === "agentSessions.createTerminalConnection" ||
    operationKey === "sessions.create" ||
    operationKey === "workspaceBindings.create" ||
    operationKey === "workspaces.sync.begin" ||
    operationKey === "workspaces.sync.negotiate" ||
    operationKey === "workspaces.sync.chunk" ||
    operationKey === "workspaces.sync.commit" ||
    operationKey === "workspaces.sync.reconcile";
  if (needsIdempotencyKey !== (input.idempotencyKey !== undefined)) {
    throw new TypeError("The Runa idempotency key is invalid.");
  }
  return Object.freeze({
    url: target.href,
    method: descriptor.method,
    headers: Object.freeze({
      Accept: "application/json, application/problem+json",
      Authorization: `Bearer ${config.apiKey}`,
      "User-Agent": `runa-sdk-typescript/${SDK_VERSION}`,
      ...(input.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": input.idempotencyKey }),
      ...(body === undefined
        ? {}
        : binaryBody
          ? { "Content-Type": "application/octet-stream", "Content-Length": String(input.bytes!.byteLength) }
          : { "Content-Type": "application/json; charset=utf-8" }),
    }),
    ...(body === undefined ? {} : { body }),
  });
}

async function readLimited(
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(cancellationFailure());
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) throw cancellationFailure();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          cancelReader(reader);
          throw new ApiError(response.status, "malformed_response");
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (signal.aborted) {
      cancelReader(reader);
      throw cancellationFailure();
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(response.status, "malformed_response");
  } finally {
    signal.removeEventListener("abort", onAbort);
    rejectAbort = undefined;
    try {
      reader.releaseLock();
    } catch {
      // A pending hostile reader operation must not delay the caller deadline.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Body cancellation is best-effort and never outranks the public outcome.
  }
}

function cancelResponseBody(response: Response): void {
  if (response.body === null) return;
  try {
    void response.body.cancel().catch(() => undefined);
  } catch {
    // An uncooperative body must not keep a failed request pending.
  }
}

function cancellationFailure(): DOMException {
  return new DOMException("The Runa request was cancelled.", "AbortError");
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function disposition(
  response: Response,
  operationKey: OperationKey,
  signal: AbortSignal,
) {
  const descriptor = operationDescriptor(operationKey);
  if (response.status >= 300 && response.status < 400) {
    cancelResponseBody(response);
    throw new ApiError(response.status, "malformed_response");
  }
  if (response.status !== descriptor.successStatus) {
    if (response.status >= 200 && response.status < 300) {
      cancelResponseBody(response);
      throw new ApiError(response.status, "malformed_response");
    }
    if (descriptor.errorKind === "problem") {
      throw await problemFailure(
        response,
        signal,
        descriptor.responseKind === "workspace-sync",
      );
    }
    cancelResponseBody(response);
    throw new ApiError(response.status, "api_error");
  }
  if (signal.aborted) throw cancellationFailure();
  if (
    operationKey === "agentSessions.agentAuth" &&
    response.headers.get("cache-control")?.trim().toLowerCase() !== "no-store"
  ) {
    cancelResponseBody(response);
    throw new ApiError(response.status, "malformed_response");
  }
  const contentType = response.headers.get("content-type");
  if (
    contentType === null ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    cancelResponseBody(response);
    throw new ApiError(response.status, "malformed_response");
  }
  const bytes = await readLimited(response, signal);
  if (signal.aborted) throw cancellationFailure();
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = sanitizeWire(JSON.parse(text));
  } catch {
    throw new ApiError(response.status, "malformed_response");
  }
  if (signal.aborted) throw cancellationFailure();
  try {
    switch (descriptor.responseKind) {
      case "acknowledgement":
        return decodeAcknowledgement(value);
      case "agent-auth":
        return decodeAgentSessionAuth(value);
      case "agent-session":
        return decodeAgentSession(value);
      case "agent-session-page":
        return decodeAgentSessionPage(value);
      case "terminal-connection-grant":
        return decodeTerminalConnectionGrant(value);
      case "capability-snapshot": {
        const snapshot = decodeCapabilitySnapshot(value);
        const etag = response.headers.get("etag");
        if (etag !== `"${snapshot.etag}"`) {
          throw new ApiError(response.status, "malformed_response");
        }
        return snapshot;
      }
      case "exec":
        return decodeExec(value);
      case "me":
        return decodeMe(value);
      case "open":
        return decodeOpen(value);
      case "records":
        return decodeRecords(value);
      case "session":
        return decodeSession(value);
      case "sessions":
        return decodeSessions(value);
      case "workspace-binding":
        return decodeWorkspaceBinding(value);
      case "workspace-sync":
        return decodeWorkspaceSyncEnvelope(
          operationKey as
            | "workspaces.sync.begin"
            | "workspaces.sync.negotiate"
            | "workspaces.sync.chunk"
            | "workspaces.sync.commit"
            | "workspaces.sync.changes"
            | "workspaces.sync.reconcile",
          value,
        );
      case "machine-create":
        return decodeMachineCreateRequest(value);
    }
  } catch (error) {
    if (error instanceof DecodeFailure) {
      throw new ApiError(response.status, "malformed_response");
    }
    throw error;
  }
}

async function problemFailure(
  response: Response,
  signal: AbortSignal,
  workspaceSync: boolean,
): Promise<ApiError> {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!["application/json", "application/problem+json"].includes(mediaType)) {
    cancelResponseBody(response);
    return new ApiError(response.status);
  }
  try {
    const bytes = await readLimited(response, signal);
    if (signal.aborted) throw cancellationFailure();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = sanitizeWire(JSON.parse(text));
    return apiErrorWithProblem(
      response.status,
      workspaceSync && mediaType === "application/problem+json"
        ? decodeWorkspaceSyncProblem(value, response.status)
        : decodeProblem(value, response.status),
    );
  } catch (error) {
    if (signal.aborted) throw cancellationFailure();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return new ApiError(response.status);
  }
}

// The producer owns a 25-minute provisioning lease plus a five-minute recovery
// grace window. Explicit `background: false` creation keeps the request open,
// so the client must observe both phases. The extra minute covers final
// serialization and network jitter.
const SESSION_CREATE_DEADLINE_MS = 31 * 60 * 1_000;

function deadlineFor(operationKey: OperationKey, timeoutSecs?: number): number {
  if (READS.has(operationKey)) return 10_000;
  if (operationKey === "sessions.create") return SESSION_CREATE_DEADLINE_MS;
  if (operationKey === "sessions.exec") {
    return (timeoutSecs ?? 120) * 1_000 + 15_000;
  }
  return 60_000;
}

function totalDeadlineFor(operationKey: OperationKey, timeoutSecs?: number): number {
  if (READS.has(operationKey)) return 30_000;
  return deadlineFor(operationKey, timeoutSecs);
}

function uniformDelay(cap: number, randomUint32: () => number): number {
  const limit = cap + 1;
  const largest = Math.floor(0x1_0000_0000 / limit) * limit;
  for (;;) {
    const raw = randomUint32();
    if (raw < largest) return raw % limit;
  }
}

function productionSleep(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(cancellationFailure());
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(cancellationFailure());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const PRODUCTION_RUNTIME: TransportRuntime = Object.freeze({
  now: () => performance.now(),
  timer: (callback: () => void, delayMs: number): CancelableTimer => {
    const handle = setTimeout(callback, delayMs);
    return Object.freeze({ cancel: () => clearTimeout(handle) });
  },
  sleep: productionSleep,
  randomUint32: () => randomBytes(4).readUInt32BE(0),
  requestId: () => `runa_req_${randomBytes(16).toString("hex")}`,
});

export class FetchTransport {
  readonly #config: EffectiveConfig;
  readonly #runtime: TransportRuntime;
  readonly #fetch: typeof globalThis.fetch;

  constructor(
    config: EffectiveConfig,
    runtime: TransportRuntime = PRODUCTION_RUNTIME,
  ) {
    this.#config = config;
    this.#runtime = runtime;
    const selectedFetch = config.fetch ?? globalThis.fetch;
    if (typeof selectedFetch !== "function") throw new ConfigError();
    this.#fetch = selectedFetch;
  }

  async execute(
    operationKey: OperationKey,
    input: DispatchInput = {},
  ): Promise<DispatchResult> {
    const descriptor = operationDescriptor(operationKey);
    const prepared = prepare(this.#config, operationKey, input);
    const fetchImplementation = this.#fetch;
    const observer = new OperationObserver(
      descriptor,
      this.#config.diagnostics,
      this.#config.tracing,
      {
        now: () => this.#runtime.now(),
        requestId: () => this.#runtime.requestId(),
      },
    );
    observer.start();
    const startedAt = this.#runtime.now();
    const totalDeadline = totalDeadlineFor(operationKey, input.timeoutSecs);
    const maximumAttempts = READS.has(operationKey) ? 3 : 1;
    const callerSignal = input.signal;
    let attempt = 0;
    try {
      while (attempt < maximumAttempts) {
        if (signalAborted(callerSignal)) throw cancellationFailure();
        attempt += 1;
        const elapsed = this.#runtime.now() - startedAt;
        if (elapsed >= totalDeadline) throw timeoutFailure();
        const attemptDeadline = Math.min(
          deadlineFor(operationKey, input.timeoutSecs),
          totalDeadline - elapsed,
        );
        const controller = new AbortController();
        const onCallerAbort = () => controller.abort();
        callerSignal?.addEventListener("abort", onCallerAbort, {
          once: true,
        });
        const timer = this.#runtime.timer(
          () => controller.abort(),
          attemptDeadline,
        );
        observer.attempt(attempt);
        let response: Response;
        try {
          response = await fetchImplementation(prepared.url, {
            method: prepared.method,
            headers: prepared.headers,
            ...(prepared.body === undefined ? {} : { body: prepared.body }),
            redirect: "manual",
            signal: controller.signal,
          });
        } catch {
          timer.cancel();
          callerSignal?.removeEventListener("abort", onCallerAbort);
          if (signalAborted(callerSignal)) throw cancellationFailure();
          const canRetry =
            READS.has(operationKey) &&
            attempt < maximumAttempts &&
            this.#runtime.now() - startedAt < totalDeadline;
          if (!canRetry) {
            if (controller.signal.aborted) throw timeoutFailure();
            throw safeTransportFailure();
          }
          const delay = uniformDelay(
            Math.min(100 * 2 ** (attempt - 1), 1_000),
            () => this.#runtime.randomUint32(),
          );
          if (this.#runtime.now() - startedAt + delay >= totalDeadline) {
            throw timeoutFailure();
          }
          observer.retry(attempt + 1, delay);
          await this.#runtime.sleep(delay, callerSignal);
          continue;
        }
        try {
          if (signalAborted(callerSignal)) throw cancellationFailure();
          const result = await disposition(
            response,
            operationKey,
            controller.signal,
          );
          timer.cancel();
          callerSignal?.removeEventListener("abort", onCallerAbort);
          if (signalAborted(callerSignal)) throw cancellationFailure();
          observer.end(attempt);
          return result;
        } catch (error) {
          timer.cancel();
          callerSignal?.removeEventListener("abort", onCallerAbort);
          if (signalAborted(callerSignal)) throw cancellationFailure();
          if (controller.signal.aborted) throw timeoutFailure();
          throw error;
        }
      }
      throw timeoutFailure();
    } catch (error) {
      observer.end(attempt, error);
      throw error;
    }
  }

  close(): void {
    // Fetch callables are runtime- or caller-owned; the SDK never closes them.
  }
}
