import { Command } from "commander";
import { getConfig } from "./config.js";
import * as api from "./api.js";

const program = new Command();

program
  .name("zoho-org")
  .description("CLI for Zoho Mail EU organization management")
  .version("1.0.0");

// === Organization ===

program
  .command("org")
  .description("Show organization details")
  .action(async () => {
    const config = getConfig();
    const res = await api.getOrg(config);
    console.log(JSON.stringify(res.data, null, 2));
  });

program
  .command("storage")
  .description("Show organization storage/subscription")
  .action(async () => {
    const config = getConfig();
    const res = await api.getStorage(config);
    console.log(JSON.stringify(res.data, null, 2));
  });

// === Accounts ===

const accounts = program.command("accounts").description("Manage user accounts");

accounts
  .command("list")
  .description("List all accounts")
  .action(async () => {
    const config = getConfig();
    const res = await api.listAccounts(config);
    const users = Array.isArray(res.data) ? res.data : [res.data];

    console.log("\n" + "Email".padEnd(40) + "Name".padEnd(25) + "Role".padEnd(12) + "Status");
    console.log("-".repeat(85));

    for (const u of users) {
      const email = u.primaryEmailAddress || u.mailboxAddress || "";
      const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
      const status = u.status ? "active" : "disabled";
      console.log(email.padEnd(40) + name.padEnd(25) + (u.role || "").padEnd(12) + status);
    }
  });

accounts
  .command("get <idOrEmail>")
  .description("Get account details")
  .action(async (idOrEmail: string) => {
    const config = getConfig();
    const res = await api.getAccount(config, idOrEmail);
    console.log(JSON.stringify(res.data, null, 2));
  });

accounts
  .command("add")
  .description("Add a user account")
  .requiredOption("-e, --email <email>", "Primary email address")
  .requiredOption("-p, --password <password>", "Password")
  .requiredOption("--first <name>", "First name")
  .requiredOption("--last <name>", "Last name")
  .option("--display <name>", "Display name")
  .option("--role <role>", "Role (admin/member)", "member")
  .action(async (opts) => {
    const config = getConfig();
    const res = await api.addAccount(config, {
      email: opts.email,
      password: opts.password,
      firstName: opts.first,
      lastName: opts.last,
      displayName: opts.display,
      role: opts.role,
    });
    console.log(`Account created: ${res.data.primaryEmailAddress}`);
    console.log(`ZUID: ${res.data.zuid}`);
    console.log(`Account ID: ${res.data.accountId}`);
  });

accounts
  .command("enable <accountId>")
  .description("Enable a user account")
  .action(async (accountId: string) => {
    const config = getConfig();
    await api.updateAccountStatus(config, accountId, true);
    console.log("Account enabled.");
  });

accounts
  .command("disable <accountId>")
  .description("Disable a user account")
  .action(async (accountId: string) => {
    const config = getConfig();
    await api.updateAccountStatus(config, accountId, false);
    console.log("Account disabled.");
  });

accounts
  .command("delete <zuid>")
  .description("Delete a user account")
  .action(async (zuid: string) => {
    const config = getConfig();
    await api.deleteAccount(config, zuid);
    console.log("Account deleted.");
  });

// === Domains ===

const domains = program.command("domains").description("Manage domains");

domains
  .command("list")
  .description("List all domains")
  .action(async () => {
    const config = getConfig();
    const res = await api.listDomains(config);
    const doms = res.data?.domainVO || res.data || [];

    console.log("\n" + "Domain".padEnd(35) + "Verified".padEnd(12) + "MX".padEnd(10) + "SPF".padEnd(10) + "DKIM");
    console.log("-".repeat(80));

    for (const d of Array.isArray(doms) ? doms : [doms]) {
      console.log(
        (d.domainName || "").padEnd(35) +
          (d.verificationStatus ? "yes" : "no").padEnd(12) +
          (d.mxstatus === "verified" ? "yes" : "no").padEnd(10) +
          (d.spfstatus ? "yes" : "no").padEnd(10) +
          (d.dkimstatus ? "yes" : "no")
      );
    }
  });

domains
  .command("get <domain>")
  .description("Get domain details")
  .action(async (domain: string) => {
    const config = getConfig();
    const res = await api.getDomain(config, domain);
    console.log(JSON.stringify(res.data, null, 2));
  });

domains
  .command("add <domain>")
  .description("Add a domain to the organization")
  .action(async (domain: string) => {
    const config = getConfig();
    const res = await api.addDomain(config, domain);
    console.log(`Domain added: ${domain}`);
    if (res.data?.CNAMEVerificationCode) {
      console.log(`\nVerification options:`);
      console.log(`  TXT record: Add TXT record with value from Zoho admin console`);
      console.log(`  CNAME: Point ${res.data.CNAMEVerificationCode} to business.zoho.eu`);
    }
    console.log(JSON.stringify(res.data, null, 2));
  });

domains
  .command("verify <domain>")
  .description("Verify domain ownership")
  .option("-m, --method <method>", "Verification method: txt, cname, html", "txt")
  .action(async (domain: string, opts) => {
    const config = getConfig();
    const res = await api.verifyDomain(config, domain, opts.method);
    if (res.data?.status) {
      console.log(`Domain ${domain} verified.`);
    } else {
      console.log(`Verification failed: ${res.data?.message || "unknown error"}`);
      console.log(JSON.stringify(res.data, null, 2));
    }
  });

domains
  .command("verify-mx <domain>")
  .description("Verify MX records for domain")
  .action(async (domain: string) => {
    const config = getConfig();
    const res = await api.verifyMx(config, domain);
    console.log(JSON.stringify(res.data, null, 2));
  });

domains
  .command("verify-spf <domain>")
  .description("Verify SPF record for domain")
  .action(async (domain: string) => {
    const config = getConfig();
    const res = await api.verifySPF(config, domain);
    console.log(JSON.stringify(res.data, null, 2));
  });

domains
  .command("delete <domain>")
  .description("Delete a domain")
  .action(async (domain: string) => {
    const config = getConfig();
    await api.deleteDomain(config, domain);
    console.log(`Domain ${domain} deleted.`);
  });

// === Groups ===

const groups = program.command("groups").description("Manage groups");

groups
  .command("list")
  .description("List all groups")
  .action(async () => {
    const config = getConfig();
    const res = await api.listGroups(config);
    const grps = Array.isArray(res.data) ? res.data : [res.data];

    console.log("\n" + "Email".padEnd(40) + "Name".padEnd(25) + "ZGID");
    console.log("-".repeat(80));

    for (const g of grps) {
      console.log((g.emailId || "").padEnd(40) + (g.name || "").padEnd(25) + (g.zgid || ""));
    }
  });

groups
  .command("get <zgid>")
  .description("Get group details")
  .action(async (zgid: string) => {
    const config = getConfig();
    const res = await api.getGroup(config, zgid);
    console.log(JSON.stringify(res.data, null, 2));
  });

groups
  .command("add")
  .description("Create a group")
  .requiredOption("-e, --email <email>", "Group email address")
  .requiredOption("-n, --name <name>", "Group name")
  .option("--description <desc>", "Group description")
  .action(async (opts) => {
    const config = getConfig();
    const res = await api.createGroup(config, {
      emailId: opts.email,
      name: opts.name,
      description: opts.description,
    });
    console.log(`Group created: ${res.data.emailId}`);
    console.log(`ZGID: ${res.data.zgid}`);
  });

groups
  .command("delete <zgid>")
  .description("Delete a group")
  .action(async (zgid: string) => {
    const config = getConfig();
    await api.deleteGroup(config, zgid);
    console.log("Group deleted.");
  });

program.parse();
