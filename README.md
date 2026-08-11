# @cuna_labs/sdk

The official, ESM-only TypeScript client from Cuna Labs. Node.js 22 or
newer is required.

Documentation and support are available at [getcuna.com](https://getcuna.com),
[getcuna.com/docs](https://getcuna.com/docs), and
[getcuna.com/support](https://getcuna.com/support).

## Install

```sh
npm install @cuna_labs/sdk
```

Set canonical `CUNA_API_KEY` or pass an API key directly:

```ts
import { Cuna, stdoutText } from "@cuna_labs/sdk";

const cuna = new Cuna({ apiKey: process.env.CUNA_API_KEY });

try {
  const session = await cuna.sessions.create("first-session", {
    agent: "codex",
  });
  const result = await session.exec(["printf", "%s", "hello"]);
  process.stdout.write(stdoutText(result));
  await session.delete();
} finally {
  await cuna.close();
}
```

`Cuna` and `CunaConfig` are the canonical public client and configuration
surface. The unpublished legacy client aliases are intentionally absent. The
`CUNA_API_KEY` and `cuna_sk_*` are canonical. The legacy `RUNA_API_KEY`,
`runa_sk_*` key prefix, and wire protocol names are intentionally retained.
A present invalid canonical variable never falls back to its legacy alias.
New clients default to `api.getcuna.com`, while
`api.runacode.io` remains accepted as a legacy-compatible origin. This package
does not expose unpublished legacy client symbols.

Configuration precedence is constructor options, environment variables, the
optional configuration file, then the default API endpoint. A present but
invalid higher-precedence value is an error; it never falls through.

### Environment variables

| Variable | Purpose | Precedence |
| --- | --- | --- |
| `CUNA_API_KEY` | API key | canonical; outranks `RUNA_API_KEY` |
| `RUNA_API_KEY` | API key | legacy alias, still accepted |
| `CUNA_BASE_URL` | API origin | canonical; outranks `RUNA_BASE_URL` |
| `RUNA_BASE_URL` | API origin | legacy alias, still accepted |

The two spellings of one setting are read from a single list, so the credential
and the endpoint always agree on which name wins. When both spellings of the
same setting are exported with **different** values, the canonical `CUNA_`
variable is used and the client emits a `CunaConfigWarning` on the process
warning channel naming the variable that was ignored; values are never
included. Exporting both with the same value is silent. A present but invalid
`CUNA_` variable is an error and never falls back to its `RUNA_` alias.

## Resources

- `cuna.sessions.create(name, options)`, `list()`, and `get(id)`
- `Session` lifecycle methods, `exec()`, `checkpoint()`, and `open()`
- `cuna.records.list()`
- `cuna.me()`
- `cuna.agentSessions.list(machineId)`, `create(machineId, options)`, `get(id)`, `agentAuth(agentSession)`, `rename(id, name)`, `terminate(id)`, and `createTerminalConnection(id, options)`
- `cuna.workspaceSync.downloadChunk(syncId, digest)` returns verified remote workspace bytes

`Session.open()` returns a short-lived sensitive value. Use it only for the
immediate handoff and do not print, persist, cache, or fetch it automatically.
`cuna.agentSessions.agentAuth(agentSession)` returns immutable, secret-free,
short-lived evidence for the exact AgentSession process generation. The SDK
rejects stale, cacheable, contradictory, extra-field, sibling-session, and
process-epoch-mismatched responses. There is intentionally no machine-level
or legacy `Session` shortcut.

Workspace chunk downloads are integrity checked before exposure: canonical base64, declared
length, requested digest, and computed SHA-256 must all agree. See the
[workspace synchronization guide](docs/guides/workspace-sync.md).

Claude Code and Codex sessions use interactive subscription login by default.
Their create request sends `background: true`, so creation can immediately
return a session whose status is `"creating"`. Poll `session.refresh()` until
the session becomes `"running"`, then use `open()` when sign-in is required.
Pass `{ background: false }` explicitly to
request the legacy synchronous create behavior. OpenClaw keeps the existing
omission behavior unless `background` is provided explicitly.

Session creation accepts `outboundPolicy` with mode `"allowlist"` or
`"denylist"` and up to 128 exact or leading-wildcard domains. An empty list is
explicit. The legacy `allowedHosts` option remains supported but cannot be sent
together with `outboundPolicy`. See the [network policy guide](docs/guides/network-policy.md).

`createTerminalConnection()` returns short-lived, one-use connection metadata.
The SDK validates and returns that metadata but never opens the WebSocket or
consumes the token. Supply a caller-stable `idempotencyKey` and reuse the same
key when retrying the same intent.

See [guides](docs/guides/README.md) and the generated
[API reference](docs/api/README.md). Public errors have fixed safe messages:
`ConfigError`, `ApiError`, and the non-constructible `CommandError` marker.

## Development

```sh
npm ci
npm run quality
npm pack --dry-run
```

The package has no runtime dependencies and exposes only its root ESM entry.

## License

Copyright 2026 Cuna Labs. Licensed under the
[Apache License 2.0](LICENSE).
