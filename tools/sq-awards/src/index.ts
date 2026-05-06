import { Command } from 'commander';
import { launchBrowser, login, ensureLoggedIn } from './browser.js';
import { searchAwards, formatResults } from './search.js';
import { SearchParams, SearchResult, RouteConfig } from './types.js';

const DEFAULT_ROUTES: RouteConfig[] = [
  { name: 'SYD-SIN', origin: 'SYD', destination: 'SIN', preferredTimeWindow: { earliest: '14:00', latest: '20:00' } },
  { name: 'SIN-FRA', origin: 'SIN', destination: 'FRA' },
  { name: 'SIN-MUC', origin: 'SIN', destination: 'MUC' },
  { name: 'SIN-BCN', origin: 'SIN', destination: 'BCN' },
  { name: 'SIN-ZRH', origin: 'SIN', destination: 'ZRH' },
];

const RETURN_ROUTES: RouteConfig[] = [
  { name: 'FRA-SIN (return)', origin: 'FRA', destination: 'SIN', preferredTimeWindow: { earliest: '18:00', latest: '23:59' } },
];

const program = new Command();

program
  .name('sq-awards')
  .description('Singapore Airlines KrisFlyer award seat search (PPS Club)')
  .version('1.0.0');

program
  .command('login')
  .description('Open browser for manual KrisFlyer login (saves session cookies)')
  .action(async () => {
    const { context } = await launchBrowser();
    // Use the default page from persistent context (or create one)
    const page = context.pages()[0] || await context.newPage();

    try {
      const success = await login(page);
      if (success) {
        console.log('Session saved. You can close the browser window.');
      } else {
        console.error('Login not detected. Try again.');
        process.exitCode = 1;
      }
    } catch (err: any) {
      if (err.message?.includes('closed')) {
        console.log('Browser closed. Session may have been saved.');
      } else {
        throw err;
      }
    } finally {
      await context.close().catch(() => {});
    }
  });

program
  .command('search')
  .description('Search award availability for a specific route')
  .requiredOption('--origin <code>', 'Origin airport code (e.g. SYD)')
  .requiredOption('--destination <code>', 'Destination airport code (e.g. SIN)')
  .requiredOption('--date <YYYY-MM-DD>', 'Travel date')
  .option('--cabin <class>', 'Cabin class: economy|premeconomy|business|first|suites', 'business')
  .option('--passengers <n>', 'Number of passengers', '1')
  .action(async (opts) => {
    const { context } = await launchBrowser();
    const page = await context.newPage();

    try {
      const loggedIn = await ensureLoggedIn(page);
      if (!loggedIn) {
        process.exitCode = 1;
        return;
      }

      const params: SearchParams = {
        origin: opts.origin.toUpperCase(),
        destination: opts.destination.toUpperCase(),
        date: opts.date,
        cabinClass: opts.cabin,
        passengers: parseInt(opts.passengers),
      };

      const result = await searchAwards(page, params);
      console.log(formatResults([result]));
      // Session auto-saved by persistent browser context
    } finally {
      await context.close();
    }
  });

program
  .command('scan')
  .description('Scan all default routes (SYD-SIN, SIN-FRA/MUC/BCN/ZRH)')
  .requiredOption('--date <YYYY-MM-DD>', 'Travel date for outbound')
  .option('--return-date <YYYY-MM-DD>', 'Return date (searches FRA→SIN evening)')
  .option('--cabin <class>', 'Cabin class', 'business')
  .option('--routes <routes>', 'Comma-separated route filter (e.g. SYD-SIN,SIN-FRA)', '')
  .action(async (opts) => {
    const { context } = await launchBrowser();
    const page = await context.newPage();

    try {
      const loggedIn = await ensureLoggedIn(page);
      if (!loggedIn) {
        process.exitCode = 1;
        return;
      }

      let routes = [...DEFAULT_ROUTES];
      if (opts.returnDate) {
        routes = [...routes, ...RETURN_ROUTES];
      }

      if (opts.routes) {
        const filter = opts.routes.split(',').map((r: string) => r.trim().toUpperCase());
        routes = routes.filter(r => filter.includes(r.name.toUpperCase().replace(' (RETURN)', '')));
      }

      const results: SearchResult[] = [];

      for (const route of routes) {
        const date = route.name.includes('return') ? opts.returnDate : opts.date;
        const params: SearchParams = {
          origin: route.origin,
          destination: route.destination,
          date,
          cabinClass: opts.cabin,
        };

        const result = await searchAwards(page, params);

        if (route.preferredTimeWindow && result.flights.length > 0) {
          result.flights.forEach(f => {
            const depTime = f.departureTime.replace(':', '');
            const earliest = route.preferredTimeWindow!.earliest.replace(':', '');
            const latest = route.preferredTimeWindow!.latest.replace(':', '');
            if (depTime < earliest || depTime > latest) {
              f.availableSeats = `${f.availableSeats} (outside preferred)`;
            }
          });
        }

        results.push(result);
        await page.waitForTimeout(2000);
      }

      console.log(formatResults(results));
      // Session auto-saved by persistent browser context
    } finally {
      await context.close();
    }
  });

program.parse();
