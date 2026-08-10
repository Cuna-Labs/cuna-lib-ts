# Changelog

## 0.1.0 - Unreleased

SemVer class: initial minor release.

- Additions: initial ESM-only `@runa_laboratories/sdk` client, session and record managers, typed errors, deterministic resilience, and generated API reference.
- Additions: expose background session creation, default interactive Claude Code and Codex sessions to background provisioning, and document refresh-based readiness polling.
- Additions: bind every new AgentSession to an exact `workspaceBindingId` and committed `workspaceGeneration`; the corresponding OpenAPI 1.7 wire field is `workspace_binding_id`.
- Additions: accept `CUNA_BASE_URL` alongside the still-accepted `RUNA_BASE_URL`, derive both spellings of every configuration variable from the single `WIRE_BRANDS` list, and emit a `CunaConfigWarning` naming the ignored variable when both spellings of one setting are exported with different values.
- Fixes: give `Session.authenticationStatus()` a dedicated 30-second attempt timeout without increasing the timeout of unrelated reads.
- Fixes: replace the non-GA license placeholder with the approved Apache-2.0 license and package metadata.
- Deprecations: none.
- Removals: none.
- Known limitations: general-availability publication remains blocked until the independent release authority is configured and admitted.
