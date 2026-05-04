import { readFileSync, writeFileSync, chmodSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, "..", "..", ".session-cache.json");

export interface CachedSession {
  cookieHeader: string;
  expiresAt: number;
}

function load(): CachedSession | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as Partial<CachedSession>;
    if (!j.cookieHeader || !j.expiresAt) return null;
    return j as CachedSession;
  } catch {
    return null;
  }
}

export function save(session: CachedSession): void {
  writeFileSync(CACHE_FILE, JSON.stringify(session, null, 2), "utf-8");
  try {
    chmodSync(CACHE_FILE, 0o600);
  } catch {}
}

export function clear(): void {
  try {
    writeFileSync(CACHE_FILE, "{}", "utf-8");
  } catch {}
}

/**
 * Return the cached cookie header, throwing if missing or expired.
 * Re-run `login` to mint a fresh session (browser profile keeps the M365
 * session sticky, so it's usually silent).
 */
export async function getCookieHeader(): Promise<string> {
  const cached = load();
  if (!cached) {
    throw new Error("Not logged in. Run: npx tsx src/index.ts login");
  }
  if (cached.expiresAt < Date.now()) {
    throw new Error("Session expired. Run: npx tsx src/index.ts login");
  }
  return cached.cookieHeader;
}
