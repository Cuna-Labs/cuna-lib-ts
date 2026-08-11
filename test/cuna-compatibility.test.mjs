import assert from "node:assert/strict";
import { test } from "vitest";

import {
  Cuna,
  CunaError,
} from "../dist/index.js";

test("the public SDK surface is Cuna-native", async () => {
  assert.equal(Cuna.name, "Cuna");
  assert.equal(CunaError.name, "CunaError");
  assert.equal("Runa" in await import("../dist/index.js"), false);
  assert.equal("RunaError" in await import("../dist/index.js"), false);
});
