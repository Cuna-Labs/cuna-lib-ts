import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { containsProhibitedMarker } from "../dist/internal/boundary-policy.js";

// Gitlink workspaces are verified by their owning repository. Scanning their
// checked-out contents here produces false positives for bytes that are not
// part of this package candidate.
const ignored = new Set([".codex-work", ".git", "node_modules", "coverage"]);
const canonicalContractRoot = path.resolve("contracts");
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
await walk(".");
// Every brand and every credential family the product has ever minted. This is
// a denylist, so it may only ever GROW: a name removed from it silently starts
// admitting material that is blocked today.
//
// It was `runa_sk_` alone, which is the one prefix production no longer mints.
// A committed `cuna_sk_` key — the CURRENT mint, and what `config.ts` accepts
// first — passed this gate without a word. The families mirror the CLI's single
// namespace authority (`runa-cli/src/core/namespace.ts`): sk secret key, at
// access token, rt refresh token, ct continuation, tc terminal connect, se/sc
// session credentials, cb browser callback nonce, cr continuation resume handle.
//
// `cr` was the ninth family and nothing detected it. `app-website` mints
// `cuna_cr_<43>` as a bearer capability that keys `localStorage`, names a
// `BroadcastChannel` and rides in a URL fragment; this gate returned no match
// for it, as did every other detector the product owns.
const credentialBrands = ["cuna", "runa"];
const credentialFamilies = ["sk", "at", "rt", "ct", "tc", "se", "sc", "cb", "cr"];
const credentialOpening =
  `(?:${credentialBrands.join("|")})_(?:${credentialFamilies.join("|")})_`;
const secretPatterns = [
  new RegExp(`${credentialOpening}[A-Za-z0-9_-]{16,}`, "g"),
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /Authorization\s*[:=]\s*Bearer\s+\S+/gi
];

/**
 * A capability URL that carries a credential in its own query is a secret
 * wearing a URL's clothes: it survives every "URLs are safe to log" habit.
 * `domain.ts` refuses a terminal grant whose `connect_url` contains its
 * `connect_token`; this is the same rule applied to committed bytes.
 */
function containedCredential(text) {
  const urls = text.match(/https?:\/\/[^\s"'`<>)\]]+|wss?:\/\/[^\s"'`<>)\]]+/g) ?? [];
  const opening = new RegExp(`${credentialOpening}[A-Za-z0-9_-]{16,}`);
  return urls.some((url) => opening.test(url) || /[?&](?:token|secret|key|t)=[^&\s]{16,}/i.test(url));
}
const failures = [];
for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (containsProhibitedMarker(text)) failures.push({ category: "boundary-marker", path: file });
  if (secretPatterns.some((pattern) => (pattern.lastIndex = 0, pattern.test(text)))) {
    failures.push({ category: "credential-material", path: file });
  }
  if (containedCredential(text)) failures.push({ category: "capability-url", path: file });
}
if (failures.length > 0) {
  console.error(JSON.stringify({ status: "FAIL", failures }, null, 2));
  process.exit(1);
}
console.log(`security: PASS (${files.length} files)`);
