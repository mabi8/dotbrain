import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

const SQ_HOME = 'https://www.singaporeair.com/en_UK/au/home#/book/bookflight';
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'output');
const USER_DATA_DIR = path.join(import.meta.dirname, '..', '.browser-data');

export async function launchBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  // Persistent context: cookies, CAPTCHA solutions, and fingerprint survive across runs.
  // SQ blocks headless — use xvfb-run for invisible execution.
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  return { browser: context.browser()!, context }; // browser may be null for persistent ctx
}

export async function navigateToHome(page: Page): Promise<void> {
  await page.goto(SQ_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
}

/**
 * Interactive login: opens browser, user logs in manually.
 * Persistent context retains the session automatically.
 */
export async function login(page: Page): Promise<boolean> {
  console.log('Opening SQ website for manual login...');
  console.log('Please log in to your KrisFlyer/PPS account in the browser window.');
  console.log('The tool will detect when you are logged in.\n');

  await navigateToHome(page);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const maxWait = 10 * 60 * 1000; // 10 minutes
  const startTime = Date.now();
  let lastStatus = '';

  while (Date.now() - startTime < maxWait) {
    // Check current page state
    const status = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      if (text.includes('Access Blocked')) return 'captcha';
      if (text.includes('Oops! Something went wrong')) return 'error';
      return 'page';
    }).catch(() => 'closed');

    if (status === 'closed') {
      console.log('\nBrowser closed.');
      return false;
    }

    if (status === 'captcha' && lastStatus !== 'captcha') {
      console.log('\nCAPTCHA detected — please solve it in the browser window.');
      lastStatus = 'captcha';
    } else if (status === 'error' && lastStatus !== 'error') {
      console.log('\nError page detected — try refreshing (Ctrl+R) in the browser.');
      lastStatus = 'error';
    }

    // Check login state
    const loggedIn = await verifyLoggedIn(page).catch(() => false);
    if (loggedIn) {
      console.log('\nLogin detected! Session saved in persistent browser profile.');
      return true;
    }

    if (status === 'page' && lastStatus !== 'page') {
      console.log('Page loaded. Click "Redeem flights" → log in with your KrisFlyer credentials.');
      lastStatus = 'page';
    }

    await page.waitForTimeout(5000);
  }

  console.log('\nLogin timed out after 10 minutes.');
  return false;
}

async function verifyLoggedIn(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(async () => {
      const r = await fetch('/home/getNonCacheableData.form');
      const d = await r.json();
      return d.isLoggedInUser === true;
    });
  } catch {
    return false;
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  await navigateToHome(page);
  return verifyLoggedIn(page);
}

export async function ensureLoggedIn(page: Page): Promise<boolean> {
  const alreadyLoggedIn = await isLoggedIn(page);
  if (alreadyLoggedIn) {
    console.log('Session valid');
    return true;
  }
  console.log('Session expired. Run: sq-awards login');
  return false;
}
