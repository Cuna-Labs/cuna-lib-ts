import { Runa } from "@cuna_labs/sdk";

const runa = new Runa();
try {
  const session = await runa.sessions.create("cleanup");
  await session.delete();
} finally {
  await runa.close();
}
