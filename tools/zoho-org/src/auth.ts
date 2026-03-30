import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { AUTH_URL, ZohoConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = resolve(__dirname, "..", ".token-cache.json");

interface TokenCache {
  accessToken: string;
  expiry: number;
}

function loadCache(): TokenCache | null {
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    if (data.accessToken && data.expiry > Date.now()) {
      return data;
    }
  } catch {}
  return null;
}

function saveCache(cache: TokenCache): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(cache), "utf-8");
}

export async function getAccessToken(config: ZohoConfig): Promise<string> {
  const cached = loadCache();
  if (cached) {
    return cached.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const res = await fetch(AUTH_URL, {
    method: "POST",
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Auth failed: ${res.status} ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  if (data.error) {
    console.error(`Auth error: ${data.error}`);
    process.exit(1);
  }

  const cache: TokenCache = {
    accessToken: data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveCache(cache);
  return cache.accessToken;
}
