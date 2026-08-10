import { Runa } from "@cuna_labs/sdk";

const runa = new Runa();
try {
  await runa.me();
} finally {
  await runa.close();
}
