import { Cuna, stdoutText } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  const session = await cuna.sessions.get(process.env.CUNA_SESSION_ID ?? "");
  const result = await session.exec(["printf", "%s", "hello"], { timeoutSecs: 30 });
  process.stdout.write(stdoutText(result) ?? "");
} finally {
  await cuna.close();
}
