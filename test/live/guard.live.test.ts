import { test } from "vitest";

const enabled = process.env.CUNA_LIVE_TESTS === "1" &&
  (typeof process.env.CUNA_API_KEY === "string" &&
    process.env.CUNA_API_KEY.length > 0) ||
  (typeof process.env.RUNA_API_KEY === "string" &&
    process.env.RUNA_API_KEY.length > 0);

test.skipIf(!enabled)("live lane requires CI and an exclusive credential lock", () => {
  if (process.env.CI !== "true" || process.env.CUNA_LIVE_LOCK_ACQUIRED !== "1") {
    throw new TypeError("The Cuna live-test lock is not configured.");
  }
  throw new TypeError("No live operation subset is approved.");
});
