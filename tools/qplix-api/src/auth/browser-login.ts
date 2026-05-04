// Headed-browser session mint for QPlix.
//
// QPlix sits behind an F5 BIG-IP reverse proxy. The /qapi/v1/* application
// API authenticates *only* by cookies — no Authorization header is used at
// all (the Okta JWT we can capture is for /qapi/user/* auth-helper endpoints
// only). The relevant cookies (MRHSession, F5_ST, Qplix_persistence,
// .AspNetCore.Cookies, .AspNetCore.Session, TS*) are session-scoped — they
// die when the browser process closes.
//
// So this script: launches Chromium with a persistent user-data-dir (which
// keeps the M365 SSO session sticky across runs), navigates to /InvestorPortal/,
// waits until the SPA fires its first /qapi/v1/* call (= F5 + app sessions
// minted), captures cookies, closes the browser. The cookies persist long
// enough to make API calls until F5's idle timeout (~30 min).

import { chromium } from "playwright";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = resolve(__dirname, "..", "..", ".browser-profile");

export interface BrowserLoginResult {
  /** Cookie header value (name=value; pairs) for the tenant host. */
  cookieHeader: string;
  /** Best-guess expiry — F5 idle timeout is ~30 min, so we cache for 25. */
  expiresAt: number;
}

export interface BrowserLoginOpts {
  baseUrl: string;
  timeoutMs?: number;
  onStatus?: (msg: string) => void;
  debug?: boolean;
}

export async function browserLogin(opts: BrowserLoginOpts): Promise<BrowserLoginResult> {
  const status = opts.onStatus ?? (() => {});
  const portalUrl = `${opts.baseUrl}/InvestorPortal/`;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  status(`Launching Chromium (profile: ${USER_DATA_DIR}) …`);
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  let sawV1 = false;
  ctx.on("request", (req) => {
    if (sawV1) return;
    if (!req.url().startsWith(opts.baseUrl + "/qapi/v1/")) return;
    sawV1 = true;
    if (opts.debug) {
      const path = req.url().slice(opts.baseUrl.length).split("?")[0];
      status(`  [debug] saw ${req.method()} ${path} — session is live`);
    }
  });

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    status(`Opening ${portalUrl} — complete SSO if prompted.`);
    await page.goto(portalUrl, { waitUntil: "domcontentloaded" });

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed() || ctx.pages().length === 0) {
        throw new Error("Browser was closed before session was minted");
      }
      if (sawV1) break;
      await page.waitForTimeout(500).catch(() => {});
    }
    if (!sawV1) {
      throw new Error(`Login timed out after ${Math.round(timeoutMs / 1000)}s`);
    }

    const cookies = await ctx.cookies(opts.baseUrl);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    if (opts.debug) {
      status(`  [debug] captured ${cookies.length} cookies: ${cookies.map((c) => c.name).join(", ")}`);
    }

    // F5 default idle timeout is ~30 min; cache for 25 to leave headroom.
    const expiresAt = Date.now() + 25 * 60 * 1000;
    status(`✓ Session minted. Closing browser …`);
    return { cookieHeader, expiresAt };
  } finally {
    await ctx.close().catch(() => {});
  }
}
