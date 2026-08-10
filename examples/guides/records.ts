import { Runa } from "@cuna_labs/sdk";

const runa = new Runa();
try {
  await runa.records.list();
} finally {
  await runa.close();
}
