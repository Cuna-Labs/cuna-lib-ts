import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { containsProhibitedMarker } from "../dist/internal/boundary-policy.js";
import { WIRE_BRANDS } from "../dist/internal/wire-namespaces.js";

/**
 * Directories whose bytes are not this package candidate's. Gitlink workspaces
 * are verified by their owning repository; the scratch directory holds a
 * checked-out tree that local tooling parks there. Scanning either reports
 * findings for files nobody in this repository wrote, and would fail this gate
 * on somebody else's bytes.
 *
 * SPELLED, NEVER DERIVED, and the polarity is the whole reason. `WIRE_BRANDS`
 * is an append-only ACCEPT list; this is an EXCLUSION list. Deriving one from
 * the other inverts it: growing what the product accepts would grow what this
 * detector refuses to look at, so every future brand would silently open a
 * fresh blind spot. Measured on the version of this file that did derive it —
 * a credential planted in the derived scratch directory produced
 * `security: PASS (0 files)` and exit 0 with the credential still on disk.
 *
 * The rule generalises: an accepting surface must widen with the authority, a
 * detector's blind spots must not. Literals are correct here precisely because
 * this is not an accepting surface, and `credential-scanner-authority.test.mjs`
 * pins the list so that no later edit can re-derive it.
 *
 * Deriving the exclusions from `.gitignore` instead was also rejected: `dist/`
 * is gitignored and is the shipped payload, so that rule would stop scanning
 * the very bytes that get published.
 */
export const ignoredDirectories = Object.freeze([
  ".codex-work",
  ".git",
  ".sdk-tmp",
  "coverage",
  "node_modules",
]);

const ignored = new Set(ignoredDirectories);

/**
 * Every brand spelling this scanner hunts for, DERIVED from the one append-only
 * brand authority the package owns rather than copied out of it.
 *
 * This file already imported that module's neighbour for the prohibited-marker
 * predicate and then wrote its own second copy of the brand list thirty-five
 * lines lower. Two lists, compared by nothing — the workspace's recurring
 * defect, reappearing inside a gate written to catch leaked secrets. The
 * failure is asymmetric and silent: the authority is append-only, so the day a
 * third spelling lands the shipped code accepts it while this scanner does not
 * know it exists. A committed credential in the new spelling then passes a scan
 * written specifically to find it, and the gate reports PASS on a tree it
 * cannot see. That is worse than having no gate, because it manufactures
 * confidence.
 *
 * Derivation, not duplication, is the whole point: there is no second place to
 * forget to edit. Spelling a brand here again would restore the defect, so the
 * acceptance test asserts this file contains no brand spelling at all.
 */
export const credentialBrands = [...WIRE_BRANDS];

/**
 * Every credential family the product has ever minted. This is a denylist, so
 * it may only ever GROW: a name removed from it silently starts admitting
 * material that is blocked today.
 *
 * It was the legacy brand's secret-key prefix alone, which is the one prefix
 * production no longer mints. A committed key in the CURRENT spelling — what
 * `config.ts` accepts first — passed this gate without a word. The families
 * mirror the CLI's single namespace authority (`src/core/namespace.ts` in the
 * CLI repository): sk secret key, at access token, rt refresh token, ct
 * continuation, tc terminal connect, se/sc session credentials, cb browser
 * callback nonce, cr continuation resume handle.
 *
 * `cr` was the ninth family and nothing detected it. The console mints that
 * family as a bearer capability that keys `localStorage`, names a
 * `BroadcastChannel` and rides in a URL fragment; this gate returned no match
 * for it, as did every other detector the product owns.
 *
 * Unlike the brands, this list is NOT derived, and the measurement is the
 * reason. No family authority exists inside this package. The two authorities
 * that are reachable — the canonical OpenAPI artifact, which declares at, cb,
 * ct, rt and tc, and this SDK's own validators, which know sk and tc — name
 * five families between them. Deriving from either would drop four families a
 * scan catches today, and narrowing a DETECTOR starts passing credentials that
 * are currently caught. The correct guard is therefore containment in the other
 * direction: the acceptance test asserts every family those authorities declare
 * appears here, which fires when an authority grows and can never shrink this
 * list.
 */
export const credentialFamilies = ["sk", "at", "rt", "ct", "tc", "se", "sc", "cb", "cr"];

/** `(?:<brand>|…)_(?:<family>|…)_` — the opening of a credential token. */
export function credentialOpening(
  brands = credentialBrands,
  families = credentialFamilies,
) {
  return `(?:${brands.join("|")})_(?:${families.join("|")})_`;
}

/**
 * A fresh pattern list per call. A `g` regular expression carries `lastIndex`
 * between uses, so a shared array silently starts each scan wherever the
 * previous one stopped.
 */
export function secretPatterns(
  brands = credentialBrands,
  families = credentialFamilies,
) {
  return [
    new RegExp(`${credentialOpening(brands, families)}[A-Za-z0-9_-]{16,}`, "g"),
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    /Authorization\s*[:=]\s*Bearer\s+\S+/gi,
  ];
}

/** Whether committed bytes carry a credential of any accepted brand. */
export function containsCredentialMaterial(
  text,
  brands = credentialBrands,
  families = credentialFamilies,
) {
  return secretPatterns(brands, families).some(
    (pattern) => (pattern.lastIndex = 0, pattern.test(text)),
  );
}

/**
 * A capability URL that carries a credential in its own query is a secret
 * wearing a URL's clothes: it survives every "URLs are safe to log" habit.
 * `domain.ts` refuses a terminal grant whose `connect_url` contains its
 * `connect_token`; this is the same rule applied to committed bytes.
 */
export function containedCredential(
  text,
  brands = credentialBrands,
  families = credentialFamilies,
) {
  const urls = text.match(/https?:\/\/[^\s"'`<>)\]]+|wss?:\/\/[^\s"'`<>)\]]+/g) ?? [];
  const opening = new RegExp(
    `${credentialOpening(brands, families)}[A-Za-z0-9_-]{16,}`,
  );
  return urls.some((url) => opening.test(url) || /[?&](?:token|secret|key|t)=[^&\s]{16,}/i.test(url));
}

/**
 * Scans one candidate tree. The root is a parameter so an acceptance test can
 * plant a credential in a fixture and observe what this gate does and does not
 * see — an exclusion that is never exercised is an assertion about behaviour
 * nobody has measured.
 */
export async function scanCandidate(root = ".") {
  const canonicalContractRoot = path.resolve(root, "contracts");
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.endsWith(".tgz")) continue;
      const target = path.join(directory, entry.name);
      // The immutable submodule is separately verified by contract:verify. Its
      // accepted source PRD intentionally documents a synthetic Bearer example.
      if (path.resolve(target) === canonicalContractRoot) continue;
      if (entry.isDirectory()) await walk(target);
      else files.push(target);
    }
  }
  await walk(root);
  const failures = [];
  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (containsProhibitedMarker(text)) failures.push({ category: "boundary-marker", path: file });
    if (containsCredentialMaterial(text)) {
      failures.push({ category: "credential-material", path: file });
    }
    if (containedCredential(text)) failures.push({ category: "capability-url", path: file });
  }
  return { failures, scanned: files.length };
}

// Importable as a module so the scanner can be exercised by acceptance tests;
// the scan runs only when this file is the process entry point.
if (process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { failures, scanned } = await scanCandidate();
  if (failures.length > 0) {
    console.error(JSON.stringify({ status: "FAIL", failures }, null, 2));
    process.exit(1);
  }
  console.log(`security: PASS (${scanned} files)`);
}
