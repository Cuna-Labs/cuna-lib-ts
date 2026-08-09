import { GENERATED_OPERATIONS } from "./generated/operation-metadata.js";

const CAPABILITIES_GET = Object.freeze({
  hasRequestBody: false,
  method: "GET",
  operationKey: "capabilities.get",
  pathParameters: [],
  pathTemplate: "/v1/capabilities",
  successStatus: 200,
} as const);

// Handwritten exact projection of infra/contracts/runa-api.openapi.json 1.4.0.
// Canonical artifact SHA-256 7206b5413e2007651b26cda11770cd028b20a3b533a2228465f46f3ed0fc662d;
// SDK projection SHA-256 065c1588db506ffee69cda9ae5fa5bd5398bef9305e4de18c49a1a0e19abf6c4.
const AGENT_SESSION_OPERATIONS = Object.freeze({
  "agentSessions.list": Object.freeze({
    hasRequestBody: false,
    method: "GET",
    operationKey: "agentSessions.list",
    pathParameters: ["id"],
    pathTemplate: "/v1/sessions/:id/agent-sessions",
    successStatus: 200,
  }),
  "agentSessions.create": Object.freeze({
    hasRequestBody: true,
    method: "POST",
    operationKey: "agentSessions.create",
    pathParameters: ["id"],
    pathTemplate: "/v1/sessions/:id/agent-sessions",
    successStatus: 201,
  }),
  "agentSessions.get": Object.freeze({
    hasRequestBody: false,
    method: "GET",
    operationKey: "agentSessions.get",
    pathParameters: ["id"],
    pathTemplate: "/v1/agent-sessions/:id",
    successStatus: 200,
  }),
  "agentSessions.rename": Object.freeze({
    hasRequestBody: true,
    method: "PATCH",
    operationKey: "agentSessions.rename",
    pathParameters: ["id"],
    pathTemplate: "/v1/agent-sessions/:id",
    successStatus: 200,
  }),
  "agentSessions.terminate": Object.freeze({
    hasRequestBody: false,
    method: "POST",
    operationKey: "agentSessions.terminate",
    pathParameters: ["id"],
    pathTemplate: "/v1/agent-sessions/:id/terminate",
    successStatus: 200,
  }),
  "agentSessions.createTerminalConnection": Object.freeze({
    hasRequestBody: true,
    method: "POST",
    operationKey: "agentSessions.createTerminalConnection",
    pathParameters: ["id"],
    pathTemplate: "/v1/agent-sessions/:id/terminal-connections",
    successStatus: 201,
  }),
} as const);

// The generated root remains bound to its approved PRD-002 snapshot. These
// additive descriptors are bound to the separately digested Infra projection.
const CANONICAL_OPERATIONS = Object.freeze({
  "capabilities.get": CAPABILITIES_GET,
  ...AGENT_SESSION_OPERATIONS,
  ...GENERATED_OPERATIONS,
});

export type OperationKey = keyof typeof CANONICAL_OPERATIONS;
type CanonicalOperationDescriptor =
  (typeof CANONICAL_OPERATIONS)[OperationKey];
type ResponseKind =
  | "acknowledgement"
  | "agent-authentication-status"
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
  "sessions.agentAuth": "agent-authentication-status",
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
