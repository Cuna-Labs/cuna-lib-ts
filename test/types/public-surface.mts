import { stderrText, stdoutText } from "../../src/index.js";
import type {
  AgentAuthenticationStatus,
  AssignedWorkspace,
  CapabilitySnapshot,
  Problem,
  TerminalConnectionCapability,
  TerminalConnectionCreateOptions,
  TerminalConnectionGrant,
  Workspace,
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
type AgentAuthenticationStatusIsClosed = Assert<
  Equal<keyof AgentAuthenticationStatus, "agent" | "method" | "state">
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
type TerminalConnectionCapabilityIsClosed = Assert<
  Equal<keyof TerminalConnectionCapability, "name" | "availability">
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
  AgentAuthenticationStatusIsClosed,
  CapabilitySnapshotIsClosed,
  ProblemIsClosed,
  AssignedDiscriminantIsLiteral,
  StderrHelperContract,
  StdoutHelperContract,
  TerminalConnectionCapabilityIsClosed,
  TerminalConnectionCreateOptionsIsClosed,
  TerminalConnectionGrantIsClosed,
  WorkspaceDiscriminantIsClosed
};
