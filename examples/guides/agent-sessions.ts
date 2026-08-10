import { Runa } from "@cuna_labs/sdk";

const runa = new Runa();
try {
  const page = await runa.agentSessions.list("11111111-1111-4111-8111-111111111111", {
    limit: 25,
  });
  const created = await runa.agentSessions.create(
    "11111111-1111-4111-8111-111111111111",
    {
      idempotencyKey: crypto.randomUUID(),
      agent: "codex",
      cwd: "/workspace/project",
      workspaceBindingId: "77777777-7777-4777-8777-777777777777",
      workspaceGeneration: 7,
      name: "review",
    },
  );
  const authentication = await runa.agentSessions.agentAuth(created);
  await runa.agentSessions.rename(created.id, "review-api");
  await runa.agentSessions.terminate(created.id);
  console.log(page.nextCursor);
  console.log(authentication.state);
} finally {
  await runa.close();
}
