import { Cuna } from "@cuna_labs/sdk";
import type { Session } from "@cuna_labs/sdk";

declare const cuna: Cuna;
declare const session: Session;
declare const sessionId: string;

// example:cuna-constructor
const apiKey = process.env.CUNA_API_KEY;
if (apiKey === undefined) throw new Error("CUNA_API_KEY is required.");
const client = new Cuna({ apiKey });
await client.close();
// end-example

// example:cuna-me
await cuna.me();
// end-example

// example:cuna-close
await cuna.close();
// end-example

// example:records-list
await cuna.records.list();
// end-example

// example:sessions-create
const created = await cuna.sessions.create("worker", { agent: "codex" });
if (created.snapshot.status === "creating") await created.refresh();
// end-example

// example:sessions-list
await cuna.sessions.list();
// end-example

// example:sessions-get
await cuna.sessions.get(sessionId);
// end-example

// example:session-refresh
await session.refresh();
// end-example

// example:session-start
await session.start();
// end-example

// example:session-pause
await session.pause();
// end-example

// example:session-resume
await session.resume();
// end-example

// example:session-stop
await session.stop();
// end-example

// example:session-delete
await session.delete();
// end-example

// example:session-exec
await session.exec(["printf", "%s", "ready"], { timeoutSecs: 30 });
// end-example

// example:session-checkpoint
await session.checkpoint("before-change");
// end-example

// example:session-open
await session.open();
// end-example
