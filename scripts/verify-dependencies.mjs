import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { npmSpawnSync } from "./npm-process.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must use an exact pin`);
}
// A security floor is a lower bound, not an equality. Asserting equality here
// made every vitest upgrade fail this gate, including a security upgrade, which
// is the opposite of what a floor is for.
const VITEST_SECURITY_FLOOR = "3.2.7";
const parseExactVersion = (value, subject) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
  assert.ok(match, `${subject} must be an exact version, received ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};
const isAtOrAboveFloor = (candidate, floor) => {
  const left = parseExactVersion(candidate, "vitest pin");
  const right = parseExactVersion(floor, "vitest security floor");
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
};
const vitestPin = pkg.devDependencies.vitest;
assert.equal(
  isAtOrAboveFloor(vitestPin, VITEST_SECURITY_FLOOR),
  true,
  `vitest ${vitestPin} is below the ${VITEST_SECURITY_FLOOR} security floor`
);
assert.equal(
  lock.packages["node_modules/vitest"].version,
  vitestPin,
  `package-lock.json must resolve vitest to the manifest pin ${vitestPin}`
);
const allowedLicenses = new Set([
  "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0",
  "ISC", "MIT", "Python-2.0"
]);
const licenseCounts = {};
for (const packagePath of Object.keys(lock.packages).filter((key) => key.startsWith("node_modules/"))) {
  try {
    const installed = JSON.parse(await readFile(`${packagePath}/package.json`, "utf8"));
    assert.equal(typeof installed.license, "string", `${packagePath} has no declared license`);
    assert.equal(allowedLicenses.has(installed.license), true, `${packagePath} has an unapproved license`);
    licenseCounts[installed.license] = (licenseCounts[installed.license] ?? 0) + 1;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const audit = npmSpawnSync(["audit", "--json"]);
if (audit.error) throw audit.error;
const report = JSON.parse(audit.stdout || "{}");
const vulnerabilities = report.metadata?.vulnerabilities ?? {};
assert.equal(vulnerabilities.critical ?? 0, 0);
assert.equal(vulnerabilities.high ?? 0, 0);
await mkdir("evidence", { recursive: true });
await writeFile("evidence/dependency-audit.json", `${JSON.stringify({
  schema_version: 1,
  status: audit.status === 0 ? "PASS" : "BLOCKED",
  runtime_dependency_count: 0,
  exact_dev_pins: true,
  vitest_security_floor: VITEST_SECURITY_FLOOR,
  vitest_pin: vitestPin,
  vitest_lock_exact: true,
  licenses: { status: "PASS", counts: licenseCounts },
  vulnerabilities
}, null, 2)}\n`);
if (audit.status !== 0) process.exit(audit.status ?? 1);
console.log("dependencies: PASS");
