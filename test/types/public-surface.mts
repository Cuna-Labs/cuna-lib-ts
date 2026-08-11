import { stderrText, stdoutText } from "../../src/index.js";
import type {
  AgentSession,
  AgentSessionCreateOptions,
  AssignedWorkspace,
  CapabilitySnapshot,
  Problem,
  TerminalConnectionCapability,
  TerminalConnectionCreateOptions,
  TerminalConnectionGrant,
  Workspace,
  WorkspaceBinding,
  WorkspaceBindingCreateRequest,
  WorkspaceSyncBeginRequest,
  WorkspaceSyncChangeItem,
  WorkspaceSyncProblem,
} from "../../src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type AssignedDiscriminantIsLiteral = Assert<
  Equal<AssignedWorkspace["assigned"], true>
>;
type WorkspaceDiscriminantIsClosed = Assert<
  Equal<Workspace["assigned"], true | false>
>;
type StdoutHelperContract = Assert<
  Equal<ReturnType<typeof stdoutText>, string | undefined>
>;
type StderrHelperContract = Assert<
  Equal<ReturnType<typeof stderrText>, string | undefined>
>;
type CapabilitySnapshotIsClosed = Assert<
  Equal<
    keyof CapabilitySnapshot,
    | "schemaVersion"
    | "subjectScope"
    | "subjectId"
    | "observedAt"
    | "expiresAt"
    | "etag"
    | "capabilities"
  >
>;
type ProblemIsClosed = Assert<
  Equal<
    keyof Problem,
    | "type"
    | "title"
    | "status"
    | "code"
    | "requestId"
    | "retryable"
    | "detail"
    | "action"
  >
>;
type WorkspaceBindingIsClosed = Assert<
  Equal<
    keyof WorkspaceBinding,
    | "bindingId"
    | "workspaceId"
    | "projectId"
    | "localInstanceId"
    | "machineId"
    | "remoteRoot"
    | "exclusionPolicyDigest"
    | "activeGeneration"
    | "activeManifestRoot"
    | "bindingEpoch"
    | "minimumReader"
    | "minimumWriter"
    | "createdAt"
    | "updatedAt"
  >
>;
type WorkspaceBindingCreateRequestIsClosed = Assert<
  Equal<
    keyof WorkspaceBindingCreateRequest,
    | "workspaceId"
    | "projectId"
    | "localInstanceId"
    | "machineId"
    | "exclusionPolicyDigest"
    | "excludedPrefixes"
  >
>;
type WorkspaceSyncBeginSeparatesAuthorities = Assert<
  Equal<keyof WorkspaceSyncBeginRequest,
    | "workspaceBindingId"
    | "machineId"
    | "baseGeneration"
    | "exclusionPolicyDigest"
    | "protocol"
    | "minimumReader"
    | "minimumWriter"
  >
>;
type WorkspaceSyncChangeItemIsTyped = Assert<
  Equal<WorkspaceSyncChangeItem["operation"], "revision" | "upsert" | "delete">
>;
type WorkspaceSyncProblemIsSpecialized = Assert<
  Equal<WorkspaceSyncProblem["selectedProtocol"], 1 | 2 | null>
>;
type TerminalConnectionCapabilityIsClosed = Assert<
  Equal<keyof TerminalConnectionCapability, "name" | "availability">
>;
type AgentSessionBindingNameIsUnambiguous = Assert<
  Equal<
    Extract<keyof AgentSession, "workspaceBindingId" | "workspaceId">,
    "workspaceBindingId"
  >
>;
type AgentSessionCreateBindingNameIsUnambiguous = Assert<
  Equal<
    Extract<keyof AgentSessionCreateOptions, "workspaceBindingId" | "workspaceId">,
    "workspaceBindingId"
  >
>;
type TerminalConnectionCreateOptionsIsClosed = Assert<
  Equal<
    keyof TerminalConnectionCreateOptions,
    "idempotencyKey" | "clientInstanceId" | "protocol" | "resumeHandle"
  >
>;
type TerminalConnectionGrantIsClosed = Assert<
  Equal<
    keyof TerminalConnectionGrant,
    | "terminalSessionId"
    | "resumeHandle"
    | "connectUrl"
    | "connectToken"
    | "protocol"
    | "capabilities"
    | "expiresAt"
  >
>;

export type {
  AgentSessionBindingNameIsUnambiguous,
  AgentSessionCreateBindingNameIsUnambiguous,
  CapabilitySnapshotIsClosed,
  ProblemIsClosed,
  WorkspaceBindingCreateRequestIsClosed,
  WorkspaceBindingIsClosed,
  WorkspaceSyncBeginSeparatesAuthorities,
  WorkspaceSyncChangeItemIsTyped,
  WorkspaceSyncProblemIsSpecialized,
  AssignedDiscriminantIsLiteral,
  StderrHelperContract,
  StdoutHelperContract,
  TerminalConnectionCapabilityIsClosed,
  TerminalConnectionCreateOptionsIsClosed,
  TerminalConnectionGrantIsClosed,
  WorkspaceDiscriminantIsClosed
};
