# Interactive agent login

Claude Code and Codex sessions default to background provisioning because they
can use the user's provider subscription through an interactive login. The SDK
does not accept or embed a provider API key for this flow.

```ts
const agentSession = await runa.agentSessions.get(
  "22222222-2222-4222-8222-222222222222",
);
const authentication = await runa.agentSessions.agentAuth(agentSession);

if (authentication.state === "login_required") {
  // Present the product's terminal sign-in flow. Never infer authentication
  // from terminal text and never cache this short-lived observation.
}
```

Auth evidence belongs to an exact AgentSession and process epoch. Pass the
already admitted `AgentSession` object to `agentAuth`; the SDK rejects a
sibling ID, a changed process epoch or auth mode, stale observations, and
responses that are not marked `Cache-Control: no-store`. No provider secrets,
terminal output, account identity, or machine-level shortcut are exposed.

Synchronous creation can legitimately use the platform's 25-minute durable
provisioning lease and its five-minute recovery window. The SDK therefore
allows 31 minutes for `sessions.create` before timing out. Prefer the default
background flow for interactive agents so callers receive a session handle
immediately.
