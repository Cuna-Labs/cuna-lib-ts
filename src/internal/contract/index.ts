import { GENERATED_OPERATIONS } from "./generated/operation-metadata.js";

const CANONICAL_OPERATIONS = GENERATED_OPERATIONS;

export type OperationKey = keyof typeof CANONICAL_OPERATIONS;
type CanonicalOperationDescriptor =
  (typeof CANONICAL_OPERATIONS)[OperationKey];
type ResponseKind =
  | "acknowledgement"
  | "agent-session"
  | "agent-session-page"
  | "terminal-connection-grant"
  | "capability-snapshot"
  | "exec"
  | "me"
  | "open"
  | "records"
  | "session"
  | "sessions";
type ErrorKind = "legacy" | "problem";

export type OperationDescriptor = CanonicalOperationDescriptor & {
  readonly responseKind: ResponseKind;
  readonly errorKind: ErrorKind;
};

const PROBLEM_OPERATIONS = new Set<OperationKey>([
  "capabilities.get",
  "agentSessions.list",
  "agentSessions.create",
  "agentSessions.get",
  "agentSessions.rename",
  "agentSessions.terminate",
  "agentSessions.createTerminalConnection",
]);

// The canonical contract owns transport metadata. This private bridge only
// selects the existing handwritten decoder for each canonical operation.
const RESPONSE_KINDS = Object.freeze({
  "capabilities.get": "capability-snapshot",
  "agentSessions.create": "agent-session",
  "agentSessions.get": "agent-session",
  "agentSessions.list": "agent-session-page",
  "agentSessions.rename": "agent-session",
  "agentSessions.terminate": "agent-session",
  "agentSessions.createTerminalConnection": "terminal-connection-grant",
  "me.get": "me",
  "records.list": "records",
  "sessions.checkpoint": "acknowledgement",
  "sessions.create": "session",
  "sessions.delete": "acknowledgement",
  "sessions.exec": "exec",
  "sessions.get": "session",
  "sessions.list": "sessions",
  "sessions.open": "open",
  "sessions.pause": "session",
  "sessions.resume": "session",
  "sessions.start": "session",
  "sessions.stop": "session",
} as const satisfies Readonly<Record<OperationKey, ResponseKind>>);

const OPERATIONS = Object.freeze(Object.fromEntries(
  Object.entries(CANONICAL_OPERATIONS).map(([operationKey, descriptor]) => [
    operationKey,
    Object.freeze({
      ...descriptor,
      responseKind: RESPONSE_KINDS[operationKey as OperationKey],
      errorKind: PROBLEM_OPERATIONS.has(operationKey as OperationKey)
        ? "problem"
        : "legacy",
    }),
  ]),
)) as Readonly<Record<OperationKey, OperationDescriptor>>;

export function operationDescriptor(
  operationKey: OperationKey,
): OperationDescriptor {
  return OPERATIONS[operationKey];
}

export function operationKeys(): readonly OperationKey[] {
  return Object.freeze(Object.keys(OPERATIONS) as OperationKey[]);
}
