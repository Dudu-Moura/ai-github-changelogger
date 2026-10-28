import { existsSync } from "node:fs";
import { InvalidEnvError, loadEnv } from "./config/env.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

try {
  const env = loadEnv();
  console.log(`Config OK — map: ${env.MAP_MODEL}, reduce: ${env.REDUCE_MODEL}, effort: ${env.LLM_EFFORT}`);
} catch (error) {
  if (error instanceof InvalidEnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
