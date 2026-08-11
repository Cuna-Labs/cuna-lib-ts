import assert from "node:assert/strict";
import { test } from "vitest";

import { ApiError, Cuna } from "../dist/index.js";
import {
  API_KEY,
  SESSION_ID,
  capabilitySnapshotFixture,
  jsonResponse,
} from "./helpers.mjs";

function capabilityResponse(value, status = 200) {
  const headers = status === 200 ? { etag: `"${value.etag}"` } : {};
  return jsonResponse(value, status, headers);
}

test("capabilities.get sends the exact account query and decodes leased evidence", async () => {
  const calls = [];
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return capabilityResponse(capabilitySnapshotFixture());
    },
  });

  assert.equal(runa.capabilities, runa.capabilities);
  const snapshot = await runa.capabilities.get("account");
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.equal(snapshot.subjectScope, "account");
  assert.equal(snapshot.etag, "a".repeat(64));
  assert.equal(snapshot.capabilities[0].availability, "unsupported");
  assert.equal(snapshot.capabilities[0].mutationClass, "reversible");
  assert.equal(
    snapshot.capabilities[0].reasonCode,
    "agent_session_foundation_not_available",
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.capabilities), true);
  assert.equal(Object.isFrozen(snapshot.capabilities[0].surfaces), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, "https://api.getcuna.com/v1/capabilities?scope=account");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].init.redirect, "manual");
  await runa.close();
});

test("machine discovery binds the resource query to the returned subject", async () => {
  let target;
  const value = capabilitySnapshotFixture({
    subject_scope: "machine",
    subject_id: SESSION_ID,
  });
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url) => {
      target = new URL(url);
      return capabilityResponse(value);
    },
  });
  const snapshot = await runa.capabilities.get("machine", SESSION_ID);
  assert.equal(snapshot.subjectId, SESSION_ID);
  assert.equal(
    target.href,
    `https://api.getcuna.com/v1/capabilities?scope=machine&resource_id=${SESSION_ID}`,
  );
  await runa.close();
});

test("agent-session discovery binds the resource query to the returned subject", async () => {
  let target;
  const value = capabilitySnapshotFixture({
    subject_scope: "agent_session",
    subject_id: SESSION_ID,
  });
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async (url) => {
      target = new URL(url);
      return capabilityResponse(value);
    },
  });
  const snapshot = await runa.capabilities.get("agent_session", SESSION_ID);
  assert.equal(snapshot.subjectScope, "agent_session");
  assert.equal(snapshot.subjectId, SESSION_ID);
  assert.equal(
    target.href,
    `https://api.getcuna.com/v1/capabilities?scope=agent_session&resource_id=${SESSION_ID}`,
  );
  await runa.close();
});

test("capability requests and decoders fail closed without provider leakage", async () => {
  let calls = 0;
  const invalid = [
    capabilitySnapshotFixture({ capabilities: [{
      ...capabilitySnapshotFixture().capabilities[0], availability: "future",
    }] }),
    capabilitySnapshotFixture({ capabilities: [{
      ...capabilitySnapshotFixture().capabilities[0], provider: "internal",
    }] }),
    capabilitySnapshotFixture({ expires_at: "2026-08-08T11:59:59.000Z" }),
  ];
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => {
      calls += 1;
      return capabilityResponse(invalid.shift());
    },
  });
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      runa.capabilities.get("account"),
      (error) => error instanceof ApiError && error.code === "malformed_response",
    );
  }
  await assert.rejects(runa.capabilities.get("account", SESSION_ID), TypeError);
  await assert.rejects(runa.capabilities.get("machine"), TypeError);
  await assert.rejects(runa.capabilities.get("machine", SESSION_ID.toUpperCase()), TypeError);
  await assert.rejects(runa.capabilities.get("future"), TypeError);
  assert.equal(calls, 3);
  await runa.close();
});

test("capability response ETag must match the body digest", async () => {
  const runa = new Cuna({
    apiKey: API_KEY,
    fetch: async () => jsonResponse(
      capabilitySnapshotFixture(),
      200,
      { etag: `"${"b".repeat(64)}"` },
    ),
  });
  await assert.rejects(
    runa.capabilities.get("account"),
    (error) => error instanceof ApiError && error.code === "malformed_response",
  );
  await runa.close();
});
