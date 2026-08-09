# Agent sessions

`runa.agentSessions` manages durable agent-process intent for one Runa machine. It can
list, create, read, rename, and request termination. The returned `processState` is an
observation: `unknown` is not proof that no process exists, and a successful `terminate`
records intent rather than proving immediate process absence.

Creation requires a caller-stable `idempotencyKey`, an agent, and a `/workspace` working
directory. Claude Code and Codex default to `interactive_login`; OpenClaw defaults to
`credential_binding` and therefore requires `credentialBindingId`. A pagination cursor is
opaque and should only be passed back to `list`.

See [`examples/guides/agent-sessions.ts`](../../examples/guides/agent-sessions.ts).
This SDK surface intentionally does not open a PTY, perform provider login, or synchronize
local files.
