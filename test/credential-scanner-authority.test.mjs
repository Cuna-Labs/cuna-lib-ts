import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { WIRE_BRANDS } from "../dist/internal/wire-namespaces.js";
import {
  containsCredentialMaterial,
  credentialBrands,
  credentialFamilies,
  ignoredDirectories,
  scanCandidate,
} from "../scripts/verify-security.mjs";

/*
 * `scripts/verify-security.mjs` is the gate that refuses to ship a candidate
 * carrying a committed credential. It imported the boundary-policy predicate
 * and then wrote its own second copy of the brand list — a namespace minted in
 * one module and hunted for in another, with nothing comparing the two.
 *
 * The failure is silent and one-directional. `WIRE_BRANDS` is append-only, so
 * it grows; a hand-written copy does not. The shipped code accepts the new
 * spelling on the day it lands, the scanner does not know it exists, and a
 * credential in that spelling walks past a scan written specifically to catch
 * it. The gate then prints PASS, which is worse than printing nothing.
 *
 * Every oracle below is deliberately independent of the list it judges. A test
 * parametrized over `credentialBrands` could only ever confirm that the scanner
 * agrees with itself: revert the fix to a single-brand literal and such a test
 * loses the case that would have failed. That already happened once in the
 * Python SDK, inside the test written to prevent it. So the brand cases are
 * spelled by hand, and the two derivation checks read the AUTHORITY —
 * `WIRE_BRANDS` and the canonical contract — never the implementation's list.
 *
 * `Covers<>` in `wire-namespaces.ts` does not close this. It makes SHRINKING
 * the authority a compile error, which guards the source. A gate that copies
 * the authority instead of reading it compiles perfectly.
 *
 * Credential fixtures are assembled at run time rather than written out, or
 * this file would be the committed credential its own subject is meant to find.
 */

const BODY = "A".repeat(24);
const credential = (brand, family) => [brand, family, BODY].join("_");

/*
 * S-3's literal oracle. Position 0 is asserted by hand because a mutation that
 * merely reverses the authority's order would reverse a derived expectation
 * with it and still pass. Length is deliberately NOT asserted: appending a
 * fourth spelling must widen a detector in silence, unlike `brandedEnvNames`,
 * where order decides precedence and an append is meant to demand review.
 */
test("the scanner's brand list is the wire-brand authority, canonical spelling first", () => {
  assert.equal(credentialBrands[0], "cuna");
  assert.equal(credentialBrands[1], "runa");
  assert.deepEqual([...credentialBrands], [...WIRE_BRANDS]);
});

/*
 * Equality with the authority is satisfied just as well by a second literal
 * that happens to agree today, and that literal is exactly what rots. Absence
 * of any brand spelling is the property that cannot be faked: a DETECTOR that
 * spells no brand must have derived them.
 *
 * Scoped to the detector, with the exclusion list cut out, because the two have
 * opposite polarity. What the scanner HUNTS FOR must widen with the accept
 * list; what it REFUSES TO LOOK AT must not, or every future brand opens a new
 * blind spot. So the exclusion list is spelled, deliberately, and the cut is
 * asserted to have happened rather than assumed — a regex that silently matched
 * nothing would restore the original check and fail the moment the list is
 * spelled, which is now the correct state.
 */
test("the scanner spells no brand outside its literal exclusion list", async () => {
  const source = await readFile("scripts/verify-security.mjs", "utf8");
  const detector = source.replace(
    /export const ignoredDirectories = Object\.freeze\(\[[\s\S]*?\]\);/u,
    "",
  );
  assert.notEqual(detector, source, "the exclusion list was not located");
  const normalized = detector.toLowerCase();
  assert.equal(normalized.includes("cuna"), false, "the canonical brand is spelled in the detector");
  for (const brand of WIRE_BRANDS) {
    assert.equal(normalized.includes(brand), false, `${brand} is spelled in the detector`);
  }
});

/*
 * The exclusion list pinned to literals, because it was briefly derived from
 * `WIRE_BRANDS` and that inverted it. `WIRE_BRANDS` is an append-only ACCEPT
 * list; growing what the product accepts must never grow what a credential
 * detector declines to open. Measured on the derived version: a credential
 * planted in the derived scratch directory produced `security: PASS (0 files)`
 * and exit 0.
 *
 * Both directions are asserted. The equality fires on any addition at all,
 * including one nobody meant to make; the canonical spelling is named
 * separately because a re-derivation is the specific edit this pins against and
 * it should say so when it fails.
 */
test("the scanner's excluded directories are literals no authority can grow", () => {
  assert.deepEqual([...ignoredDirectories], [
    ".codex-work", ".git", ".sdk-tmp", "coverage", "node_modules",
  ]);
  assert.equal(ignoredDirectories.includes(".cuna-tmp"), false,
    "an exclusion derived from the accept list turns every future brand into a blind spot");
});

/*
 * What the exclusions actually do, measured rather than asserted from the
 * source. Every excluded directory is a deliberate blind spot; `plain/` is the
 * negative control, and without it a detector that had stopped working
 * entirely would satisfy every "reports nothing" expectation here.
 */
test("an excluded directory is a blind spot, and only an excluded directory is", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scan-fixture-"));
  try {
    const leak = credential("cuna", "sk");
    for (const directory of ["plain", ...ignoredDirectories]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, "leak.txt"), leak);
    }
    const { failures, scanned } = await scanCandidate(root);
    assert.equal(scanned, 1, "a file outside plain/ was scanned");
    assert.deepEqual(
      failures.map((failure) => path.basename(path.dirname(failure.path))),
      ["plain"],
      "the planted credential was missed, or an excluded directory was read",
    );
    assert.equal(failures[0].category, "credential-material");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a credential is detected in each brand spelling the SDK accepts today", () => {
  assert.equal(containsCredentialMaterial(credential("cuna", "sk")), true, "cuna_sk_ was missed");
  assert.equal(containsCredentialMaterial(credential("runa", "sk")), true, "runa_sk_ was missed");
  assert.equal(containsCredentialMaterial(credential("cuna", "cr")), true, "cuna_cr_ was missed");
  assert.equal(containsCredentialMaterial(credential("runa", "tc")), true, "runa_tc_ was missed");
});

test("ordinary bytes and a too-short body are still not credential material", () => {
  assert.equal(containsCredentialMaterial("the quick brown fox"), false);
  assert.equal(containsCredentialMaterial(["nuna", "sk", BODY].join("_")), false);
  assert.equal(containsCredentialMaterial(["cuna", "zz", BODY].join("_")), false);
  assert.equal(containsCredentialMaterial(["cuna", "sk", "A".repeat(15)].join("_")), false);
});

/*
 * The failure this change exists to prevent, made executable. A brand that the
 * authority carries and a hand-written list omits is invisible to the second
 * and visible to the first, so the detector's reach is a function of the list
 * it is given — which is why the list must come from the authority.
 */
test("a brand the authority carries and a hand-written list omits is still detected", () => {
  const appended = [...credentialBrands, "zeta"];
  const leak = credential("zeta", "sk");
  assert.equal(containsCredentialMaterial(leak, ["cuna", "runa"]), false,
    "the frozen literal cannot see a later brand — this is the defect");
  assert.equal(containsCredentialMaterial(leak, appended), true,
    "a scanner reading the authority must see every brand the authority carries");
});

/*
 * S-5. `credentialFamilies` is NOT derived, and the measurement is why: no
 * family authority exists in this package, and the reachable ones name fewer
 * families than the scanner hunts for. Deriving would delete four families from
 * a detector, which starts passing credentials caught today. Containment runs
 * the other way instead — every family an authority declares must appear in the
 * scanner's list. It fires when an authority grows and can never shrink it.
 */
test("every credential family the canonical contract declares is one the scanner hunts for", async () => {
  const contract = await readFile("contracts/runa-api.openapi.json", "utf8");
  const declared = new Set([...contract.matchAll(
    /\^[a-z]+_([a-z]{2})_\[A-Za-z0-9_-\]\{\d+\}\$/g,
  )].map((match) => match[1]));
  // Negative control: a broken extractor yields an empty set, and containment
  // over an empty set passes vacuously. `tc` is declared by the artifact today.
  assert.equal(declared.has("tc"), true, "the contract extractor found nothing");
  assert.deepEqual([...declared].sort(), ["at", "ct", "rt", "tc"],
    "the canonical credential-family snapshot drifted");
  for (const family of declared) {
    assert.equal(credentialFamilies.includes(family), true,
      `the contract declares ${family} and the scanner does not hunt for it`);
  }
});

/*
 * The contract declares no secret-key family — an API key is not a wire schema
 * — so the artifact alone cannot guard `sk`, the one family a leaked customer
 * credential actually wears. `config.ts` is its authority and it is a source
 * predicate, not data, so this oracle is literal by necessity.
 */
test("the families this SDK itself validates are ones the scanner hunts for", () => {
  assert.equal(credentialFamilies.includes("sk"), true, "config.ts accepts sk and the scanner ignores it");
  assert.equal(credentialFamilies.includes("tc"), true, "domain.ts validates tc and the scanner ignores it");
});
