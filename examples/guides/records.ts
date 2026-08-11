import { Cuna } from "@cuna_labs/sdk";

const cuna = new Cuna();
try {
  await cuna.records.list();
} finally {
  await cuna.close();
}
