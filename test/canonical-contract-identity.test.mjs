import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

import {
  CANONICAL_CONTRACT_REPOSITORY,
  loadCanonicalContractIdentity,
  validateAuthorityContractProvenance,
} from "../scripts/canonical-contract-identity.mjs";

test("release identity rejects the exact unapproved canonical contract", async () => {
  await assert.rejects(
    loadCanonicalContractIdentity(),
    /Expected values to be strictly equal:\s*\+ actual - expected[\s\S]*BLOCKED[\s\S]*APPROVED/u,
  );
});

test("release trust is pinned to one accepted Ed25519 root for every authority role", async () => {
  const policy = JSON.parse(await readFile("governance/release-trust.json", "utf8"));
  const expectedRoles = [
    "acceptance-results", "approval", "cross-language", "external-interfaces",
    "publication", "release-authority", "repository-controls", "sbom-validation",
    "version-classification",
  ];
  assert.equal(policy.schema_version, 1);
  assert.equal(policy.maximum_validity_ms, 3_600_000);
  assert.deepEqual(policy.keys.map((key) => key.role).sort(), expectedRoles);
  assert(policy.keys.every((key) =>
    key.key_id === "runa-release-authority-2026-08-02-v1" &&
    key.algorithm === "Ed25519" &&
    key.public_key_pem === policy.keys[0].public_key_pem
  ));
  assert.equal(
    createHash("sha256").update(policy.keys[0].public_key_pem).digest("hex"),
    "fe7d7259281d512d4f17ef1a0afed3e9b613105ab1a3304e129130b194aa8000",
  );
});

test("contract authority accepts only the active Cuna identity", () => {
  const identity = {
    approvedCheckout: "b".repeat(40),
    canonicalContractSha256: "c".repeat(64),
    canonicalRef: "a".repeat(40),
    openapiSha256: "d".repeat(64),
    projectionSha256: "e".repeat(64),
  };
  const provenance = (repository) => ({
    schema_version: 1,
    status: "APPROVED",
    canonical_repository: repository,
    canonical_ref: identity.canonicalRef,
    approval_sha: identity.approvedCheckout,
    approver_identity: `https://github.com/${repository}`,
    approved_at: "2026-08-09T00:00:00.000Z",
    canonical_contract_sha256: identity.canonicalContractSha256,
    projection_sha256: identity.projectionSha256,
    openapi_sha256: identity.openapiSha256,
  });

  assert.equal(validateAuthorityContractProvenance(
    provenance(CANONICAL_CONTRACT_REPOSITORY), identity,
  ), true);
  assert.throws(() => validateAuthorityContractProvenance(
    provenance("Runa-Laboratories/runa-sdk-contract"), identity,
  ), /unaccepted contract repository/u);
  assert.throws(() => validateAuthorityContractProvenance(
    provenance("attacker/sdk-contract"), identity,
  ), /unaccepted contract repository/u);
  const mismatchedApprover = provenance(CANONICAL_CONTRACT_REPOSITORY);
  mismatchedApprover.approver_identity =
    "https://github.com/Runa-Laboratories/runa-sdk-contract";
  assert.throws(() => validateAuthorityContractProvenance(
    mismatchedApprover, identity,
  ));
});
