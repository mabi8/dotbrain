import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { convert } from "html-to-text";
import { SearchResult } from "./graph.js";
import { formatSize, formatRecipients as formatRecipientsGraph, isDocumentType } from "./graph.js";

const EWS_URL = "https://outlook.office365.com/EWS/Exchange.asmx";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  isArray: (name) =>
    ["Folder", "Message", "FileAttachment", "Mailbox", "Attendee",
     "GetItemResponseMessage", "GetAttachmentResponseMessage"].includes(name),
});

function wrap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2016"/>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

async function ewsRequest(token: string, soapBody: string): Promise<any> {
  const response = await fetch(EWS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/xml; charset=utf-8",
    },
    body: wrap(soapBody),
  });

  if (response.status === 401) {
    throw new Error("EWS auth failed. Run: npx tsx src/index.ts login-ews --account <alias>");
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`EWS request failed (${response.status}): ${text.slice(0, 600)}`);
  }

  const parsed = parser.parse(text);
  return parsed?.Envelope?.Body;
}

// ── Folder listing ──

export interface ArchiveFolder {
  folderId: string;
  changeKey: string;
  displayName: string;
  totalCount: number;
  childFolderCount: number;
}

export async function listArchiveFolders(token: string): Promise<ArchiveFolder[]> {
  const body = await ewsRequest(token, `
    <m:FindFolder Traversal="Deep">
      <m:FolderShape>
        <t:BaseShape>Default</t:BaseShape>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="folder:TotalCount"/>
          <t:FieldURI FieldURI="folder:ChildFolderCount"/>
        </t:AdditionalProperties>
      </m:FolderShape>
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="archivemsgfolderroot"/>
      </m:ParentFolderIds>
    </m:FindFolder>`);

  const folders = body?.FindFolderResponse?.ResponseMessages?.FindFolderResponseMessage
    ?.RootFolder?.Folders?.Folder || [];

  return folders.map((f: any) => ({
    folderId: f.FolderId?.["@_Id"] || "",
    changeKey: f.FolderId?.["@_ChangeKey"] || "",
    displayName: f.DisplayName || "",
    totalCount: parseInt(f.TotalCount || "0"),
    childFolderCount: parseInt(f.ChildFolderCount || "0"),
  }));
}

// ── Search ──

function buildRestriction(keyword?: string, dateFrom?: string, dateTo?: string): string {
  const conditions: string[] = [];

  if (keyword) {
    conditions.push(`
      <t:Contains ContainmentMode="Substring" ContainmentComparison="IgnoreCase">
        <t:FieldURI FieldURI="item:Subject"/>
        <t:Constant Value="${escapeXml(keyword)}"/>
      </t:Contains>`);
  }

  if (dateFrom) {
    conditions.push(`
      <t:IsGreaterThanOrEqualTo>
        <t:FieldURI FieldURI="item:DateTimeReceived"/>
        <t:FieldURIOrConstant><t:Constant Value="${dateFrom}T00:00:00Z"/></t:FieldURIOrConstant>
      </t:IsGreaterThanOrEqualTo>`);
  }

  if (dateTo) {
    conditions.push(`
      <t:IsLessThanOrEqualTo>
        <t:FieldURI FieldURI="item:DateTimeReceived"/>
        <t:FieldURIOrConstant><t:Constant Value="${dateTo}T23:59:59Z"/></t:FieldURIOrConstant>
      </t:IsLessThanOrEqualTo>`);
  }

  if (conditions.length === 0) return "";
  if (conditions.length === 1) return `<m:Restriction>${conditions[0]}</m:Restriction>`;
  return `<m:Restriction><t:And>${conditions.join("")}</t:And></m:Restriction>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function resolveArchiveFolderIds(token: string): Promise<string[]> {
  const folders = await listArchiveFolders(token);
  // Target main mail folders: Inbox, Sent Items and their German equivalents
  const targets = ["Inbox", "Sent Items", "Posteingang", "Gesendete Elemente"];
  return folders
    .filter((f) => targets.includes(f.displayName) && f.totalCount > 0)
    .map((f) => f.folderId);
}

// Archive mailboxes don't support ConversationId at all.
// Use subject-based threading: strip Re:/Fwd: prefixes to group by topic.
function subjectToTopic(subject: string): string {
  return subject.replace(/^(RE|FW|AW|WG|Fwd|Re|Fw):\s*/gi, "").trim();
}

async function findItemsInFolder(
  token: string,
  folderId: string,
  restriction: string,
  limit: number,
  offset: number
): Promise<{ results: SearchResult[]; includesLast: boolean }> {
  const pageSize = Math.min(limit, 200);

  // Archive mailboxes don't support ConversationId as an additional property
  // in FindItem with restrictions. Use basic props first, then enrich via GetItem.
  const body = await ewsRequest(token, `
    <m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject"/>
          <t:FieldURI FieldURI="item:DateTimeReceived"/>
          <t:FieldURI FieldURI="item:DateTimeSent"/>
          <t:FieldURI FieldURI="message:Sender"/>
          <t:FieldURI FieldURI="message:From"/>
          <t:FieldURI FieldURI="item:HasAttachments"/>
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:IndexedPageItemView MaxEntriesReturned="${pageSize}" Offset="${offset}" BasePoint="Beginning"/>
      ${restriction}
      <m:ParentFolderIds>
        <t:FolderId Id="${folderId}"/>
      </m:ParentFolderIds>
    </m:FindItem>`);

  const resp = body?.FindItemResponse?.ResponseMessages?.FindItemResponseMessage;
  const rootFolder = resp?.RootFolder;
  const messages = rootFolder?.Items?.Message || [];
  const results: SearchResult[] = [];

  const msgArr = Array.isArray(messages) ? messages : [messages];

  for (const msg of msgArr) {
    if (!msg?.ItemId) continue;
    const subject = msg.Subject || "";
    const senderMb = normalizeMailboxArray(msg.Sender?.Mailbox || msg.From?.Mailbox)[0];
    results.push({
      id: msg.ItemId["@_Id"],
      subject,
      conversationId: subjectToTopic(subject), // topic-based grouping for archive
      receivedDateTime: msg.DateTimeReceived || msg.DateTimeSent || "",
      sender: senderMb?.address || "unknown",
      hasAttachments: msg.HasAttachments === true || msg.HasAttachments === "true",
    });
  }

  const includesLast = rootFolder?.["@_IncludesLastItemInRange"];
  return { results, includesLast: includesLast === "true" || includesLast === true };
}

export async function searchArchiveEmails(
  token: string,
  opts: {
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
): Promise<SearchResult[]> {
  const limit = opts.limit || 20;
  const restriction = buildRestriction(opts.keyword, opts.dateFrom, opts.dateTo);
  const folderIds = await resolveArchiveFolderIds(token);

  const allResults: SearchResult[] = [];

  for (const folderId of folderIds) {
    let offset = 0;
    while (allResults.length < limit) {
      const remaining = limit - allResults.length;
      const { results, includesLast } = await findItemsInFolder(
        token, folderId, restriction, remaining, offset
      );
      allResults.push(...results);
      if (includesLast || results.length === 0) break;
      offset += results.length;
    }
    if (allResults.length >= limit) break;
  }

  // Sort all results by date descending
  allResults.sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
  return allResults.slice(0, limit);
}

// ── Thread fetching ──

interface EwsMessage {
  id: string;
  subject: string;
  bodyHtml: string;
  sender: { name: string; address: string };
  toRecipients: { name: string; address: string }[];
  ccRecipients: { name: string; address: string }[];
  receivedDateTime: string;
  hasAttachments: boolean;
  attachmentIds: { id: string; name: string; size: number; contentType: string; isInline: boolean }[];
}

async function findItemsByConversation(token: string, conversationTopic: string): Promise<string[]> {
  // Archive doesn't support ConversationId. Search by subject topic instead.
  const folderIds = await resolveArchiveFolderIds(token);
  const ids: string[] = [];

  for (const folderId of folderIds) {
    let offset = 0;
    while (true) {
      const body = await ewsRequest(token, `
        <m:FindItem Traversal="Shallow">
          <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>
          <m:IndexedPageItemView MaxEntriesReturned="100" Offset="${offset}" BasePoint="Beginning"/>
          <m:Restriction>
            <t:Contains ContainmentMode="Substring" ContainmentComparison="IgnoreCase">
              <t:FieldURI FieldURI="item:Subject"/>
              <t:Constant Value="${escapeXml(conversationTopic)}"/>
            </t:Contains>
          </m:Restriction>
          <m:ParentFolderIds>
            <t:FolderId Id="${folderId}"/>
          </m:ParentFolderIds>
        </m:FindItem>`);

      const resp = body?.FindItemResponse?.ResponseMessages?.FindItemResponseMessage;
      const messages = resp?.RootFolder?.Items?.Message || [];
      const msgArr = Array.isArray(messages) ? messages : [messages];

      for (const msg of msgArr) {
        if (msg?.ItemId?.["@_Id"]) ids.push(msg.ItemId["@_Id"]);
      }

      const includesLast = resp?.RootFolder?.["@_IncludesLastItemInRange"];
      if (includesLast === "true" || includesLast === true) break;
      offset += 100;
    }
  }

  return ids;
}

async function getItems(token: string, itemIds: string[]): Promise<EwsMessage[]> {
  const messages: EwsMessage[] = [];

  // Batch in groups of 50
  for (let i = 0; i < itemIds.length; i += 50) {
    const batch = itemIds.slice(i, i + 50);
    const itemIdXml = batch.map((id) => `<t:ItemId Id="${id}"/>`).join("");

    const body = await ewsRequest(token, `
      <m:GetItem>
        <m:ItemShape>
          <t:BaseShape>Default</t:BaseShape>
          <t:BodyType>HTML</t:BodyType>
          <t:AdditionalProperties>
            <t:FieldURI FieldURI="item:Attachments"/>
            <t:FieldURI FieldURI="message:ToRecipients"/>
            <t:FieldURI FieldURI="message:CcRecipients"/>
          </t:AdditionalProperties>
        </m:ItemShape>
        <m:ItemIds>${itemIdXml}</m:ItemIds>
      </m:GetItem>`);

    const responses = body?.GetItemResponse?.ResponseMessages?.GetItemResponseMessage;
    const respArr = Array.isArray(responses) ? responses : [responses];

      for (const resp of respArr) {
      const rawMsg = resp?.Items?.Message;
      // Message is configured as isArray, so unwrap
      const msg = Array.isArray(rawMsg) ? rawMsg[0] : rawMsg;
      if (!msg) continue;

      const toArr = normalizeMailboxArray(msg.ToRecipients?.Mailbox);
      const ccArr = normalizeMailboxArray(msg.CcRecipients?.Mailbox);

      const attachments: EwsMessage["attachmentIds"] = [];
      const fileAtts = msg.Attachments?.FileAttachment;
      if (fileAtts) {
        const attArr = Array.isArray(fileAtts) ? fileAtts : [fileAtts];
        for (const att of attArr) {
          attachments.push({
            id: att.AttachmentId?.["@_Id"] || "",
            name: att.Name || "",
            size: parseInt(att.Size || "0"),
            contentType: att.ContentType || "",
            isInline: att.IsInline === true || att.IsInline === "true",
          });
        }
      }

      // Archive items may have From but not Sender
      const senderMailbox = normalizeMailboxArray(
        msg.Sender?.Mailbox || msg.From?.Mailbox
      )[0] || { name: "", address: "unknown" };

      messages.push({
        id: msg.ItemId?.["@_Id"] || "",
        subject: msg.Subject || "",
        bodyHtml: msg.Body?.["#text"] || (typeof msg.Body === "string" ? msg.Body : "") || "",
        sender: senderMailbox,
        toRecipients: toArr,
        ccRecipients: ccArr,
        receivedDateTime: msg.DateTimeReceived || msg.DateTimeSent || "",
        hasAttachments: msg.HasAttachments === true || msg.HasAttachments === "true",
        attachmentIds: attachments,
      });
    }
  }

  return messages;
}

function normalizeMailboxArray(mailbox: any): { name: string; address: string }[] {
  if (!mailbox) return [];
  const arr = Array.isArray(mailbox) ? mailbox : [mailbox];
  return arr.map((m: any) => ({ name: m.Name || "", address: m.EmailAddress || "" }));
}

async function downloadEwsAttachment(
  token: string,
  attachmentId: string
): Promise<{ name: string; content: Buffer; size: number; contentType: string }> {
  const body = await ewsRequest(token, `
    <m:GetAttachment>
      <m:AttachmentIds>
        <t:AttachmentId Id="${attachmentId}"/>
      </m:AttachmentIds>
    </m:GetAttachment>`);

  const respMsg = body?.GetAttachmentResponse?.ResponseMessages?.GetAttachmentResponseMessage;
  const firstResp = Array.isArray(respMsg) ? respMsg[0] : respMsg;
  const att = firstResp?.Attachments?.FileAttachment;
  const fileAtt = Array.isArray(att) ? att[0] : att;

  return {
    name: fileAtt?.Name || "attachment",
    content: Buffer.from(fileAtt?.Content || "", "base64"),
    size: parseInt(fileAtt?.Size || "0"),
    contentType: fileAtt?.ContentType || "",
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xD;/g, "\r")
    .replace(/&#xA;/g, "\n")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)));
}

function bodyToText(html: string): string {
  if (!html || typeof html !== "string") return "";
  const decoded = decodeXmlEntities(html);
  return convert(decoded, {
    wordwrap: 120,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}

function ewsFormatRecipients(recipients: { name: string; address: string }[]): string {
  return recipients
    .map((r) => (r.name ? `${r.name} <${r.address}>` : r.address))
    .join(", ");
}

export async function fetchArchiveThread(
  token: string,
  conversationId: string,
  outputDir: string
): Promise<void> {
  // Stage 1: Find all items in conversation
  const itemIds = await findItemsByConversation(token, conversationId);
  if (itemIds.length === 0) {
    console.error("No messages found for this conversation in the archive.");
    process.exit(1);
  }

  // Stage 2: Get full message details
  const messages = await getItems(token, itemIds);
  messages.sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime());

  const attachmentsDir = join(outputDir, "attachments");
  await mkdir(attachmentsDir, { recursive: true });

  // Stage 3: Download attachments
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

    const validAtts = msg.attachmentIds.filter(
      (a) => (!a.isInline || isDocumentType(a.contentType)) && a.size <= 10 * 1024 * 1024
    );

    for (const att of validAtts) {
      try {
        const downloaded = await downloadEwsAttachment(token, att.id);
        attachmentCounter++;
        const prefix = String(i + 1).padStart(2, "0");
        const filename = downloaded.name || att.name;
        const localFilename = `${prefix}_${filename}`;
        const localPath = join(attachmentsDir, localFilename);

        await writeFile(localPath, downloaded.content);

        allAttachments.push({
          index: attachmentCounter,
          filename,
          messageIndex: i + 1,
          sender: msg.sender.address,
          date: msg.receivedDateTime.split("T")[0],
          size: downloaded.content.length || att.size,
          localPath: `./attachments/${localFilename}`,
        });
      } catch (err: any) {
        console.warn(`Skipping attachment ${att.name}: ${err.message?.slice(0, 60)}`);
      }
    }
  }

  // Stage 4: Generate markdown
  const subject = messages[0].subject || "Untitled Thread";
  const firstDate = messages[0].receivedDateTime?.split("T")[0] || "?";
  const lastDate = messages[messages.length - 1].receivedDateTime?.split("T")[0] || "?";
  const dateRange = `${firstDate} → ${lastDate}`;

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
    const dateObj = new Date(msg.receivedDateTime);
    const date = isNaN(dateObj.getTime())
      ? msg.receivedDateTime || "unknown"
      : dateObj.toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const from = msg.sender.name
      ? `${msg.sender.name} <${msg.sender.address}>`
      : msg.sender.address;

    md += `## Message ${i + 1} of ${messages.length}\n`;
    md += `**Date:** ${date}\n`;
    md += `**From:** ${from}\n`;
    md += `**To:** ${ewsFormatRecipients(msg.toRecipients)}\n`;
    if (msg.ccRecipients.length > 0) {
      md += `**CC:** ${ewsFormatRecipients(msg.ccRecipients)}\n`;
    }
    md += `\n`;
    md += bodyToText(msg.bodyHtml);
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

  // Write message metadata sidecar (newest-first for easy reply)
  const messageMeta = [...messages].reverse().map((msg) => ({
    id: msg.id,
    date: msg.receivedDateTime,
    from: msg.sender.address,
    subject: msg.subject,
  }));
  await writeFile(join(outputDir, "messages.json"), JSON.stringify(messageMeta, null, 2), "utf-8");

  console.log(`Thread saved to ${threadPath}`);
  console.log(`  ${messages.length} messages, ${allAttachments.length} attachments`);
}
