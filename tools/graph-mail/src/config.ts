import dotenv from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const SCOPES = [
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.Read",
  "Calendars.ReadWrite",
  "User.Read",
];

export const EWS_SCOPES = [
  "https://outlook.office.com/EWS.AccessAsUser.All",
];

export interface AccountConfig {
  alias: string;
  email: string;
  loginHint: string;
  clientId: string;
}

const ACCOUNTS_DEF: Record<string, Omit<AccountConfig, "clientId"> & { clientIdEnv: string }> = {
  b8n: {
    alias: "b8n",
    email: "Markus.Binder@B8n.com",
    loginHint: "Markus.Binder@B8n.com",
    clientIdEnv: "AZURE_CLIENT_ID_B8N",
  },
  boc: {
    alias: "boc",
    email: "markus.binder@blueoceancapital.de",
    loginHint: "markus.binder@blueoceancapital.de",
    clientIdEnv: "AZURE_CLIENT_ID_BOC",
  },
};

// Fall back to AZURE_CLIENT_ID for backwards compat
function resolveClientId(envKey: string): string {
  const id = process.env[envKey] || process.env.AZURE_CLIENT_ID;
  if (!id) {
    console.error(`Error: ${envKey} (or AZURE_CLIENT_ID) not set in .env`);
    process.exit(1);
  }
  return id;
}

export const ACCOUNTS: Record<string, AccountConfig> = Object.fromEntries(
  Object.entries(ACCOUNTS_DEF).map(([key, { clientIdEnv, ...rest }]) => [
    key,
    { ...rest, clientId: resolveClientId(clientIdEnv) },
  ])
);

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
