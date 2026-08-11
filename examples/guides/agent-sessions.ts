import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const page = await cuna.agentSessions.list("11111111-1111-4111-8111-111111111111", {
    limit: 25,
  });
  const created = await cuna.agentSessions.create(
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
  const authentication = await cuna.agentSessions.agentAuth(created);
  await cuna.agentSessions.rename(created.id, "review-api");
  await cuna.agentSessions.terminate(created.id);
  console.log(page.nextCursor);
  console.log(authentication.state);
} finally {
  await cuna.close();
}
