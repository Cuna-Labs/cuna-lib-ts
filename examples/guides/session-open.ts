import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const session = await cuna.sessions.get(process.env.CUNA_SESSION_ID ?? "");
  await session.open();
} finally {
  await cuna.close();
}
