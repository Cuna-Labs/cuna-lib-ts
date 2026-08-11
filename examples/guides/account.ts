import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  await cuna.me();
} finally {
  await cuna.close();
}
