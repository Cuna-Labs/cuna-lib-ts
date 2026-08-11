# Errors

Catch `ConfigError` for invalid configuration and `ApiError` for HTTP or
malformed responses. Public messages are intentionally fixed and safe.

For current additive operations, including capabilities and AgentSessions, `ApiError.problem`
contains validated, closed Problem metadata when the server returned a conforming Problem.
Malformed or widened Problem bodies are discarded, leaving `problem` undefined; raw response
fields are never preserved on the public error.

Source: [`examples/guides/errors.ts`](../../examples/guides/errors.ts).
