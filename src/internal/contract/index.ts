import { GENERATED_OPERATIONS } from "./generated/operation-metadata.js";

const CAPABILITIES_GET = Object.freeze({
  hasRequestBody: false,
  method: "GET",
  operationKey: "capabilities.get",
  pathParameters: [],
  pathTemplate: "/v1/capabilities",
  successStatus: 200,
} as const);

// The generated root remains bound to its approved PRD-002 snapshot. This
// additive descriptor is bound to infra OpenAPI contract 1.1.0 (08583d2).
const CANONICAL_OPERATIONS = Object.freeze({
  "capabilities.get": CAPABILITIES_GET,
  ...GENERATED_OPERATIONS,
});

export type OperationKey = keyof typeof CANONICAL_OPERATIONS;
type CanonicalOperationDescriptor =
  (typeof CANONICAL_OPERATIONS)[OperationKey];
type ResponseKind =
  | "acknowledgement"
  | "agent-authentication-status"
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
