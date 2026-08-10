export { Runa, Runa as Cuna } from "./client.js";
export { Session } from "./session.js";
export {
  ApiError,
  CommandError,
  ConfigError,
  RunaError,
  RunaError as CunaError,
} from "./errors.js";
export { stderrText, stdoutText } from "./text.js";

export type {
  AgentSession,
  AgentSessionAuth,
  AgentSessionAuthEvidenceClass,
  AgentSessionAuthMode,
  AgentSessionAuthState,
  AgentSessionCreateOptions,
  AgentSessionDesiredState,
  AgentSessionListOptions,
  AgentSessionPage,
  AgentSessionProcessState,
  AgentSessionRequestState,
  AgentSessionsManager,
  TerminalConnectionCapability,
  TerminalConnectionCapabilityAvailability,
  TerminalConnectionCapabilityName,
  TerminalConnectionCreateOptions,
  TerminalConnectionGrant,
  TerminalConnectionProtocol,
} from "./agent-sessions.js";

export type { ApiProblem, Problem, ProblemAction } from "./errors.js";

export type { CapabilitiesManager, RecordsManager, SessionsManager } from "./client.js";
export type { MachineCreateRequest, MachineCreatesManager } from "./machine-creates.js";
export type {
  WorkspaceBinding,
  WorkspaceBindingCreateRequest,
  WorkspaceBindingIdentity,
  WorkspaceBindingsManager,
} from "./workspace-bindings.js";
export type {
  WorkspaceSyncBeginRequest,
  WorkspaceSyncCapability,
  WorkspaceSyncChangeOptions,
  WorkspaceSyncChangeItem,
  WorkspaceSyncChangePage,
  WorkspaceSyncChunkReceipt,
  WorkspaceSyncChunkReference,
  WorkspaceSyncCommitReceipt,
  WorkspaceSyncCommitRequest,
  WorkspaceSyncEnvelope,
  WorkspaceSyncManager,
  WorkspaceSyncManifestEntry,
  WorkspaceSyncManifestPageRequest,
  WorkspaceSyncManifestReceipt,
  WorkspaceSyncProtocol,
  WorkspaceSyncProtocolRange,
  WorkspaceSyncProblem,
  WorkspaceSyncReconcileReceipt,
  WorkspaceSyncReconcileRequest,
  WorkspaceSyncSession,
} from "./workspace-sync.js";
export type {
  Acknowledgement,
  AssignedWorkspace,
  Capability,
  CapabilityAvailability,
  CapabilityInteraction,
  CapabilityMutationClass,
  CapabilityScope,
  CapabilitySnapshot,
  CapabilitySubjectScope,
  CapabilitySurface,
  EstimatedUsage,
  ExecOptions,
  ExecResult,
  Me,
  OpaqueWireValue,
  OpenSessionResult,
  OutboundPolicy,
  OutboundPolicyMode,
  Record,
  RunaConfig,
  RunaConfig as CunaConfig,
  SessionAgent,
  SessionCreateOptions,
  SessionSnapshot,
  SessionStatus,
  UnassignedWorkspace,
  Workspace,
} from "./types.js";
