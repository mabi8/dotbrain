import { Command } from "commander";
import { readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { resolve, basename, extname } from "path";
import { lookup } from "mime-types";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");
loadEnv({ path: ENV_PATH });

import { CenterDeviceClient, type CDConfig } from "./client.js";

function getBaseConfig() {
  return {
    baseUrl: process.env.CD_BASE_URL || "https://api.centerdevice.de/v2",
    authUrl: process.env.CD_AUTH_URL || "https://auth.centerdevice.de",
    clientId: process.env.CD_CLIENT_ID || "",
    clientSecret: process.env.CD_CLIENT_SECRET || "",
  };
}

function createClient(): CenterDeviceClient {
  const base = getBaseConfig();
  let refreshToken = process.env.CD_REFRESH_TOKEN || "";

  // Fall back to cached refresh token from login
  if (!refreshToken) {
    const cachePath = resolve(__dirname, "..", ".token-cache.json");
    try {
      const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
      if (cache.refresh_token) refreshToken = cache.refresh_token;
    } catch { /* no cache */ }
  }

  const config: CDConfig = { ...base, refreshToken };

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    console.error("Missing credentials. Run 'cd-upload login' first, or set CD_CLIENT_ID, CD_CLIENT_SECRET, CD_REFRESH_TOKEN in .env");
    process.exit(1);
  }

  return new CenterDeviceClient(config);
}

const program = new Command();
program.name("centerdevice-upload").description("Upload files to CenterDevice").version("1.0.0");

// ─── login ──────────────────────────────────────────────────────────

program
  .command("login")
  .description("Authenticate with CenterDevice via browser OAuth flow")
  .action(async () => {
    const base = getBaseConfig();
    if (!base.clientId || !base.clientSecret) {
      console.error("Set CD_CLIENT_ID and CD_CLIENT_SECRET in .env first.");
      process.exit(1);
    }

    const redirectUri = "https://box.makkib.com:9443/auth/callback";

    const authUrl = `${base.authUrl}/authorize?` + new URLSearchParams({
      client_id: base.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
    }).toString();

    console.log(`\nOpen this URL in your browser and log in:\n\n  ${authUrl}\n`);
    console.log("After login, the browser will redirect. Copy the full URL from the address bar.\n");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const input = await new Promise<string>((res) => {
      rl.question("Paste the code or callback URL here: ", (answer) => {
        rl.close();
        res(answer.trim());
      });
    });

    // Accept either a bare code or a full callback URL with ?code=...
    let code = input;
    if (input.includes("code=")) {
      const url = new URL(input);
      code = url.searchParams.get("code") || input;
    }

    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const credentials = Buffer.from(`${base.clientId}:${base.clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${base.authUrl}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error(`Token exchange failed (${tokenRes.status}): ${text}`);
      process.exit(1);
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Save to token cache
    const cachePath = resolve(__dirname, "..", ".token-cache.json");
    writeFileSync(cachePath, JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    }, null, 2));

    // Update .env with refresh token
    let envContent = readFileSync(ENV_PATH, "utf-8");
    envContent = envContent.replace(
      /^CD_REFRESH_TOKEN=.*$/m,
      `CD_REFRESH_TOKEN=${tokens.refresh_token}`
    );
    writeFileSync(ENV_PATH, envContent);

    console.log("\nLogin successful! Tokens saved.");
  });

// ─── whoami ──────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show current CenterDevice user (verifies credentials)")
  .action(async () => {
    const cd = createClient();
    const user = await cd.getCurrentUser();
    console.log(JSON.stringify(user, null, 2));
  });

// ─── download ───────────────────────────────────────────────────────

program
  .command("download <document-ids...>")
  .description("Download one or more documents by ID")
  .option("-o, --output <dir>", "Output directory", ".")
  .option("-v, --version <n>", "Document version number")
  .action(async (documentIds: string[], opts) => {
    const cd = createClient();
    const outDir = resolve(opts.output);

    for (const docId of documentIds) {
      try {
        const { data, filename } = await cd.downloadDocument(
          docId,
          opts.version ? parseInt(opts.version, 10) : undefined
        );
        const outPath = resolve(outDir, filename);
        writeFileSync(outPath, data);
        const sizeMB = (data.length / 1024 / 1024).toFixed(2);
        console.log(`  ✓ ${filename} (${sizeMB} MB) → ${outPath}`);
      } catch (err: unknown) {
        console.error(`  ✗ ${docId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  });

// ─── upload ──────────────────────────────────────────────────────────

program
  .command("upload <files...>")
  .description("Upload one or more files to CenterDevice")
  .option("-c, --collection <id>", "Target collection ID")
  .option("-f, --folder <id>", "Target folder ID")
  .option("-t, --tag <tags...>", "Tags to apply")
  .option("--title <title>", "Document title (single file only)")
  .option("--dry", "Show what would be uploaded without uploading")
  .action(async (files: string[], opts) => {
    const cd = createClient();

    // Expand directories to their files (non-recursive)
    const resolvedFiles: string[] = [];
    for (const f of files) {
      const p = resolve(f);
      const stat = statSync(p);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(p)) {
          const child = resolve(p, entry);
          if (statSync(child).isFile()) resolvedFiles.push(child);
        }
      } else {
        resolvedFiles.push(p);
      }
    }

    if (resolvedFiles.length === 0) {
      console.error("No files to upload.");
      process.exit(1);
    }

    if (opts.title && resolvedFiles.length > 1) {
      console.error("--title can only be used with a single file.");
      process.exit(1);
    }

    for (const filePath of resolvedFiles) {
      const filename = basename(filePath);
      const contentType = lookup(filePath) || "application/octet-stream";
      const size = statSync(filePath).size;
      const sizeMB = (size / 1024 / 1024).toFixed(2);

      if (opts.dry) {
        console.log(`[dry] ${filename} (${sizeMB} MB, ${contentType})`);
        if (opts.collection) console.log(`  → collection: ${opts.collection}`);
        if (opts.folder) console.log(`  → folder: ${opts.folder}`);
        if (opts.tag) console.log(`  → tags: ${opts.tag.join(", ")}`);
        continue;
      }

      console.log(`Uploading ${filename} (${sizeMB} MB)...`);
      const data = readFileSync(filePath);

      const result = await cd.uploadDocument({
        filename,
        data,
        contentType,
        title: opts.title,
        collections: opts.collection ? [opts.collection] : undefined,
        folders: opts.folder ? [opts.folder] : undefined,
        tags: opts.tag,
      });

      const docId = result.location?.split("/").pop() || "unknown";
      console.log(`  ✓ ${filename} → ${docId}`);
    }
  });

// ─── upload-version ──────────────────────────────────────────────────

program
  .command("upload-version <document-id> <file>")
  .description("Upload a new version of an existing document")
  .action(async (documentId: string, file: string) => {
    const cd = createClient();
    const filePath = resolve(file);
    const filename = basename(filePath);
    const contentType = lookup(filePath) || "application/octet-stream";
    const data = readFileSync(filePath);

    console.log(`Uploading new version of ${documentId}...`);
    await cd.uploadNewVersion({ documentId, filename, data, contentType });
    console.log(`  ✓ ${filename} → ${documentId} (new version)`);
  });

// ─── collections ─────────────────────────────────────────────────────

program
  .command("collections")
  .description("List all collections")
  .action(async () => {
    const cd = createClient();
    const result = (await cd.listCollections()) as { collections?: Array<{ id: string; name: string }> };
    const collections = result.collections || [];
    if (collections.length === 0) {
      console.log("No collections found.");
      return;
    }
    console.log("ID".padEnd(40) + "Name");
    console.log("-".repeat(80));
    for (const c of collections) {
      console.log(`${c.id.padEnd(40)}${c.name}`);
    }
  });

// ─── folders ─────────────────────────────────────────────────────────

program
  .command("folders")
  .description("List folders")
  .option("-c, --collection <id>", "Filter by collection ID")
  .option("-p, --parent <id>", "Filter by parent folder ID")
  .action(async (opts) => {
    const cd = createClient();
    const result = (await cd.listFolders({
      collection: opts.collection,
      parent: opts.parent,
    })) as { folders?: Array<{ id: string; name: string; parent?: string }> };
    const folders = result.folders || [];
    if (folders.length === 0) {
      console.log("No folders found.");
      return;
    }
    console.log("ID".padEnd(40) + "Name");
    console.log("-".repeat(80));
    for (const f of folders) {
      console.log(`${f.id.padEnd(40)}${f.name}`);
    }
  });

// ─── search ──────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search documents by fulltext")
  .option("-c, --collection <id>", "Filter by collection")
  .option("-t, --tag <tags...>", "Filter by tags")
  .option("-n, --rows <n>", "Number of results", "20")
  .action(async (query: string, opts) => {
    const cd = createClient();
    const result = (await cd.searchDocuments({
      query,
      collection: opts.collection,
      tags: opts.tag,
      rows: parseInt(opts.rows, 10),
    })) as { documents?: Array<{ id: string; filename: string; "upload-date"?: string; tags?: string[] }> };
    const docs = result.documents || [];
    if (docs.length === 0) {
      console.log("No documents found.");
      return;
    }
    console.log(`${docs.length} result(s):\n`);
    console.log("Date".padEnd(14) + "ID".padEnd(40) + "Filename");
    console.log("-".repeat(100));
    for (const d of docs) {
      const date = d["upload-date"]?.split("T")[0] || "?";
      console.log(`${date.padEnd(14)}${d.id.padEnd(40)}${d.filename}`);
    }
  });

program.parse();
