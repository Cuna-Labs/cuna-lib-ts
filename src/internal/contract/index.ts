import { GENERATED_OPERATIONS } from "./generated/operation-metadata.js";

const CAPABILITIES_GET = Object.freeze({
  hasRequestBody: false,
  method: "GET",
  operationKey: "capabilities.get",
  pathParameters: [],
  pathTemplate: "/v1/capabilities",
  successStatus: 200,
} as const);

// Handwritten exact projection of infra/contracts/runa-api.openapi.json
// SHA-256 2fdc0a74c3125ed76295c91c9ea8d1e8b55ac9cbe98ea6a353ac976d02279978.
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
} as const);

// The generated root remains bound to its approved PRD-002 snapshot. This
// additive descriptor is bound to infra OpenAPI contract 1.2.0.
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
  | "capability-snapshot"
  | "exec"
  | "me"
  | "open"
  | "records"
  | "session"
  | "sessions";

export type OperationDescriptor = CanonicalOperationDescriptor & {
  readonly responseKind: ResponseKind;
};

// The canonical contract owns transport metadata. This private bridge only
// selects the existing handwritten decoder for each canonical operation.
const RESPONSE_KINDS = Object.freeze({
  "capabilities.get": "capability-snapshot",
  "agentSessions.create": "agent-session",
  "agentSessions.get": "agent-session",
  "agentSessions.list": "agent-session-page",
  "agentSessions.rename": "agent-session",
  "agentSessions.terminate": "agent-session",
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
