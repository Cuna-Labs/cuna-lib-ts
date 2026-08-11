import { ApiError } from "./errors.js";
import type { ClientPort } from "./internal/client-port.js";

export interface WorkspaceBindingCreateRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly localInstanceId: string;
  readonly machineId: string;
  readonly exclusionPolicyDigest: string;
  readonly excludedPrefixes: readonly string[];
}

export interface WorkspaceBindingIdentity {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly localInstanceId: string;
  readonly machineId: string;
  readonly exclusionPolicyDigest: string;
}

export interface WorkspaceBinding extends WorkspaceBindingIdentity {
  readonly bindingId: string;
  readonly remoteRoot: string;
  readonly activeGeneration: number;
  readonly activeManifestRoot: string;
  readonly bindingEpoch: number;
  readonly minimumReader: number;
  readonly minimumWriter: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceBindingsManager {
  /** Create, replay, or exactly adopt one canonical workspace binding. */
  create(
    request: WorkspaceBindingCreateRequest,
    idempotencyKey: string,
  ): Promise<WorkspaceBinding>;

  /** Read one exact owned binding using its complete public identity. */
  get(
    bindingId: string,
    identity: WorkspaceBindingIdentity,
  ): Promise<WorkspaceBinding>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[\x21-\x7e]{8,128}$/u;

function record(value: unknown): globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid workspace binding request.");
  }
  return value as globalThis.Record<string, unknown>;
}

function exactKeys(
  value: globalThis.Record<string, unknown>,
  expected: readonly string[],
): void {
  if (Object.keys(value).some((name) => !expected.includes(name)) ||
      expected.some((name) => !Object.hasOwn(value, name))) {
    throw new TypeError("Invalid workspace binding request.");
  }
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError("Invalid workspace binding request.");
  }
  return value;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY.test(value)) {
    throw new TypeError("The Cuna idempotency key is invalid.");
  }
  return value;
}

function canonicalPrefix(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 ||
      value.startsWith("/") || value.startsWith("\\") || value.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(value) ||
      value.split("/").some((part) => part === "" || part === "." || part === "..") ||
      /^[a-zA-Z]:/u.test(value)) {
    throw new TypeError("Invalid workspace binding request.");
  }
  return value;
}

function identity(value: unknown): WorkspaceBindingIdentity {
  const source = record(value);
  exactKeys(source, [
    "workspaceId", "projectId", "localInstanceId", "machineId",
    "exclusionPolicyDigest",
  ]);
  for (const name of ["workspaceId", "projectId", "localInstanceId", "machineId"] as const) {
    if (typeof source[name] !== "string" || !UUID.test(source[name])) {
      throw new TypeError("Invalid workspace binding request.");
    }
  }
  return Object.freeze({
    workspaceId: source.workspaceId as string,
    projectId: source.projectId as string,
    localInstanceId: source.localInstanceId as string,
    machineId: source.machineId as string,
    exclusionPolicyDigest: digest(source.exclusionPolicyDigest),
  });
}

function assertIdentity(
  actual: WorkspaceBinding,
  expected: WorkspaceBindingIdentity,
): void {
  if (actual.workspaceId !== expected.workspaceId ||
      actual.projectId !== expected.projectId ||
      actual.localInstanceId !== expected.localInstanceId ||
      actual.machineId !== expected.machineId ||
      actual.exclusionPolicyDigest !== expected.exclusionPolicyDigest) {
    throw new ApiError(200, "malformed_response");
  }
}

class WorkspaceBindingsManagerImplementation implements WorkspaceBindingsManager {
  constructor(private readonly owner: ClientPort) {}

  async create(
    request: WorkspaceBindingCreateRequest,
    key: string,
  ): Promise<WorkspaceBinding> {
    const source = record(request);
    exactKeys(source, [
      "workspaceId", "projectId", "localInstanceId", "machineId",
      "exclusionPolicyDigest", "excludedPrefixes",
    ]);
    const expected = identity({
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      localInstanceId: source.localInstanceId,
      machineId: source.machineId,
      exclusionPolicyDigest: source.exclusionPolicyDigest,
    });
    if (!Array.isArray(source.excludedPrefixes) || source.excludedPrefixes.length > 10_000) {
      throw new TypeError("Invalid workspace binding request.");
    }
    const excludedPrefixes = source.excludedPrefixes.map(canonicalPrefix);
    if (new Set(excludedPrefixes).size !== excludedPrefixes.length) {
      throw new TypeError("Invalid workspace binding request.");
    }
    const result = await this.owner.invoke("workspaceBindings.create", {
      idempotencyKey: idempotencyKey(key),
      body: Object.freeze({
        workspace_id: expected.workspaceId,
        project_id: expected.projectId,
        local_instance_id: expected.localInstanceId,
        machine_id: expected.machineId,
        exclusion_policy_digest: expected.exclusionPolicyDigest,
        excluded_prefixes: Object.freeze([...excludedPrefixes]),
      }),
    }) as WorkspaceBinding;
    assertIdentity(result, expected);
    return result;
  }

  async get(
    bindingId: string,
    expectedIdentity: WorkspaceBindingIdentity,
  ): Promise<WorkspaceBinding> {
    if (typeof bindingId !== "string" || !UUID.test(bindingId)) {
      throw new TypeError("Invalid workspace binding request.");
    }
    const expected = identity(expectedIdentity);
    const result = await this.owner.invoke("workspaceBindings.get", {
      bindingId,
      query: Object.freeze({
        workspace_id: expected.workspaceId,
        project_id: expected.projectId,
        local_instance_id: expected.localInstanceId,
        machine_id: expected.machineId,
        exclusion_policy_digest: expected.exclusionPolicyDigest,
      }),
    }) as WorkspaceBinding;
    if (result.bindingId !== bindingId) throw new ApiError(200, "malformed_response");
    assertIdentity(result, expected);
    return result;
  }
}

export function constructWorkspaceBindingsManager(
  owner: ClientPort,
): WorkspaceBindingsManager {
  return new WorkspaceBindingsManagerImplementation(owner);
}
