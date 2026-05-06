import { Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SearchParams, Flight, SearchResult } from './types.js';

const SQ_HOME = 'https://www.singaporeair.com/en_UK/au/home#/book/bookflight';
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'output');

const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  premeconomy: 'Premium Economy',
  business: 'Business',
  first: 'First/Suites',
  suites: 'First/Suites',
};

async function getCenter(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, selector);
}

export async function searchAwards(page: Page, params: SearchParams): Promise<SearchResult> {
  const cabinLabel = CABIN_LABELS[params.cabinClass] || 'Business';
  console.log(`\nSearching: ${params.origin}→${params.destination} on ${params.date} in ${params.cabinClass}...`);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Navigate and select Redeem
    await page.goto(SQ_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check for CAPTCHA block
    const blocked = await page.evaluate(() => document.body.innerText.includes('Access Blocked'));
    if (blocked) {
      return { params, flights: [], searchedAt: new Date().toISOString(),
        error: 'CAPTCHA blocked. Run "sq-awards login" to solve it, then retry.' };
    }
    await page.locator('#redeemFlights').click({ force: true });
    await page.waitForTimeout(1500);

    // --- Origin ---
    const origR = await getCenter(page, '#flightOrigin2');
    if (origR) {
      await page.mouse.click(origR.x, origR.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(params.origin, { delay: 80 });
      await page.waitForTimeout(2000);
      await page.locator('.suggestion__entry').first().click({ force: true });
      await page.waitForTimeout(500);
    }

    // --- Destination ---
    const destR = await getCenter(page, '#redeemFlightDestination');
    if (destR) {
      await page.mouse.click(destR.x, destR.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(params.destination, { delay: 80 });
      await page.waitForTimeout(2000);
      await page.locator('.suggestion__entry').first().click({ force: true });
      await page.waitForTimeout(500);
    }

    // --- Open calendar ---
    const dateR = await getCenter(page, '#departDate2');
    if (dateR) await page.mouse.click(dateR.x, dateR.y);
    await page.waitForTimeout(1000);

    // --- One-way checkbox ---
    const owR = await getCenter(page, 'label[for="oneway_id"]');
    if (owR) {
      await page.mouse.click(owR.x, owR.y);
      await page.waitForTimeout(500);
    }

    // --- Navigate to target month ---
    const [year, month, day] = params.date.split('-').map(Number);
    const targetMonth = new Date(year, month - 1).toLocaleString('en', { month: 'long' });
    const targetLabel = `${targetMonth} ${year}`;

    await page.locator('.calendar-date-field').first().click({ force: true });
    await page.keyboard.press('Control+a');
    await page.keyboard.type(targetMonth.substring(0, 3), { delay: 60 });
    await page.waitForTimeout(1500);
    const suggestion = page.locator(`.calendar-date-suggestion:has-text("${targetLabel}")`).first();
    if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
      await suggestion.click({ force: true });
      await page.waitForTimeout(800);
    }

    // --- Click the day ---
    const dateData = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayR = await getCenter(page, `li[date-data="${dateData}"]`);
    if (dayR) {
      await page.mouse.click(dayR.x, dayR.y);
      await page.waitForTimeout(500);
    }

    // --- Close calendar ---
    await page.mouse.click(100, 50);
    await page.waitForTimeout(500);

    // --- Cabin class ---
    const cabinR = await getCenter(page, '#flightClass2');
    if (cabinR) {
      await page.mouse.click(cabinR.x, cabinR.y);
      await page.waitForTimeout(800);
      const cabinOpt = page.locator(`li:has-text("${cabinLabel}")`).first();
      if (await cabinOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cabinOpt.click({ force: true });
        await page.waitForTimeout(500);
      }
    }

    // --- Click SEARCH ---
    const searchR = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const s = btns.find(b => b.textContent?.trim() === 'Search' && (b as HTMLElement).offsetParent !== null);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (searchR) await page.mouse.click(searchR.x, searchR.y);

    // --- Wait for results page ---
    console.log('Waiting for results...');
    try {
      await page.waitForURL('**/redemption/**', { timeout: 30000 });
    } catch {
      // Might already be on results
    }
    await page.waitForTimeout(10000);

    // Screenshot
    const ssName = `results_${params.origin}_${params.destination}_${params.date}.png`;
    await page.screenshot({ path: path.join(OUTPUT_DIR, ssName), fullPage: true });
    console.log(`Screenshot: output/${ssName}`);

    // --- Parse results ---
    const pageText = await page.locator('body').innerText();

    // Check for no availability
    if (pageText.includes('no available') || pageText.includes('No flights') || pageText.includes('no award')) {
      return { params, flights: [], searchedAt: new Date().toISOString(), error: 'No award flights available' };
    }

    const flights = parseFlightsFromText(pageText, params);
    return { params, flights, searchedAt: new Date().toISOString() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Search error: ${msg}`);
    try { await page.screenshot({ path: path.join(OUTPUT_DIR, `error_${params.origin}_${params.destination}.png`), fullPage: true }); } catch {}
    return { params, flights: [], searchedAt: new Date().toISOString(), error: msg };
  }
}

/**
 * Parse award flight results from page text.
 * SQ results format per flight block:
 *   "Non stop • 8hr 15mins"
 *   "SYD 18:00 SYDNEY 01 Jul (Wed)"
 *   "SIN 00:15 SINGAPORE 02 Jul (Thu)"
 *   "Singapore Airlines • SQ 242"
 *   "Saver FROM 29,000 miles"  / "Waitlist SAVER FROM 29,000 miles"
 *   "Advantage FROM 60,500 miles" / "Waitlist ADVANTAGE FROM 60,500 miles"
 *   "Access FROM 87,000 miles"
 *   "ECONOMY" or "BUSINESS" etc.
 */
function parseFlightsFromText(text: string, params: SearchParams): Flight[] {
  const flights: Flight[] = [];

  // Split by flight number pattern
  const blocks = text.split(/(?=(?:Non stop|1 stop|\d+ stops))/i);

  for (const block of blocks) {
    const flightMatch = block.match(/SQ\s*(\d{2,4})/);
    if (!flightMatch) continue;

    const flightNo = `SQ${flightMatch[1]}`;

    // Extract times: "SYD 18:00" and "SIN 00:15"
    const depMatch = block.match(new RegExp(`${params.origin}\\s+(\\d{1,2}:\\d{2})`));
    const arrMatch = block.match(new RegExp(`${params.destination}\\s+(\\d{1,2}:\\d{2})`));
    const departureTime = depMatch?.[1] || '';
    const arrivalTime = arrMatch?.[1] || '';

    // Duration
    const durMatch = block.match(/(\d+)hr?\s*(\d+)?\s*min/i);
    const duration = durMatch ? `${durMatch[1]}h${durMatch[2] ? durMatch[2] + 'm' : ''}` : '';

    // Stops
    const stops = block.toLowerCase().includes('non stop') ? 0
      : block.match(/(\d+)\s*stop/i) ? parseInt(block.match(/(\d+)\s*stop/i)![1]) : 0;

    // Award types — look for Saver, Advantage, Access with availability
    const awardTypes: string[] = [];
    if (/Waitlist\s*\n?\s*SAVER/i.test(block)) awardTypes.push('Saver(WL)');
    else if (/SAVER/i.test(block) && !/Waitlist.*SAVER/i.test(block)) awardTypes.push('Saver');

    if (/Waitlist\s*\n?\s*ADVANTAGE/i.test(block)) awardTypes.push('Adv(WL)');
    else if (/ADVANTAGE/i.test(block) && !/Waitlist.*ADVANTAGE/i.test(block)) awardTypes.push('Advantage');

    if (/ACCESS/i.test(block)) awardTypes.push('Access');

    const availability = awardTypes.join(', ') || 'See details';

    // Miles — take the lowest
    const milesMatches = block.match(/([\d,]+)\s*\n?\s*miles/gi);
    let lowestMiles: number | null = null;
    if (milesMatches) {
      for (const m of milesMatches) {
        const num = parseInt(m.replace(/[^\d]/g, ''));
        if (!lowestMiles || num < lowestMiles) lowestMiles = num;
      }
    }

    // Cabin class from block
    const cabinMatch = block.match(/\b(ECONOMY|BUSINESS|FIRST|PREMIUM ECONOMY|SUITES)\b/i);
    const cabin = cabinMatch?.[1] || params.cabinClass;

    flights.push({
      flightNo, origin: params.origin, destination: params.destination,
      departureTime, arrivalTime, duration, aircraft: '', stops,
      cabinClass: cabin, availableSeats: availability,
      milesRequired: lowestMiles, taxesAndFees: null,
    });
  }

  return flights;
}

export function formatResults(results: SearchResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`\n${'='.repeat(80)}`);
    lines.push(`${result.params.origin} -> ${result.params.destination} | ${result.params.date} | ${result.params.cabinClass.toUpperCase()}`);
    lines.push('='.repeat(80));
    if (result.error) { lines.push(`  ! ${result.error}`); continue; }
    if (result.flights.length === 0) { lines.push('  No award availability found'); continue; }
    lines.push(`  ${'Flight'.padEnd(10)} ${'Depart'.padEnd(8)} ${'Arrive'.padEnd(8)} ${'Duration'.padEnd(10)} ${'Stops'.padEnd(6)} ${'Cabin'.padEnd(10)} ${'Availability'.padEnd(25)} ${'Miles'.padEnd(10)}`);
    lines.push(`  ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(10)} ${'-'.repeat(6)} ${'-'.repeat(10)} ${'-'.repeat(25)} ${'-'.repeat(10)}`);
    for (const f of result.flights) {
      lines.push(`  ${f.flightNo.padEnd(10)} ${f.departureTime.padEnd(8)} ${f.arrivalTime.padEnd(8)} ${f.duration.padEnd(10)} ${String(f.stops).padEnd(6)} ${f.cabinClass.padEnd(10)} ${f.availableSeats.padEnd(25)} ${(f.milesRequired ? f.milesRequired.toLocaleString() : '-').padEnd(10)}`);
    }
  }
  lines.push(`\nSearched at: ${new Date().toISOString()}`);
  return lines.join('\n');
}
