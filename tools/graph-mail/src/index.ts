import { Command } from "commander";
import { getAccount } from "./config.js";
import { login, getAccessToken } from "./auth.js";
import {
  createGraphClient,
  searchEmails,
  fetchThread,
  downloadAttachments,
} from "./graph.js";
import { sendEmail, replyToEmail } from "./send.js";
import {
  listEvents,
  searchEvents,
  getEvent,
  createEvent,
  respondToEvent,
  deleteEvent,
  printEventsTable,
  printEventDetail,
} from "./calendar.js";

const program = new Command();

program
  .name("graph-mail")
  .description("CLI tool for Microsoft 365 email & calendar via Graph API")
  .version("1.1.0");

// login
program
  .command("login")
  .description("Authenticate with Microsoft 365 via device code flow")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    await login(account);
  });

// search
program
  .command("search")
  .description("Search emails")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-q, --query <query>", "Search query")
  .option("-l, --limit <n>", "Max results", "20")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);
    const results = await searchEmails(client, opts.query, parseInt(opts.limit));

    if (results.length === 0) {
      console.log("No results found.");
      return;
    }

    console.log(`\n${results.length} result(s):\n`);
    console.log(
      "Date".padEnd(12) +
        "From".padEnd(35) +
        "Att".padEnd(5) +
        "Subject"
    );
    console.log("-".repeat(90));

    for (const r of results) {
      const date = r.receivedDateTime.split("T")[0];
      const att = r.hasAttachments ? " \u{1f4ce}" : "   ";
      console.log(
        date.padEnd(12) +
          r.sender.slice(0, 33).padEnd(35) +
          att.padEnd(5) +
          r.subject.slice(0, 60)
      );
    }

    console.log(
      `\nConversation IDs (for --conversation-id):`
    );
    const convIds = [...new Set(results.map((r) => r.conversationId))];
    for (const id of convIds.slice(0, 5)) {
      const first = results.find((r) => r.conversationId === id)!;
      console.log(`  ${first.subject.slice(0, 60)}`);
      console.log(`    ${id}`);
    }
  });

// thread
program
  .command("thread")
  .description("Fetch a full email thread with attachments")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .option("-q, --query <query>", "Search query to find the thread")
  .option("-c, --conversation-id <id>", "Direct conversation ID")
  .requiredOption("-o, --output <dir>", "Output directory")
  .action(async (opts) => {
    if (!opts.query && !opts.conversationId) {
      console.error("Provide either --query or --conversation-id");
      process.exit(1);
    }

    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    let conversationId = opts.conversationId;

    if (!conversationId) {
      const results = await searchEmails(client, opts.query, 10);
      if (results.length === 0) {
        console.error("No emails found matching query.");
        process.exit(1);
      }
      conversationId = results[0].conversationId;
      console.log(`Found thread: ${results[0].subject}`);
    }

    await fetchThread(client, conversationId, opts.output);
  });

// attachments
program
  .command("attachments")
  .description("Download attachments from a single message")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-m, --message-id <id>", "Message ID")
  .requiredOption("-o, --output <dir>", "Output directory")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);
    await downloadAttachments(client, opts.messageId, opts.output);
  });

// send
program
  .command("send")
  .description("Send an email (default: creates draft in Outlook)")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("--to <addresses>", "Recipient(s), comma-separated")
  .option("--cc <addresses>", "CC recipient(s), comma-separated")
  .option("--bcc <addresses>", "BCC recipient(s), comma-separated")
  .requiredOption("-s, --subject <subject>", "Email subject")
  .requiredOption("-b, --body <path>", "Path to .md or .txt body file")
  .option("--attach <paths...>", "File paths to attach")
  .option("--importance <level>", "low, normal, or high", "normal")
  .option("--send-now", "Send immediately instead of creating draft")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    await sendEmail(client, {
      to: opts.to.split(",").map((s: string) => s.trim()),
      cc: opts.cc?.split(",").map((s: string) => s.trim()),
      bcc: opts.bcc?.split(",").map((s: string) => s.trim()),
      subject: opts.subject,
      bodyPath: opts.body,
      attachPaths: opts.attach,
      importance: opts.importance,
      sendNow: opts.sendNow,
    });
  });

// reply
program
  .command("reply")
  .description("Reply to an email (default: creates draft reply in Outlook)")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-m, --message-id <id>", "Message ID to reply to")
  .requiredOption("-b, --body <path>", "Path to .md or .txt reply body")
  .option("--reply-all", "Reply to all recipients")
  .option("--attach <paths...>", "File paths to attach")
  .option("--send-now", "Send immediately instead of creating draft")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    await replyToEmail(client, {
      messageId: opts.messageId,
      bodyPath: opts.body,
      replyAll: opts.replyAll,
      attachPaths: opts.attach,
      sendNow: opts.sendNow,
    });
  });

// === Calendar commands ===

function defaultStartDate(): string {
  return new Date().toISOString().split("T")[0];
}

function defaultEndDate(daysAhead: number = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

// events
program
  .command("events")
  .description("List calendar events (default: next 7 days)")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .option("--from <date>", "Start date (YYYY-MM-DD)", defaultStartDate())
  .option("--to <date>", "End date (YYYY-MM-DD)", defaultEndDate())
  .option("-q, --query <query>", "Filter by subject")
  .option("-l, --limit <n>", "Max results", "50")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    const events = opts.query
      ? await searchEvents(client, opts.query, opts.from, opts.to, parseInt(opts.limit))
      : await listEvents(client, opts.from, opts.to, parseInt(opts.limit));

    printEventsTable(events);
  });

// event (detail)
program
  .command("event")
  .description("Get full details of a calendar event")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-i, --event-id <id>", "Event ID")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    const detail = await getEvent(client, opts.eventId);
    printEventDetail(detail);
  });

// create-event
program
  .command("create-event")
  .description("Create a calendar event")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-s, --subject <subject>", "Event subject")
  .requiredOption("--start <datetime>", "Start datetime (YYYY-MM-DDTHH:MM:SS)")
  .requiredOption("--end <datetime>", "End datetime (YYYY-MM-DDTHH:MM:SS)")
  .option("--tz <timezone>", "Time zone", "Europe/Madrid")
  .option("--location <location>", "Location")
  .option("-b, --body <text>", "Event body/description")
  .option("--attendees <emails>", "Attendee emails, comma-separated")
  .option("--all-day", "All-day event")
  .option("--importance <level>", "low, normal, or high", "normal")
  .option("--online", "Create as online meeting (Teams)")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    const result = await createEvent(client, {
      subject: opts.subject,
      start: opts.start,
      end: opts.end,
      timeZone: opts.tz,
      location: opts.location,
      body: opts.body,
      attendees: opts.attendees?.split(",").map((s: string) => s.trim()),
      isAllDay: opts.allDay,
      importance: opts.importance,
      isOnline: opts.online,
    });

    console.log(`\u2705 Event created.`);
    console.log(`   Event ID: ${result.id}`);
    console.log(`   Web link: ${result.webLink}`);
  });

// rsvp
program
  .command("rsvp")
  .description("Respond to a calendar event (accept, decline, tentative)")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-i, --event-id <id>", "Event ID")
  .requiredOption(
    "-r, --response <response>",
    "Response: accept, decline, or tentative"
  )
  .option("-c, --comment <text>", "Optional response comment")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    const responseMap: Record<string, "accept" | "decline" | "tentativelyAccept"> = {
      accept: "accept",
      decline: "decline",
      tentative: "tentativelyAccept",
    };

    const response = responseMap[opts.response];
    if (!response) {
      console.error("Invalid response. Use: accept, decline, or tentative");
      process.exit(1);
    }

    await respondToEvent(client, opts.eventId, response, opts.comment);
    console.log(`\u2705 Responded: ${opts.response}`);
  });

// delete-event
program
  .command("delete-event")
  .description("Delete/cancel a calendar event")
  .requiredOption("-a, --account <alias>", "Account alias (b8n or boc)")
  .requiredOption("-i, --event-id <id>", "Event ID")
  .action(async (opts) => {
    const account = getAccount(opts.account);
    const token = await getAccessToken(account);
    const client = createGraphClient(token);

    await deleteEvent(client, opts.eventId);
    console.log(`\u2705 Event deleted.`);
  });

program.parse();
