import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const BASE_URL = "https://mail.zoho.eu";
export const AUTH_URL = "https://accounts.zoho.eu/oauth/v2/token";

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  zoid: string;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Error: ${key} not set in .env`);
    process.exit(1);
  }
  return val;
}

export function getConfig(): ZohoConfig {
  return {
    clientId: requireEnv("ZOHO_CLIENT_ID"),
    clientSecret: requireEnv("ZOHO_CLIENT_SECRET"),
    refreshToken: requireEnv("ZOHO_REFRESH_TOKEN"),
    zoid: requireEnv("ZOHO_ORG_ID"),
  };
}
