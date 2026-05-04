import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export interface QplixConfig {
  baseUrl: string;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Error: ${key} not set in .env`);
    process.exit(1);
  }
  return val;
}

export function getConfig(): QplixConfig {
  const baseUrl = requireEnv("QPLIX_BASE_URL").replace(/\/$/, "");
  return { baseUrl };
}
