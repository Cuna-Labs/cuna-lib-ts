# Contributing

## Branches

- `main` — released, deployable truth. Protected.
- `develop/sdk-foundation` — integration. Feature branches (`feat/…`, `fix/…`)
  merge here; `main` receives it when a release is cut.

## Ground rules

- English only, in code, comments, docs, and commit messages.
- The SDK talks only to the Cuna endpoint (`https://api.getcuna.com` by
  default). It must never reference or reach an upstream service directly, and must never
  print a `cuna_sk_` key or a legacy `runa_sk_` key.
- Every change follows the product requirements document it implements.
- Types pass, build is green, and tests cover the change before review.
