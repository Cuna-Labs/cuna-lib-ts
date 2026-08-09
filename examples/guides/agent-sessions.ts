import { Runa } from "@runa_laboratories/sdk";

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
      name: "review",
    },
  );
  await runa.agentSessions.rename(created.id, "review-api");
  await runa.agentSessions.terminate(created.id);
  console.log(page.nextCursor);
} finally {
  await runa.close();
}
