import { Client } from "@microsoft/microsoft-graph-client";
import { readFile, stat } from "fs/promises";
import { basename } from "path";
import { marked } from "marked";
import { createInterface } from "readline";

interface SendOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyPath: string;
  attachPaths?: string[];
  importance?: "low" | "normal" | "high";
  sendNow?: boolean;
}

interface ReplyOptions {
  messageId: string;
  bodyPath: string;
  replyAll?: boolean;
  attachPaths?: string[];
  sendNow?: boolean;
}

function toRecipients(addresses: string[]) {
  return addresses.map((a) => ({ emailAddress: { address: a.trim() } }));
}

async function readBody(bodyPath: string): Promise<{ html: string; text: string }> {
  const content = await readFile(bodyPath, "utf-8");
  if (bodyPath.endsWith(".md")) {
    const html = await marked(content);
    return { html, text: content };
  }
  return { html: `<pre>${content}</pre>`, text: content };
}

async function buildAttachments(paths: string[]) {
  const attachments = [];
  for (const filePath of paths) {
    const fileStats = await stat(filePath);
    if (fileStats.size > 3 * 1024 * 1024) {
      console.warn(
        `Warning: ${basename(filePath)} is ${(fileStats.size / (1024 * 1024)).toFixed(1)}MB — Graph API limit is 4MB per attachment`
      );
    }
    const data = await readFile(filePath);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: basename(filePath),
      contentBytes: data.toString("base64"),
    });
  }
  return attachments;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function printPreviewAndConfirm(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  attachPaths?: string[];
}): Promise<boolean> {
  console.log("\n--- Email Preview ---");
  console.log(`To: ${opts.to.join(", ")}`);
  if (opts.cc?.length) console.log(`CC: ${opts.cc.join(", ")}`);
  if (opts.bcc?.length) console.log(`BCC: ${opts.bcc.join(", ")}`);
  console.log(`Subject: ${opts.subject}`);
  console.log(`\nBody (first 500 chars):\n${opts.bodyText.slice(0, 500)}`);
  if (opts.attachPaths?.length) {
    console.log(`\nAttachments:`);
    for (const p of opts.attachPaths) {
      const s = await stat(p);
      console.log(`  - ${basename(p)} (${formatSize(s.size)})`);
    }
  }
  console.log("--------------------\n");
  return confirm("\u26a0\ufe0f  DIRECT SEND \u2014 this will send immediately. Confirm? [y/N] ");
}

export async function sendEmail(
  client: Client,
  opts: SendOptions
): Promise<void> {
  const body = await readBody(opts.bodyPath);
  const attachments = opts.attachPaths?.length
    ? await buildAttachments(opts.attachPaths)
    : [];

  const message: any = {
    subject: opts.subject,
    body: { contentType: "HTML", content: body.html },
    toRecipients: toRecipients(opts.to),
    importance: opts.importance || "normal",
  };
  if (opts.cc?.length) message.ccRecipients = toRecipients(opts.cc);
  if (opts.bcc?.length) message.bccRecipients = toRecipients(opts.bcc);
  if (attachments.length) message.attachments = attachments;

  if (opts.sendNow) {
    const confirmed = await printPreviewAndConfirm({
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      bodyText: body.text,
      attachPaths: opts.attachPaths,
    });
    if (!confirmed) {
      console.log("Aborted \u2014 email not sent.");
      return;
    }
    await client.api("/me/sendMail").post({ message });
    console.log("\u2705 Email sent.");
  } else {
    // Create draft in Outlook Drafts folder
    const draft = await client.api("/me/messages").post(message);
    console.log(`\u2705 Draft created in Outlook. Open Outlook to review and send.`);
    console.log(`   Draft ID: ${draft.id}`);
  }
}

export async function replyToEmail(
  client: Client,
  opts: ReplyOptions
): Promise<void> {
  const body = await readBody(opts.bodyPath);
  const attachments = opts.attachPaths?.length
    ? await buildAttachments(opts.attachPaths)
    : [];

  if (opts.sendNow) {
    // Direct send reply
    if (process.stdin.isTTY) {
      const bodyText = await readFile(opts.bodyPath, "utf-8");
      const confirmed = await printPreviewAndConfirm({
        to: ["(original recipients)"],
        subject: "(RE: original subject)",
        bodyText,
        attachPaths: opts.attachPaths,
      });
      if (!confirmed) {
        console.log("Aborted \u2014 reply not sent.");
        return;
      }
    }

    const endpoint = opts.replyAll
      ? `/me/messages/${opts.messageId}/replyAll`
      : `/me/messages/${opts.messageId}/reply`;

    const payload: any = {
      comment: body.html,
    };
    if (attachments.length) {
      payload.message = { attachments };
    }

    await client.api(endpoint).post(payload);
    console.log(`\u2705 Reply sent.`);
  } else {
    // Create draft reply
    const createEndpoint = opts.replyAll
      ? `/me/messages/${opts.messageId}/createReplyAll`
      : `/me/messages/${opts.messageId}/createReply`;

    const draft = await client.api(createEndpoint).post({});

    // Prepend new body to the quoted original (which createReply/createReplyAll puts in draft.body)
    const quotedBody = draft.body?.content || "";
    const combinedHtml = body.html + quotedBody;

    // Update draft body
    const update: any = {
      body: { contentType: "HTML", content: combinedHtml },
    };

    await client.api(`/me/messages/${draft.id}`).patch(update);

    // Add attachments separately (Graph API requires POST to /attachments endpoint)
    for (const att of attachments) {
      await client.api(`/me/messages/${draft.id}/attachments`).post(att);
    }

    console.log(`\u2705 Draft reply created in Outlook. Open Outlook to review and send.`);
    console.log(`   Draft ID: ${draft.id}`);
  }
}
