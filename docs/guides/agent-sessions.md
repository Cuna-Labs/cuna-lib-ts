# Agent sessions

`runa.agentSessions` manages durable agent-process intent for one Runa machine. It can
list, create, read, rename, and request termination. The returned `processState` is an
observation: `unknown` is not proof that no process exists, and a successful `terminate`
records intent rather than proving immediate process absence.

Creation requires a caller-stable `idempotencyKey`, an agent, and a `/workspace` working
directory. Claude Code and Codex default to `interactive_login`; OpenClaw defaults to
`credential_binding` and therefore requires `credentialBindingId`. A pagination cursor is
opaque and should only be passed back to `list`.

Call `createTerminalConnection(agentSessionId, options)` to request one short-lived
terminal connection grant. `clientInstanceId` is a stable identity for the calling Runa
client, and an optional `resumeHandle` requests a new attachment generation from a
previous grant. `idempotencyKey` is caller-owned: reuse it only when retrying the same
intent and choose a new key for a new intent.

The returned `connectToken` is one-use secret material. Hand the grant directly to the
separate terminal runtime, do not log or persist it, and do not add it to `connectUrl`.
The SDK validates the complete five-capability record and the expiry but deliberately
does not open, resume, or monitor the connection.

See [`examples/guides/agent-sessions.ts`](../../examples/guides/agent-sessions.ts).
This SDK surface intentionally does not open a PTY, perform provider login, or synchronize
local files.
