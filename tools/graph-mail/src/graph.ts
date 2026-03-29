import { Client } from "@microsoft/microsoft-graph-client";
import { writeFile, mkdir } from "fs/promises";
import { resolve, join } from "path";
import { convert } from "html-to-text";

export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

export interface SearchResult {
  id: string;
  subject: string;
  conversationId: string;
  receivedDateTime: string;
  sender: string;
  hasAttachments: boolean;
}

export async function searchEmails(
  client: Client,
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const response = await client
    .api("/me/messages")
    .query({ $search: `"${query}"` })
    .top(limit)
    .select("id,subject,conversationId,receivedDateTime,sender,hasAttachments")
    .get();

  return (response.value || []).map((msg: any) => ({
    id: msg.id,
    subject: msg.subject,
    conversationId: msg.conversationId,
    receivedDateTime: msg.receivedDateTime,
    sender: msg.sender?.emailAddress?.address || "unknown",
    hasAttachments: msg.hasAttachments,
  }));
}

interface Message {
  id: string;
  subject: string;
  body: { contentType: string; content: string };
  sender: { emailAddress: { address: string; name: string } };
  toRecipients: { emailAddress: { address: string; name: string } }[];
  ccRecipients: { emailAddress: { address: string; name: string } }[];
  receivedDateTime: string;
  hasAttachments: boolean;
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes: string;
  isInline: boolean;
  "@odata.type": string;
}

async function fetchConversationMessages(
  client: Client,
  conversationId: string
): Promise<Message[]> {
  const messages: Message[] = [];
  let url = `/me/messages?$filter=conversationId eq '${conversationId}'&$top=50&$select=id,subject,body,sender,toRecipients,ccRecipients,receivedDateTime,hasAttachments`;

  while (url) {
    const response = await client.api(url).get();
    messages.push(...(response.value || []));
    url = response["@odata.nextLink"]
      ? response["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "")
      : "";
  }

  return messages;
}

async function fetchAttachments(
  client: Client,
  messageId: string
): Promise<Attachment[]> {
  const response = await client
    .api(`/me/messages/${messageId}/attachments`)
    .get();

  return (response.value || []).filter(
    (a: Attachment) =>
      a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
      (!a.isInline || isDocumentType(a.contentType))
  );
}

function isDocumentType(contentType: string): boolean {
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
  ];
  return docTypes.some((t) => contentType.startsWith(t));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRecipients(
  recipients: { emailAddress: { address: string; name: string } }[]
): string {
  return recipients
    .map((r) => (r.emailAddress.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress.address))
    .join(", ");
}

function bodyToText(body: { contentType: string; content: string }): string {
  if (body.contentType === "text") return body.content.trim();
  return convert(body.content, {
    wordwrap: 120,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}

export async function fetchThread(
  client: Client,
  conversationId: string,
  outputDir: string
): Promise<void> {
  const messages = await fetchConversationMessages(client, conversationId);

  if (messages.length === 0) {
    console.error("No messages found for this conversation.");
    process.exit(1);
  }

  const attachmentsDir = join(outputDir, "attachments");
  await mkdir(attachmentsDir, { recursive: true });

  const allAttachments: {
    index: number;
    filename: string;
    messageIndex: number;
    sender: string;
    date: string;
    size: number;
    localPath: string;
  }[] = [];

  let attachmentCounter = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.hasAttachments) continue;

    const attachments = await fetchAttachments(client, msg.id);
    for (const att of attachments) {
      if (att.size > 10 * 1024 * 1024) {
        console.warn(`Skipping large attachment: ${att.name} (${formatSize(att.size)})`);
        continue;
      }

      attachmentCounter++;
      const prefix = String(i + 1).padStart(2, "0");
      const localFilename = `${prefix}_${att.name}`;
      const localPath = join(attachmentsDir, localFilename);

      await writeFile(localPath, Buffer.from(att.contentBytes, "base64"));

      allAttachments.push({
        index: attachmentCounter,
        filename: att.name,
        messageIndex: i + 1,
        sender: msg.sender.emailAddress.address,
        date: msg.receivedDateTime.split("T")[0],
        size: att.size,
        localPath: `./attachments/${localFilename}`,
      });
    }
  }

  const subject = messages[0].subject || "Untitled Thread";
  const dateRange = `${messages[0].receivedDateTime.split("T")[0]} → ${messages[messages.length - 1].receivedDateTime.split("T")[0]}`;

  let md = `# Thread: ${subject}\n\n`;
  md += `**Messages:** ${messages.length} | **Attachments:** ${allAttachments.length} | **Date range:** ${dateRange}\n\n`;

  if (allAttachments.length > 0) {
    md += `## Attachment Index\n`;
    md += `| # | Filename | From Message | Date | Size | Local Path |\n`;
    md += `|---|----------|-------------|------|------|------------|\n`;
    for (const att of allAttachments) {
      md += `| ${att.index} | ${att.filename} | Msg ${att.messageIndex} (${att.sender}) | ${att.date} | ${formatSize(att.size)} | ${att.localPath} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const date = new Date(msg.receivedDateTime).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const from = msg.sender.emailAddress.name
      ? `${msg.sender.emailAddress.name} <${msg.sender.emailAddress.address}>`
      : msg.sender.emailAddress.address;

    md += `## Message ${i + 1} of ${messages.length}\n`;
    md += `**Date:** ${date}\n`;
    md += `**From:** ${from}\n`;
    md += `**To:** ${formatRecipients(msg.toRecipients)}\n`;
    if (msg.ccRecipients?.length > 0) {
      md += `**CC:** ${formatRecipients(msg.ccRecipients)}\n`;
    }
    md += `\n`;
    md += bodyToText(msg.body);
    md += `\n`;

    const msgAttachments = allAttachments.filter((a) => a.messageIndex === i + 1);
    if (msgAttachments.length > 0) {
      md += `\n**Attachments:**\n`;
      for (const att of msgAttachments) {
        md += `- [${att.filename}](${att.localPath})\n`;
      }
    }

    md += `\n---\n\n`;
  }

  const threadPath = join(outputDir, "thread.md");
  await writeFile(threadPath, md, "utf-8");

  console.log(`Thread saved to ${threadPath}`);
  console.log(`  ${messages.length} messages, ${allAttachments.length} attachments`);
}

export async function downloadAttachments(
  client: Client,
  messageId: string,
  outputDir: string
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const attachments = await fetchAttachments(client, messageId);

  if (attachments.length === 0) {
    console.log("No attachments found on this message.");
    return;
  }

  for (const att of attachments) {
    if (att.size > 10 * 1024 * 1024) {
      console.warn(`Skipping large attachment: ${att.name} (${formatSize(att.size)})`);
      continue;
    }

    const filePath = join(outputDir, att.name);
    await writeFile(filePath, Buffer.from(att.contentBytes, "base64"));
    console.log(`  Saved: ${att.name} (${formatSize(att.size)})`);
  }

  console.log(`${attachments.length} attachment(s) downloaded to ${outputDir}`);
}
