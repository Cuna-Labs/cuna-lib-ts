import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

// The pre-rename organisation is unclaimed on GitHub: every surviving reference
// resolves only while GitHub's rename redirect exists, and that redirect retires
// the moment anyone claims the name. The token is assembled from parts so that
// this guard never matches itself.
const OLD_ORGANISATION = ["Runa", "Laboratories"].join("-");

// The single legitimate survivor. The canonical SDK contract is consumed as a
// digest-pinned submodule whose own approved provenance records this exact
// string; `contracts/runa-sdk-contract.provenance.json` declares
// `canonical_repository` under the old organisation and is immutable at the pin.
// Re-pointing our expectation at the new organisation turns the currently
// passing contract gate into `canonical-approval-missing`. This is an accepting
// surface over frozen evidence: it may never be narrowed.
const FROZEN_CONTRACT_REPOSITORY = `${OLD_ORGANISATION}/runa-sdk-contract`;

const trackedFiles = () => execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
}).split("\0").filter(Boolean);

test("no asserting reference to the pre-rename organisation survives", async () => {
  const offenders = [];
  const carriers = [];
  for (const file of trackedFiles()) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(OLD_ORGANISATION)) continue;
    let carried = false;
    for (let at = text.indexOf(OLD_ORGANISATION); at !== -1;
      at = text.indexOf(OLD_ORGANISATION, at + 1)) {
      // A reference is permitted only when it names the frozen canonical
      // contract. Regex literals escape the separator, so accept both forms.
      const tail = text.slice(at + OLD_ORGANISATION.length);
      if (tail.startsWith("/runa-sdk-contract") ||
        tail.startsWith("\\/runa-sdk-contract")) { carried = true; continue; }
      const line = text.slice(0, at).split("\n").length;
      offenders.push(`${file}:${line}`);
    }
    if (carried) carriers.push(file);
  }
  assert.deepEqual(offenders, [],
    `Asserting references to the unclaimed organisation must name ${
      "Cuna-Labs"} instead.`);

  // Never narrow the accepting surface: the frozen contract identity must still
  // be present, or historical contract approval stops verifying.
  assert.deepEqual(carriers.sort(), [
    "scripts/canonical-contract-identity.mjs",
    "scripts/release-manifest-core.mjs",
    "scripts/verify-contract.mjs",
    "test/canonical-contract-identity.test.mjs",
  ], "The frozen canonical-contract identity was added to or removed from a file.");
});

test("the release trust anchor names repositories the organisation controls", async () => {
  const policy = JSON.parse(await readFile(".runa/release-policy.json", "utf8"));
  assert.equal(policy.sourceControl.repository, "Cuna-Labs/cuna-lib-ts");
  assert.equal(policy.releaseAuthority.authority.repository,
    "Cuna-Labs/cuna-release-authority");
  assert.equal(policy.trustedPublisher.organization, "Cuna-Labs");
  assert.equal(policy.trustedPublisher.repository, "cuna-lib-ts");
  assert.equal(policy.trustedPublisher.subject,
    "repo:Cuna-Labs/cuna-lib-ts:environment:npm");

  // The frozen contract identity is deliberately excluded from that rule.
  assert.equal(FROZEN_CONTRACT_REPOSITORY.startsWith(`${OLD_ORGANISATION}/`), true);
});
