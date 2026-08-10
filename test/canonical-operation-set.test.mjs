import assert from "node:assert/strict";
import { test } from "vitest";

import { operationKeys } from "../dist/internal/contract/index.js";

test("private transport bridge exposes exactly the canonical 1.7 SDK operations", () => {
  assert.deepEqual(operationKeys(), [
    "agentSessions.agentAuth",
    "agentSessions.create",
    "agentSessions.createTerminalConnection",
    "agentSessions.get",
    "agentSessions.list",
    "agentSessions.rename",
    "agentSessions.terminate",
    "capabilities.get",
    "machineCreates.get",
    "machineCreates.reconcile",
    "me.get",
    "records.list",
    "sessions.checkpoint",
    "sessions.create",
    "sessions.delete",
    "sessions.exec",
    "sessions.get",
    "sessions.list",
    "sessions.open",
    "sessions.pause",
    "sessions.resume",
    "sessions.start",
    "sessions.stop",
    "workspaceBindings.create",
    "workspaceBindings.get",
    "workspaces.sync.begin",
    "workspaces.sync.changes",
    "workspaces.sync.chunk",
    "workspaces.sync.chunkDownload",
    "workspaces.sync.commit",
    "workspaces.sync.negotiate",
    "workspaces.sync.reconcile",
  ]);
});
