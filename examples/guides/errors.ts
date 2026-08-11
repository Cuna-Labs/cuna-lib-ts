import { ApiError, ConfigError, Cuna } from "@cuna_labs/sdk";

try {
  const cuna = new Cuna();
  try {
    await cuna.me();
  } finally {
    await cuna.close();
  }
} catch (error) {
  if (error instanceof ConfigError || error instanceof ApiError) {
    process.stderr.write(`${error.name}: ${error.code}\n`);
  }
}
