import { Command } from "commander";
import { getConfig } from "./config.js";
import { QplixError, Method } from "./client.js";
import { raw } from "./api/raw.js";
import * as le from "./api/legalEntities.js";
import * as rep from "./api/reporting.js";
import * as cli from "./api/clients.js";
import { browserLogin } from "./auth/browser-login.js";
import { save as saveSession, clear as clearSession } from "./auth/token-cache.js";

const program = new Command();

program.name("qplix-api").description("CLI for QPlix REST API").version("0.1.0");

function out(v: unknown) {
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
}

function fail(e: unknown): never {
  if (e instanceof QplixError) {
    console.error(`HTTP ${e.status}: ${e.message}`);
    if (e.body) console.error(typeof e.body === "string" ? e.body : JSON.stringify(e.body, null, 2));
  } else {
    console.error((e as Error).message ?? e);
  }
  process.exit(1);
}

async function run<T>(fn: () => Promise<T>): Promise<void> {
  try {
    out(await fn());
  } catch (e) {
    fail(e);
  }
}

// === auth ===

program
  .command("login")
  .description("Open a browser, complete SSO, mint F5 session cookies. Persists browser profile so re-logins are quick.")
  .option("--timeout <seconds>", "max wait for login", (v) => parseInt(v) * 1000, 5 * 60 * 1000)
  .option("--debug", "log diagnostic info")
  .action(async (opts) => {
    const config = getConfig();
    try {
      const result = await browserLogin({
        baseUrl: config.baseUrl,
        timeoutMs: opts.timeout,
        debug: opts.debug,
        onStatus: (m) => console.log(m),
      });
      saveSession({
        cookieHeader: result.cookieHeader,
        expiresAt: result.expiresAt,
      });
      const minsLeft = Math.max(0, Math.round((result.expiresAt - Date.now()) / 60000));
      console.log(`✓ Session cached for ${minsLeft} min. Re-run \`login\` when API calls start returning 401.`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("logout")
  .description("Clear cached session (browser profile preserved — use --hard to wipe profile too)")
  .option("--hard", "also remove persistent browser profile")
  .action(async (opts) => {
    clearSession();
    if (opts.hard) {
      const { rmSync } = await import("fs");
      const { resolve, dirname } = await import("path");
      const { fileURLToPath } = await import("url");
      const here = dirname(fileURLToPath(import.meta.url));
      const profileDir = resolve(here, "..", ".browser-profile");
      try {
        rmSync(profileDir, { recursive: true, force: true });
        console.log(`Browser profile removed: ${profileDir}`);
      } catch {}
    }
    console.log("Session cache cleared.");
  });

// === raw passthrough ===

const rawCmd = program.command("raw").description("Raw API passthrough (escape hatch)");

rawCmd
  .command("get <path>")
  .description("GET any QPlix API path, e.g. /qapi/v1/clients")
  .option("-q, --query <kv...>", "query params as key=value pairs")
  .action(async (path: string, opts) => {
    const config = getConfig();
    const query: Record<string, string> = {};
    for (const kv of opts.query ?? []) {
      const [k, ...rest] = kv.split("=");
      query[k] = rest.join("=");
    }
    await run(() => raw(config, "GET", path, { query }));
  });

rawCmd
  .command("post <path>")
  .description("POST any QPlix API path with JSON body from --body or stdin")
  .option("-b, --body <json>", "JSON body string")
  .action(async (path: string, opts) => {
    const config = getConfig();
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    await run(() => raw(config, "POST", path, { body }));
  });

rawCmd
  .command("call <method> <path>")
  .description("Any-method passthrough (PUT/DELETE/PATCH)")
  .option("-b, --body <json>", "JSON body string")
  .action(async (method: string, path: string, opts) => {
    const config = getConfig();
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    await run(() => raw(config, method.toUpperCase() as Method, path, { body }));
  });

// === clients ===

const clients = program.command("clients").description("Client (top-level owner) endpoints");

clients
  .command("list")
  .description("List clients")
  .option("--skip <n>", "skip", parseInt)
  .option("--limit <n>", "limit", parseInt)
  .action(async (opts) => {
    const config = getConfig();
    await run(() => cli.listClients(config, { skip: opts.skip, limit: opts.limit }));
  });

clients
  .command("get <clientId>")
  .description("Get client details")
  .action(async (clientId: string) => {
    const config = getConfig();
    await run(() => cli.getClient(config, clientId));
  });

clients
  .command("groups <clientId>")
  .description("Get client groups")
  .action(async (clientId: string) => {
    const config = getConfig();
    await run(() => cli.getClientGroups(config, clientId));
  });

clients
  .command("transactions <clientId> <presetId>")
  .description("Run client-level transaction preset")
  .action(async (clientId: string, presetId: string) => {
    const config = getConfig();
    await run(() => cli.getClientTransactionQueryResults(config, clientId, presetId));
  });

// === legal entities ===

const legal = program.command("le").description("Legal entity (portfolio) endpoints");

legal
  .command("list")
  .description("List legal entities (portfolios)")
  .option("-s, --search <q>", "search filter")
  .option("--include-virtual", "include virtual entities")
  .option("--skip <n>", "skip", parseInt)
  .option("--limit <n>", "limit", parseInt)
  .action(async (opts) => {
    const config = getConfig();
    await run(() =>
      le.listLegalEntities(config, {
        search: opts.search,
        includeVirtualEntities: opts.includeVirtual,
        skip: opts.skip,
        limit: opts.limit,
      })
    );
  });

legal
  .command("get <id>")
  .description("Get legal entity details")
  .option("--inherited", "include inherited properties")
  .action(async (id: string, opts) => {
    const config = getConfig();
    await run(() =>
      le.getLegalEntity(config, id, { includeInheritedProperties: opts.inherited })
    );
  });

legal
  .command("custodians <id>")
  .description("List custodians for a legal entity")
  .action(async (id: string) => {
    const config = getConfig();
    await run(() => le.getCustodians(config, id));
  });

legal
  .command("bank-accounts <id> <custodianId>")
  .description("List bank accounts under a legal entity + custodian")
  .action(async (id: string, custodianId: string) => {
    const config = getConfig();
    await run(() => le.getBankAccounts(config, id, custodianId));
  });

legal
  .command("properties <id>")
  .description("Get legal entity properties")
  .action(async (id: string) => {
    const config = getConfig();
    await run(() => le.getProperties(config, id));
  });

legal
  .command("documents <id> [path]")
  .description("Browse the legal entity document tree")
  .action(async (id: string, path: string | undefined) => {
    const config = getConfig();
    await run(() => le.getDocumentTree(config, id, path));
  });

legal
  .command("query <id> <presetId>")
  .description("Run a saved positions/holdings preset against a legal entity")
  .option("--start-date <d>", "start date (YYYY-MM-DD)")
  .option("--due-date <d>", "due date (YYYY-MM-DD)")
  .option("--interval <i>", "interval")
  .option("--grouping <g>", "grouping type")
  .option("--group-id <id>", "group id")
  .action(async (id: string, presetId: string, opts) => {
    const config = getConfig();
    await run(() =>
      le.getQueryResults(config, id, presetId, {
        startDate: opts.startDate,
        dueDate: opts.dueDate,
        interval: opts.interval,
        groupingType: opts.grouping,
        groupId: opts.groupId,
      })
    );
  });

legal
  .command("transactions <id> <presetId>")
  .description("Run a saved transaction preset against a legal entity")
  .option("--from <d>", "from date (YYYY-MM-DD)")
  .option("--due-date <d>", "due date (YYYY-MM-DD)")
  .option("--client-group-id <id>", "client group id")
  .action(async (id: string, presetId: string, opts) => {
    const config = getConfig();
    await run(() =>
      le.getTransactionQueryResults(config, id, presetId, {
        from: opts.from,
        dueDate: opts.dueDate,
        clientGroupId: opts.clientGroupId,
      })
    );
  });

// === reporting ===

const reports = program.command("reports").description("Reporting endpoints");

reports
  .command("list")
  .description("List reports")
  .option("--legal-entity <id...>", "filter by legal entity id (repeatable)")
  .option("--released-only", "only released")
  .option("--unreleased-only", "only unreleased")
  .option("--name <q>", "name filter")
  .option("--client <id>", "client id")
  .option("--due-date <d>", "due date")
  .option("--start-date <d>", "start date")
  .option("--skip <n>", "skip", parseInt)
  .option("--limit <n>", "limit", parseInt)
  .action(async (opts) => {
    const config = getConfig();
    await run(() =>
      rep.listReports(config, {
        legalEntityIds: opts.legalEntity,
        releasedOnly: opts.releasedOnly,
        unReleasedOnly: opts.unreleasedOnly,
        name: opts.name,
        clientId: opts.client,
        dueDate: opts.dueDate,
        startDate: opts.startDate,
        skip: opts.skip,
        limit: opts.limit,
      })
    );
  });

reports
  .command("get <id>")
  .description("Get report details")
  .action(async (id: string) => {
    const config = getConfig();
    await run(() => rep.getReport(config, id));
  });

reports
  .command("templates")
  .description("List report templates")
  .option("--skip <n>", "skip", parseInt)
  .option("--limit <n>", "limit", parseInt)
  .action(async (opts) => {
    const config = getConfig();
    await run(() => rep.listReportTemplates(config, { skip: opts.skip, limit: opts.limit }));
  });

reports
  .command("template <id>")
  .description("Get report template details")
  .action(async (id: string) => {
    const config = getConfig();
    await run(() => rep.getReportTemplate(config, id));
  });

reports
  .command("pdf <id> <outPath>")
  .description("Download report PDF to a file")
  .action(async (id: string, outPath: string) => {
    const config = getConfig();
    try {
      await rep.downloadReportPdf(config, id, outPath);
      console.log(`Saved → ${outPath}`);
    } catch (e) {
      fail(e);
    }
  });

program.parseAsync().catch(fail);
