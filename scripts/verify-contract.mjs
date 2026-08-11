import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const CANONICAL_CONTRACT_COMMIT = "cc8b1ad646c085695fc35e4b44e7ed618e41e1ff";
const CANONICAL_SNAPSHOT_SHA256 = "e7416b1e20843e0a96290428419e1e137d8189e30b7c82c62b011978516126bd";
const CANONICAL_ARTIFACT_MANIFEST_SHA256 = "750007695eca5a9d246aa9c3ef56fc288fe4e3ba6a9be7f666462e166e850e60";
const CANONICAL_PROJECTION_SHA256 = "e333edba4405e26315255ef84d1dd91ea946b30af1e64e5eff0bbb8b8326ce8b";
const CANONICAL_SDK_PROJECTION_SHA256 = "145dc0f4ff47d3721d37f475c1c859e6797d1dd08c74736de414a80d69150cbe";
const CANONICAL_GENERATOR_SHA256 = "879fbef4d654c1f7769e1724c065133d6744bbda6b913d5bd3cd5b8104ce31e4";
const ACCEPTED_CANONICAL_REPOSITORIES = new Set([
  "Cuna-Labs/cuna-sdk-contract",
]);
const generatedRoot = path.resolve("src/internal/contract/generated");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function run(file, args, options = {}) {
  try {
    return await execute(file, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || `${file} ${args.join(" ")} failed.`, { cause: error });
  }
}

function fail(category) {
  console.error(JSON.stringify({
    category,
    requirement: "R-056-20",
    verdict: "blocked",
  }));
  process.exitCode = 1;
}

async function exactGeneratedFiles(manifest, root) {
  const entries = manifest.files;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  const expected = new Map();
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        typeof entry.path !== "string" || path.basename(entry.path) !== entry.path ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256) || expected.has(entry.path)) return false;
    expected.set(entry.path, entry);
  }
  const actual = (await readdir(root)).sort();
  const declared = [...expected.keys(), "generated-manifest.json"].sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared)) return false;
  for (const [name, entry] of expected) {
    const bytes = await readFile(path.join(root, name));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) return false;
  }
  return true;
}

async function main() {
  if (process.versions.node.split(".")[0] !== "24") return fail("canonical-node-version-mismatch");

  const staged = await run("git", ["ls-files", "--stage", "--", "contracts"]);
  const [mode, commit] = staged.stdout.trim().split(/\s+/u);
  if (mode !== "160000" || commit !== CANONICAL_CONTRACT_COMMIT) {
    return fail("canonical-gitlink-mismatch");
  }
  const [head, dirty] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], { cwd: "contracts" }),
    run("git", ["status", "--porcelain"], { cwd: "contracts" }),
  ]);
  if (head.stdout.trim() !== CANONICAL_CONTRACT_COMMIT || dirty.stdout.trim() !== "") {
    return fail("canonical-checkout-mismatch");
  }
  try {
    await run(process.execPath, ["tools/verify-contract.mjs"], { cwd: "contracts" });
  } catch {
    return fail("canonical-currentness-failed");
  }

  const snapshotBytes = await readFile("contracts/runa-sdk-contract.snapshot.json");
  const artifactManifestBytes = await readFile("contracts/artifact-manifest.json");
  const projectionBytes = await readFile("contracts/runa-sdk-contract.prd002-projection.json");
  const sdkProjectionBytes = await readFile("contracts/runa-sdk.projection.json");
  const generatorBytes = await readFile("contracts/tools/runa-contract-generator.mjs");
  if (sha256(snapshotBytes) !== CANONICAL_SNAPSHOT_SHA256) return fail("snapshot-digest-mismatch");
  if (sha256(artifactManifestBytes) !== CANONICAL_ARTIFACT_MANIFEST_SHA256) return fail("artifact-manifest-digest-mismatch");
  if (sha256(projectionBytes) !== CANONICAL_PROJECTION_SHA256) return fail("projection-digest-mismatch");
  if (sha256(sdkProjectionBytes) !== CANONICAL_SDK_PROJECTION_SHA256) {
    return fail("sdk-projection-digest-mismatch");
  }
  if (sha256(generatorBytes) !== CANONICAL_GENERATOR_SHA256) return fail("generator-digest-mismatch");

  const provenance = JSON.parse(await readFile(
    "contracts/runa-sdk-contract.provenance.json", "utf8",
  ));
  if (provenance.schema_version !== 3 || provenance.status !== "BLOCKED" ||
      !ACCEPTED_CANONICAL_REPOSITORIES.has(provenance.canonical_repository) ||
      provenance.canonical_ref !== null || provenance.source_revision !== null ||
      provenance.approval_reference !== null ||
      typeof provenance.reason !== "string" || provenance.reason.length === 0 ||
      provenance.artifacts?.snapshot?.sha256 !== CANONICAL_SNAPSHOT_SHA256 ||
      provenance.artifacts?.contract_projection?.sha256 !== CANONICAL_PROJECTION_SHA256 ||
      provenance.generator_identity?.path !== "tools/runa-contract-generator.mjs" ||
      provenance.generator_identity?.node_major !== 24 ||
      provenance.generator_identity?.sha256 !== CANONICAL_GENERATOR_SHA256 ||
      provenance.generator_identity?.git_commit_sha !== null ||
      provenance.baseline_extractor_identity?.git_commit_sha !== null) {
    return fail("canonical-blocked-provenance-invalid");
  }

  const manifestBytes = await readFile(path.join(generatedRoot, "generated-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const expectedGenerator = {
    path: provenance.generator_identity.path,
    sha256: provenance.generator_identity.sha256,
    version: provenance.generator_identity.version,
  };
  if (manifest.schema_version !== 1 || manifest.language !== "typescript" ||
      manifest.snapshot?.path !== "runa-sdk-contract.snapshot.json" ||
      manifest.snapshot?.sha256 !== CANONICAL_SNAPSHOT_SHA256 ||
      JSON.stringify(manifest.generator) !== JSON.stringify(expectedGenerator) ||
      manifest.projection?.path !== "runa-sdk.projection.json" ||
      manifest.projection?.sha256 !== CANONICAL_SDK_PROJECTION_SHA256 ||
      manifest.projection?.version !== "1.7.0" ||
      !(await exactGeneratedFiles(manifest, generatedRoot))) {
    return fail("generated-manifest-mismatch");
  }

  const temporary = await mkdtemp(path.join(tmpdir(), "runa-typescript-contract-"));
  try {
    const cleanRoot = path.join(temporary, "src", "internal", "contract", "generated");
    try {
      await run(process.execPath, [
        path.resolve("contracts/tools/runa-contract-generator.mjs"),
        "--language", "typescript",
        "--output", cleanRoot,
      ]);
    } catch {
      return fail("canonical-regeneration-failed");
    }
    const regenerated = (await readdir(cleanRoot)).sort();
    const committed = (await readdir(generatedRoot)).sort();
    if (JSON.stringify(regenerated) !== JSON.stringify(committed)) {
      return fail("canonical-regeneration-file-set-drift");
    }
    for (const name of committed) {
      const [left, right] = await Promise.all([
        readFile(path.join(generatedRoot, name)),
        readFile(path.join(cleanRoot, name)),
      ]);
      if (!left.equals(right)) return fail("canonical-regeneration-drift");
    }

    const attestationPath = path.join(temporary, "typescript-contract-attestation.json");
    let attestationBlocked = false;
    try {
      await run(process.execPath, [
        path.resolve("contracts/tools/emit-release-attestation.mjs"),
        "--language", "typescript",
        "--generated-root", cleanRoot,
        "--source-revision", CANONICAL_CONTRACT_COMMIT,
        "--output", attestationPath,
      ]);
    } catch (error) {
      attestationBlocked = /release attestation blocked by detached provenance/u
        .test(String(error.message));
    }
    if (!attestationBlocked) return fail("blocked-provenance-emitted-attestation");
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }

  console.log(JSON.stringify({
    artifactManifestSha256: CANONICAL_ARTIFACT_MANIFEST_SHA256,
    contractCommit: CANONICAL_CONTRACT_COMMIT,
    generatorSha256: CANONICAL_GENERATOR_SHA256,
    provenanceStatus: "BLOCKED",
    releaseEligible: false,
    requirement: "R-056-20",
    snapshotSha256: CANONICAL_SNAPSHOT_SHA256,
    sdkProjectionSha256: CANONICAL_SDK_PROJECTION_SHA256,
    verdict: "pass",
  }));
}

await main();
