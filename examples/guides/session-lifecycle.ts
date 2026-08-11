import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const session = await cuna.sessions.create("lifecycle");
  await session.pause();
  await session.resume();
  await session.stop();
  await session.start();
  await session.refresh();
  await session.delete();
} finally {
  await cuna.close();
}
