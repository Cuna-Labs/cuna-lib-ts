import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const OPENAPI_SHA256 = "a490e74c94b747b4a61022711bb5df63f5dfb8a9e673de1cc0c477b54a038208";
const PROJECTION_SHA256 = "2721f5b7de5a033e5cc34dc6efb53ddf74e6110cd71168c0075bdb5679063791";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("TypeScript workspace authority is frozen to the exact OpenAPI 1.7 artifacts", async () => {
  const [openapiBytes, projectionBytes] = await Promise.all([
    readFile("contracts/runa-api.openapi.json"),
    readFile("contracts/runa-sdk.projection.json"),
  ]);
  assert.equal(sha256(openapiBytes), OPENAPI_SHA256);
  assert.equal(sha256(projectionBytes), PROJECTION_SHA256);
  const openapi = JSON.parse(openapiBytes);
  const projection = JSON.parse(projectionBytes);
  assert.equal(openapi.info.version, "1.7.0");
  assert.equal(projection.contractVersion, "1.7.0");
  for (const schemaName of ["AgentSession", "AgentSessionCreate"]) {
    const schema = openapi.components.schemas[schemaName];
    assert.equal(Object.hasOwn(schema.properties, "workspace_binding_id"), true);
    assert.equal(Object.hasOwn(schema.properties, "workspace_id"), false);
  }
  assert.equal(
    openapi.components.schemas.AgentSessionCreate.required.includes("workspace_binding_id"),
    true,
  );
  const referencedSchemas = new Set();
  const collectReferences = (value) => {
    if (value === null || typeof value !== "object") return;
    if (typeof value.$ref === "string" &&
        value.$ref.startsWith("#/components/schemas/")) {
      referencedSchemas.add(value.$ref.split("/").at(-1));
    }
    for (const child of Object.values(value)) collectReferences(child);
  };
  collectReferences(projection.operations);
  collectReferences(projection.schemas);
  assert.equal(Object.keys(projection.schemas).length, 50);
  assert.equal(referencedSchemas.size, 46);
  assert.deepEqual(
    [...referencedSchemas].filter((name) => !Object.hasOwn(projection.schemas, name)),
    [],
  );

  assert.deepEqual(projection.operations["workspaceBindings.create"], {
    method: "POST",
    path: "/v1/workspace-bindings",
    requestBody: { $ref: "#/components/schemas/WorkspaceBindingCreate" },
    response: openapi.paths["/v1/workspace-bindings"].post.responses["200"],
    successStatus: 200,
  });
  assert.deepEqual(projection.operations["workspaceBindings.get"], {
    method: "GET",
    path: "/v1/workspace-bindings/{binding_id}",
    requestBody: null,
    response: openapi.paths["/v1/workspace-bindings/{binding_id}"].get.responses["200"],
    successStatus: 200,
  });

  const begin = openapi.paths["/v1/workspaces/{id}/sync-sessions"].post;
  const reconcile = openapi.paths["/v1/workspaces/{id}/reconcile"].post;
  for (const operation of [begin, reconcile]) {
    const schemaName = operation.requestBody.content[
      "application/json; charset=utf-8"
    ].schema.$ref.split("/").at(-1);
    const schema = openapi.components.schemas[schemaName];
    assert(schema.required.includes("workspace_binding_id"));
    assert.equal(schema.properties.workspace_binding_id.$ref, "#/components/schemas/Uuid");
  }
  for (const operationKey of [
    "workspaces.sync.begin",
    "workspaces.sync.negotiate",
    "workspaces.sync.chunk",
    "workspaces.sync.chunkDownload",
    "workspaces.sync.commit",
    "workspaces.sync.changes",
    "workspaces.sync.reconcile",
  ]) {
    const operation = Object.values(openapi.paths)
      .flatMap((path) => Object.values(path))
      .find((candidate) => candidate?.operationId === operationKey);
    assert.equal(operation.responses.default.$ref, "#/components/responses/WorkspaceSyncProblem");
  }

  const publicWorkspaceSurface = JSON.stringify({
    WorkspaceBinding: openapi.components.schemas.WorkspaceBinding,
    WorkspaceBindingCreate: openapi.components.schemas.WorkspaceBindingCreate,
    WorkspaceSyncBegin: openapi.components.schemas.WorkspaceSyncBegin,
    WorkspaceSyncReconcile: openapi.components.schemas.WorkspaceSyncReconcile,
    operations: Object.fromEntries(Object.entries(projection.operations)
      .filter(([name]) => name.startsWith("workspace"))),
  });
  assert.equal(/sync_namespace|internal_provider/iu.test(publicWorkspaceSurface), false);
});
