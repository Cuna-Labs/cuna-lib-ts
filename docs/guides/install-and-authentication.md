# Install and authentication

Install with `npm install @cuna_labs/sdk`. Set canonical `CUNA_API_KEY` in the process
environment, or provide `apiKey` to `new Cuna(...)`. The canonical API origin
is `https://api.getcuna.com`; `https://api.runacode.io` remains accepted for
compatibility. Never put an API key in source control or logs. Node.js 22 or
newer and ESM are required.

Canonical keys start with `cuna_sk_`. The legacy `RUNA_API_KEY` variable and
`runa_sk_` prefix remain accepted, but a present invalid `CUNA_API_KEY` fails
closed instead of falling through to the legacy value.
