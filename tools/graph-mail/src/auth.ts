import {
  PublicClientApplication,
  Configuration,
  DeviceCodeRequest,
  SilentFlowRequest,
  AccountInfo,
  TokenCacheContext,
} from "@azure/msal-node";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { AZURE_CLIENT_ID, SCOPES, TOKEN_CACHE_DIR, AccountConfig } from "./config.js";

function getCachePath(alias: string): string {
  return resolve(TOKEN_CACHE_DIR, `${alias}.json`);
}

async function loadCache(pca: PublicClientApplication, alias: string): Promise<void> {
  const cachePath = getCachePath(alias);
  if (existsSync(cachePath)) {
    const data = await readFile(cachePath, "utf-8");
    pca.getTokenCache().deserialize(data);
  }
}

async function saveCache(pca: PublicClientApplication, alias: string): Promise<void> {
  await mkdir(TOKEN_CACHE_DIR, { recursive: true });
  const cachePath = getCachePath(alias);
  const data = pca.getTokenCache().serialize();
  await writeFile(cachePath, data, "utf-8");
}

function createPca(): PublicClientApplication {
  const config: Configuration = {
    auth: {
      clientId: AZURE_CLIENT_ID!,
      authority: "https://login.microsoftonline.com/common",
    },
  };
  return new PublicClientApplication(config);
}

export async function login(account: AccountConfig): Promise<void> {
  const pca = createPca();
  await loadCache(pca, account.alias);

  const request: DeviceCodeRequest = {
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      console.log("\n" + response.message + "\n");
    },
  };

  const result = await pca.acquireTokenByDeviceCode(request);
  if (result) {
    await saveCache(pca, account.alias);
    console.log(`Authenticated as: ${result.account?.username}`);
    console.log(`Token cached for account: ${account.alias}`);
  }
}

export async function getAccessToken(account: AccountConfig): Promise<string> {
  const pca = createPca();
  await loadCache(pca, account.alias);

  const accounts = await pca.getTokenCache().getAllAccounts();
  const matchedAccount = accounts.find(
    (a) => a.username.toLowerCase() === account.email.toLowerCase()
  );

  if (!matchedAccount) {
    console.error(
      `No cached token for ${account.alias}. Run: npx tsx src/index.ts login --account ${account.alias}`
    );
    process.exit(1);
  }

  const silentRequest: SilentFlowRequest = {
    scopes: SCOPES,
    account: matchedAccount,
  };

  try {
    const result = await pca.acquireTokenSilent(silentRequest);
    await saveCache(pca, account.alias);
    return result.accessToken;
  } catch {
    console.error(
      `Token expired for ${account.alias}. Run: npx tsx src/index.ts login --account ${account.alias}`
    );
    process.exit(1);
  }
}
