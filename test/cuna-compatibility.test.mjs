import assert from "node:assert/strict";
import { test } from "vitest";

import {
  Cuna,
  CunaError,
  Runa,
  RunaError,
} from "../dist/index.js";

test("Cuna names alias the stable Runa public API", () => {
  assert.equal(Cuna, Runa);
  assert.equal(CunaError, RunaError);
});
