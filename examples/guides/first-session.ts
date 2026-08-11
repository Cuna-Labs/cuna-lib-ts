import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const session = await cuna.sessions.create("first-session");
  await session.delete();
} finally {
  await cuna.close();
}
