import { AUTH_URL, ZohoConfig } from "./config.js";

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getAccessToken(config: ZohoConfig): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
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

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}
