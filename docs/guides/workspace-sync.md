# Workspace synchronization

Workspace synchronization keeps the public workspace identity separate from the binding that
connects a local project to a machine. Use `workspaceId` in workspace routes and the exact
`workspaceBindingId` returned by `workspaceBindings.create()` in synchronization requests.

The bounded workflow is:

1. `runa.workspaceSync.begin(...)`
2. `runa.workspaceSync.negotiate(...)` for each manifest page
3. `runa.workspaceSync.uploadChunk(...)` for each missing local digest
4. `runa.workspaceSync.downloadChunk(...)` for content referenced by remote changes
5. `runa.workspaceSync.commit(...)`
6. `runa.workspaceSync.changes(...)`
7. `runa.workspaceSync.reconcile(...)` when explicit convergence evidence is needed

`downloadChunk(syncId, digest)` returns a fresh `Uint8Array`. The SDK validates canonical base64,
the declared byte length, protocol-reader compatibility, the requested digest, and the computed
SHA-256 digest before returning bytes. A `malformed_response` error is an integrity failure; never
use content from that response.

Every mutating synchronization request needs a caller-stable idempotency key. Reuse a key only
for an exact replay of the same intent and body.
