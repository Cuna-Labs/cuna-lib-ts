import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const OPENAPI_SHA256 = "66ba7497ec55b60236a0ccd036aab593523ef3819036009518465fcf474ef0aa";
const PROJECTION_SHA256 = "693dec9fd0d00fb541b4238e47d8f6bbd5211e4f18dcd133ae60b58462b44089";
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
  assert.equal(Object.keys(projection.schemas).length, 51);
  assert.equal(referencedSchemas.size, 47);
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
