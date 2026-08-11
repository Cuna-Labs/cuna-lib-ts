# Cleanup

Delete sessions that are no longer needed and call `cuna.close()` in a
`finally` block. Closing waits for admitted operations and rejects new work.

Source: [`examples/guides/cleanup.ts`](../../examples/guides/cleanup.ts).
