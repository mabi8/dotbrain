import dotenv from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;

if (!AZURE_CLIENT_ID) {
  console.error("Error: AZURE_CLIENT_ID not set in .env file");
  process.exit(1);
}

export const SCOPES = [
  "Mail.Read",
  "Mail.Send",
  "Calendars.Read",
  "Calendars.ReadWrite",
  "User.Read",
];

export interface AccountConfig {
  alias: string;
  email: string;
  loginHint: string;
}

export const ACCOUNTS: Record<string, AccountConfig> = {
  b8n: {
    alias: "b8n",
    email: "Markus.Binder@B8n.com",
    loginHint: "Markus.Binder@B8n.com",
  },
  boc: {
    alias: "boc",
    email: "markus.binder@blueoceancapital.de",
    loginHint: "markus.binder@blueoceancapital.de",
  },
};

export function getAccount(alias: string): AccountConfig {
  const account = ACCOUNTS[alias];
  if (!account) {
    console.error(
      `Unknown account alias: ${alias}. Valid: ${Object.keys(ACCOUNTS).join(", ")}`
    );
    process.exit(1);
  }
  return account;
}

export const TOKEN_CACHE_DIR = resolve(
  process.env.HOME || "~",
  ".graph-mail-tokens"
);
