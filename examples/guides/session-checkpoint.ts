import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const session = await cuna.sessions.get(process.env.CUNA_SESSION_ID ?? "");
  await session.checkpoint("before-change");
} finally {
  await cuna.close();
}
