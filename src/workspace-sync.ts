import { ApiError } from "./errors.js";
import type { Problem } from "./errors.js";
import type { ClientPort } from "./internal/client-port.js";

export type WorkspaceSyncProtocol = 1 | 2;
export type WorkspaceSyncCapability =
  | "atomic_generation_commit"
  | "bounded_manifest_pages"
  | "content_digest_verification"
  | "explicit_reconciliation"
  | "ordered_generation_changes"
  | "policy_bound_admission";

export interface WorkspaceSyncProblem extends Omit<Problem, "action" | "detail"> {
  readonly code: `workspace_sync_${string}`;
  readonly detail: string;
  readonly action: "retry" | "none";
  readonly selectedProtocol: WorkspaceSyncProtocol | null;
  readonly capabilities: readonly WorkspaceSyncCapability[];
}

export interface WorkspaceSyncProtocolRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface WorkspaceSyncBeginRequest {
  /** Canonical WorkspaceBinding child of the public workspace path identifier. */
  readonly workspaceBindingId: string;
  readonly machineId: string;
  readonly baseGeneration: number;
  readonly exclusionPolicyDigest: string;
  readonly protocol: WorkspaceSyncProtocolRange;
  readonly minimumReader: number;
  readonly minimumWriter: number;
}

export interface WorkspaceSyncChunkReference {
  readonly digest: string;
  readonly byteLength: number;
}

export interface WorkspaceSyncManifestEntry {
  readonly path: string;
  readonly kind: "directory" | "file" | "symlink";
  readonly byteLength: number;
  readonly executable: boolean;
  readonly chunks: readonly WorkspaceSyncChunkReference[];
  readonly linkTarget: string | null;
}

export interface WorkspaceSyncManifestPageRequest {
  readonly pageIndex: number;
  readonly isLast: boolean;
  readonly minimumReader: number;
  readonly minimumWriter: number;
  readonly entries: readonly WorkspaceSyncManifestEntry[];
}

export interface WorkspaceSyncCommitRequest {
  readonly expectedGeneration: number;
  readonly exclusionPolicyDigest: string;
  readonly manifestRoot: string;
  readonly minimumReader: number;
  readonly minimumWriter: number;
}

export interface WorkspaceSyncReconcileRequest {
  /** Canonical WorkspaceBinding child of the public workspace path identifier. */
  readonly workspaceBindingId: string;
  readonly machineId: string;
  readonly observedGeneration: number;
  readonly exclusionPolicyDigest: string;
  readonly manifestRoot: string;
  readonly protocol: WorkspaceSyncProtocolRange;
}

export interface WorkspaceSyncEnvelope<T> {
  readonly requestId: string;
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly capabilities: readonly WorkspaceSyncCapability[];
  readonly data: T;
}

export interface WorkspaceSyncSession {
  readonly id: string;
  /** Public workspace identifier; never an internal synchronization namespace. */
  readonly workspaceId: string;
  readonly machineId: string;
  readonly baseGeneration: number;
  readonly exclusionPolicyDigest: string;
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly capabilities: readonly WorkspaceSyncCapability[];
  readonly state: "staging" | "committed" | "conflicted" | "expired";
  readonly manifestEntryCount: number;
  readonly manifestEncodedBytes: number;
  readonly contentBytes: number;
  readonly lastPageIndex?: number;
  readonly committedGeneration?: number;
  readonly committedManifestRoot?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceSyncManifestReceipt {
  readonly sync: WorkspaceSyncSession;
  readonly pageIndex: number;
  readonly pageDigest: string;
  readonly missingDigests: readonly string[];
}

export interface WorkspaceSyncChunkReceipt {
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly digest: string;
  readonly byteLength: number;
  readonly stored: boolean;
}

/** Private decoded carrier for a digest-verified chunk download. */
export interface WorkspaceSyncChunkContent {
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly digest: string;
  readonly byteLength: number;
  readonly minimumReader: number;
  readonly bytes: Uint8Array;
}

export interface WorkspaceSyncCommitReceipt {
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly state: "committed";
  readonly generation: number;
  readonly manifestRoot: string;
  readonly committedAt: string;
  readonly minimumReader: number;
  readonly minimumWriter: number;
}

export interface WorkspaceSyncChangeItem {
  readonly generation: number;
  readonly operation: "revision" | "upsert" | "delete";
  readonly path: string | null;
  readonly entry: WorkspaceSyncManifestEntry | null;
  readonly manifestRoot: string;
  readonly exclusionPolicyDigest: string;
  readonly committedAt: string;
  readonly minimumReader: number;
  readonly minimumWriter: number;
}

export interface WorkspaceSyncChangePage {
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly items: readonly WorkspaceSyncChangeItem[];
  readonly nextCursor: string | null;
}

export interface WorkspaceSyncReconcileReceipt {
  readonly selectedProtocol: WorkspaceSyncProtocol;
  readonly status: "converged" | "reconciliation_required";
  readonly activeGeneration: number;
  readonly activeManifestRoot: string;
  readonly exclusionPolicyDigest: string;
}

export interface WorkspaceSyncChangeOptions {
  readonly readerVersion: number;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface WorkspaceSyncManager {
  /** Begin a SyncAttempt for a public workspace and its exact binding. */
  begin(
    workspaceId: string,
    request: WorkspaceSyncBeginRequest,
    idempotencyKey: string,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncSession>>;
  negotiate(
    syncId: string,
    request: WorkspaceSyncManifestPageRequest,
    idempotencyKey: string,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncManifestReceipt>>;
  uploadChunk(
    syncId: string,
    digest: string,
    bytes: Uint8Array,
    idempotencyKey: string,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncChunkReceipt>>;
  /** Download one chunk as immutable bytes after strict digest and length verification. */
  downloadChunk(syncId: string, digest: string): Promise<Uint8Array>;
  commit(
    syncId: string,
    request: WorkspaceSyncCommitRequest,
    idempotencyKey: string,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncCommitReceipt>>;
  changes(
    syncId: string,
    options: WorkspaceSyncChangeOptions,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncChangePage>>;
  reconcile(
    workspaceId: string,
    request: WorkspaceSyncReconcileRequest,
    idempotencyKey: string,
  ): Promise<WorkspaceSyncEnvelope<WorkspaceSyncReconcileReceipt>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[\x21-\x7e]{8,128}$/u;

function invalid(): never {
  throw new TypeError("Invalid workspace sync request.");
}

function object(value: unknown): globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as globalThis.Record<string, unknown>;
}

function exact(source: globalThis.Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(source).some((name) => !names.includes(name)) ||
      names.some((name) => !Object.hasOwn(source, name))) invalid();
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) invalid();
  return value;
}

function key(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY.test(value)) {
    throw new TypeError("The Cuna idempotency key is invalid.");
  }
  return value;
}

function protocol(value: unknown): Readonly<WorkspaceSyncProtocolRange> {
  const source = object(value);
  exact(source, ["minimum", "maximum"]);
  const minimum = integer(source.minimum, 1);
  const maximum = integer(source.maximum, 1);
  if (minimum > maximum) invalid();
  return Object.freeze({ minimum, maximum });
}

function manifestEntry(value: unknown): Readonly<globalThis.Record<string, unknown>> {
  const source = object(value);
  exact(source, ["path", "kind", "byteLength", "executable", "chunks", "linkTarget"]);
  if (typeof source.path !== "string" || source.path.length < 1 || source.path.length > 4096 ||
      !new Set(["directory", "file", "symlink"]).has(source.kind as string) ||
      typeof source.executable !== "boolean" ||
      (source.linkTarget !== null && (typeof source.linkTarget !== "string" || source.linkTarget.length > 4096)) ||
      !Array.isArray(source.chunks) || source.chunks.length > 4096) invalid();
  const chunks = source.chunks.map((value) => {
    const chunk = object(value);
    exact(chunk, ["digest", "byteLength"]);
    return Object.freeze({
      digest: digest(chunk.digest),
      byte_length: integer(chunk.byteLength, 0, 8_388_608),
    });
  });
  return Object.freeze({
    path: source.path,
    kind: source.kind,
    byte_length: integer(source.byteLength, 0),
    executable: source.executable,
    chunks: Object.freeze(chunks),
    link_target: source.linkTarget,
  });
}

function beginBody(value: unknown): Readonly<globalThis.Record<string, unknown>> {
  const source = object(value);
  exact(source, [
    "workspaceBindingId", "machineId", "baseGeneration", "exclusionPolicyDigest",
    "protocol", "minimumReader", "minimumWriter",
  ]);
  return Object.freeze({
    workspace_binding_id: uuid(source.workspaceBindingId),
    machine_id: uuid(source.machineId),
    base_generation: integer(source.baseGeneration, 0),
    exclusion_policy_digest: digest(source.exclusionPolicyDigest),
    protocol: protocol(source.protocol),
    minimum_reader: integer(source.minimumReader, 1),
    minimum_writer: integer(source.minimumWriter, 1),
  });
}

function manifestBody(value: unknown): Readonly<globalThis.Record<string, unknown>> {
  const source = object(value);
  exact(source, ["pageIndex", "isLast", "minimumReader", "minimumWriter", "entries"]);
  if (typeof source.isLast !== "boolean" || !Array.isArray(source.entries) || source.entries.length > 4096) invalid();
  return Object.freeze({
    page_index: integer(source.pageIndex, 0, 255),
    is_last: source.isLast,
    minimum_reader: integer(source.minimumReader, 1),
    minimum_writer: integer(source.minimumWriter, 1),
    entries: Object.freeze(source.entries.map(manifestEntry)),
  });
}

function commitBody(value: unknown): Readonly<globalThis.Record<string, unknown>> {
  const source = object(value);
  exact(source, [
    "expectedGeneration", "exclusionPolicyDigest", "manifestRoot",
    "minimumReader", "minimumWriter",
  ]);
  return Object.freeze({
    expected_generation: integer(source.expectedGeneration, 0),
    exclusion_policy_digest: digest(source.exclusionPolicyDigest),
    manifest_root: digest(source.manifestRoot),
    minimum_reader: integer(source.minimumReader, 1),
    minimum_writer: integer(source.minimumWriter, 1),
  });
}

function reconcileBody(value: unknown): Readonly<globalThis.Record<string, unknown>> {
  const source = object(value);
  exact(source, [
    "workspaceBindingId", "machineId", "observedGeneration",
    "exclusionPolicyDigest", "manifestRoot", "protocol",
  ]);
  return Object.freeze({
    workspace_binding_id: uuid(source.workspaceBindingId),
    machine_id: uuid(source.machineId),
    observed_generation: integer(source.observedGeneration, 0),
    exclusion_policy_digest: digest(source.exclusionPolicyDigest),
    manifest_root: digest(source.manifestRoot),
    protocol: protocol(source.protocol),
  });
}

class WorkspaceSyncManagerImplementation implements WorkspaceSyncManager {
  constructor(private readonly owner: ClientPort) {}

  async begin(workspaceId: string, request: WorkspaceSyncBeginRequest, idempotencyKey: string) {
    uuid(workspaceId);
    const body = beginBody(request);
    const requestedProtocol = body.protocol as Readonly<WorkspaceSyncProtocolRange>;
    const result = await this.owner.invoke("workspaces.sync.begin", {
      id: workspaceId,
      body,
      idempotencyKey: key(idempotencyKey),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncSession>;
    if (result.data.workspaceId !== workspaceId ||
        result.data.machineId !== body.machine_id ||
        result.data.baseGeneration !== body.base_generation ||
        result.data.exclusionPolicyDigest !== body.exclusion_policy_digest ||
        result.selectedProtocol < requestedProtocol.minimum ||
        result.selectedProtocol > requestedProtocol.maximum) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }

  async negotiate(syncId: string, request: WorkspaceSyncManifestPageRequest, idempotencyKey: string) {
    uuid(syncId);
    const body = manifestBody(request);
    const result = await this.owner.invoke("workspaces.sync.negotiate", {
      id: syncId,
      body,
      idempotencyKey: key(idempotencyKey),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncManifestReceipt>;
    if (result.data.sync.id !== syncId || result.data.pageIndex !== body.page_index) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }

  async uploadChunk(syncId: string, expectedDigest: string, bytes: Uint8Array, idempotencyKey: string) {
    uuid(syncId);
    if (!SHA256.test(expectedDigest) || !(bytes instanceof Uint8Array) || bytes.byteLength > 8_388_608) invalid();
    const body = new Uint8Array(bytes);
    const result = await this.owner.invoke("workspaces.sync.chunk", {
      id: syncId,
      digest: expectedDigest,
      bytes: body,
      idempotencyKey: key(idempotencyKey),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncChunkReceipt>;
    if (result.data.digest !== expectedDigest || result.data.byteLength !== body.byteLength) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }

  async downloadChunk(syncId: string, expectedDigest: string): Promise<Uint8Array> {
    uuid(syncId);
    digest(expectedDigest);
    const result = await this.owner.invoke("workspaces.sync.chunkDownload", {
      id: syncId,
      digest: expectedDigest,
    }) as WorkspaceSyncEnvelope<WorkspaceSyncChunkContent>;
    if (result.data.digest !== expectedDigest ||
        result.data.selectedProtocol !== result.selectedProtocol ||
        result.data.minimumReader > 2) {
      throw new ApiError(200, "malformed_response");
    }
    return new Uint8Array(result.data.bytes);
  }

  async commit(syncId: string, request: WorkspaceSyncCommitRequest, idempotencyKey: string) {
    uuid(syncId);
    const body = commitBody(request);
    const result = await this.owner.invoke("workspaces.sync.commit", {
      id: syncId,
      body,
      idempotencyKey: key(idempotencyKey),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncCommitReceipt>;
    if (result.data.manifestRoot !== body.manifest_root ||
        result.data.generation !== (body.expected_generation as number) + 1 ||
        result.data.minimumReader !== body.minimum_reader ||
        result.data.minimumWriter !== body.minimum_writer) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }

  async changes(syncId: string, options: WorkspaceSyncChangeOptions) {
    uuid(syncId);
    const source = object(options);
    if (Object.keys(source).some((name) => !["readerVersion", "cursor", "limit"].includes(name)) ||
        !Object.hasOwn(source, "readerVersion")) invalid();
    const readerVersion = integer(source.readerVersion, 1);
    if (source.cursor !== undefined &&
        (typeof source.cursor !== "string" || source.cursor.length < 1 || source.cursor.length > 1024)) invalid();
    if (source.limit !== undefined) integer(source.limit, 1, 1000);
    const result = await this.owner.invoke("workspaces.sync.changes", {
      id: syncId,
      query: Object.freeze({
        reader_version: String(readerVersion),
        ...(source.cursor === undefined ? {} : { cursor: source.cursor as string }),
        ...(source.limit === undefined ? {} : { limit: String(source.limit) }),
      }),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncChangePage>;
    if (result.selectedProtocol > readerVersion) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }

  async reconcile(workspaceId: string, request: WorkspaceSyncReconcileRequest, idempotencyKey: string) {
    uuid(workspaceId);
    const body = reconcileBody(request);
    const requestedProtocol = body.protocol as Readonly<WorkspaceSyncProtocolRange>;
    const result = await this.owner.invoke("workspaces.sync.reconcile", {
      id: workspaceId,
      body,
      idempotencyKey: key(idempotencyKey),
    }) as WorkspaceSyncEnvelope<WorkspaceSyncReconcileReceipt>;
    if (result.data.exclusionPolicyDigest !== body.exclusion_policy_digest ||
        result.selectedProtocol < requestedProtocol.minimum ||
        result.selectedProtocol > requestedProtocol.maximum) {
      throw new ApiError(200, "malformed_response");
    }
    return result;
  }
}

export function constructWorkspaceSyncManager(owner: ClientPort): WorkspaceSyncManager {
  return new WorkspaceSyncManagerImplementation(owner);
}
