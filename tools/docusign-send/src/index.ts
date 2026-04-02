import { Command } from "commander";
import { resolve, basename } from "path";
import { writeFileSync } from "fs";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");
loadEnv({ path: ENV_PATH });

import { DocuSignClient, type DSConfig } from "./client.js";

function getConfig(): DSConfig {
  const config: DSConfig = {
    integrationKey: process.env.DS_INTEGRATION_KEY || "",
    userId: process.env.DS_USER_ID || "",
    accountId: process.env.DS_ACCOUNT_ID || "",
    baseUri: process.env.DS_BASE_URI || "https://na4.docusign.net",
    privateKeyPath: process.env.DS_PRIVATE_KEY_PATH || "./private.key",
  };

  if (!config.integrationKey || !config.userId || !config.accountId) {
    console.error(
      "Missing credentials. Set DS_INTEGRATION_KEY, DS_USER_ID, DS_ACCOUNT_ID in .env"
    );
    process.exit(1);
  }

  return config;
}

function createClient(): DocuSignClient {
  return new DocuSignClient(getConfig());
}

const program = new Command();
program
  .name("docusign-send")
  .description("Send documents for signature via DocuSign")
  .version("1.0.0");

// ─── whoami ──────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Verify credentials and show user info")
  .action(async () => {
    const ds = createClient();
    const info = await ds.getUserInfo();
    console.log(JSON.stringify(info, null, 2));
  });

// ─── send ────────────────────────────────────────────────────────────

program
  .command("send <files...>")
  .description("Send document(s) for signature")
  .requiredOption("--to <signers...>", 'Signers as "Name <email>" or just email')
  .option("--cc <recipients...>", 'CC recipients as "Name <email>" or just email')
  .option("-s, --subject <subject>", "Email subject line")
  .option("-m, --message <message>", "Email body message")
  .option(
    "--draft",
    "Create as draft (status=created) instead of sending immediately",
    false
  )
  .option(
    "--anchors",
    "Use anchor text placeholders (/sn1/, /dt1/, /nm1/, etc.) for signature placement"
  )
  .action(async (files: string[], opts) => {
    const ds = createClient();

    const parseRecipient = (s: string) => {
      const match = s.match(/^(.+?)\s*<([^>]+)>$/);
      if (match) return { name: match[1].trim(), email: match[2].trim() };
      return { name: s.split("@")[0], email: s };
    };

    const signers = (opts.to as string[]).map(parseRecipient);
    const ccRecipients = ((opts.cc || []) as string[]).map(parseRecipient);
    const documents = files.map((f: string) => ({
      filePath: resolve(f),
      name: basename(f),
    }));

    const subject =
      opts.subject || `Please sign: ${documents.map((d) => d.name).join(", ")}`;
    const status = opts.draft ? "created" : "sent";

    console.log(`${status === "sent" ? "Sending" : "Creating draft"}...`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Documents: ${documents.map((d) => d.name).join(", ")}`);
    console.log(`  Signers: ${signers.map((s) => `${s.name} <${s.email}>`).join(", ")}`);
    if (ccRecipients.length > 0) {
      console.log(`  CC: ${ccRecipients.map((c) => `${c.name} <${c.email}>`).join(", ")}`);
    }

    const result = await ds.createEnvelope({
      subject,
      documents,
      signers,
      ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
      message: opts.message,
      status: status as "created" | "sent",
      useAnchors: opts.anchors || false,
    });

    console.log(`\n  Envelope ID: ${result.envelopeId}`);
    console.log(`  Status: ${result.status}`);
  });

// ─── list ────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List recent envelopes")
  .option("--status <status>", "Filter by status (sent, delivered, completed, voided)")
  .option("--from <date>", "From date (YYYY-MM-DD)", () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })
  .option("-n, --count <n>", "Number of results", "20")
  .action(async (opts) => {
    const ds = createClient();
    const result = (await ds.listEnvelopes({
      fromDate: opts.from,
      status: opts.status,
      count: parseInt(opts.count, 10),
    })) as {
      envelopes?: Array<{
        envelopeId: string;
        status: string;
        emailSubject: string;
        statusChangedDateTime: string;
      }>;
    };

    const envelopes = result.envelopes || [];
    if (envelopes.length === 0) {
      console.log("No envelopes found.");
      return;
    }

    console.log(
      "Date".padEnd(14) +
        "Status".padEnd(14) +
        "ID".padEnd(40) +
        "Subject"
    );
    console.log("-".repeat(100));
    for (const e of envelopes) {
      const date = e.statusChangedDateTime?.split("T")[0] || "?";
      console.log(
        `${date.padEnd(14)}${e.status.padEnd(14)}${e.envelopeId.padEnd(40)}${e.emailSubject}`
      );
    }
  });

// ─── status ──────────────────────────────────────────────────────────

program
  .command("status <envelope-id>")
  .description("Show envelope status and recipient details")
  .action(async (envelopeId: string) => {
    const ds = createClient();
    const result = await ds.getEnvelope(envelopeId);
    console.log(JSON.stringify(result, null, 2));
  });

// ─── download ────────────────────────────────────────────────────────

program
  .command("download <envelope-id>")
  .description("Download signed document(s) from an envelope")
  .option("-o, --output <dir>", "Output directory", ".")
  .option("-d, --document <id>", "Specific document ID (default: combined)")
  .action(async (envelopeId: string, opts) => {
    const ds = createClient();
    const docId = opts.document || "combined";
    const data = await ds.downloadDocument(envelopeId, docId);
    const outPath = resolve(opts.output, `${envelopeId}-${docId}.pdf`);
    writeFileSync(outPath, data);
    const sizeMB = (data.length / 1024 / 1024).toFixed(2);
    console.log(`  ${outPath} (${sizeMB} MB)`);
  });

// ─── void ────────────────────────────────────────────────────────────

program
  .command("void <envelope-id>")
  .description("Void an in-progress envelope")
  .requiredOption("-r, --reason <reason>", "Reason for voiding")
  .action(async (envelopeId: string, opts) => {
    const ds = createClient();
    await ds.voidEnvelope(envelopeId, opts.reason);
    console.log(`Envelope ${envelopeId} voided.`);
  });

program.parse();
