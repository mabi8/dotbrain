import { Client } from "@microsoft/microsoft-graph-client";
import { convert } from "html-to-text";

export interface EventSummary {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  isAllDay: boolean;
  responseStatus: string;
  hasAttachments: boolean;
  isOnline: boolean;
  onlineJoinUrl: string | null;
}

export interface EventDetail extends EventSummary {
  body: string;
  attendees: { name: string; email: string; status: string; type: string }[];
  recurrence: string | null;
  categories: string[];
  importance: string;
  sensitivity: string;
  webLink: string;
}

function parseEvent(evt: any): EventSummary {
  return {
    id: evt.id,
    subject: evt.subject || "(No subject)",
    start: evt.isAllDay
      ? evt.start.dateTime.split("T")[0]
      : formatDateTime(evt.start.dateTime, evt.start.timeZone),
    end: evt.isAllDay
      ? evt.end.dateTime.split("T")[0]
      : formatDateTime(evt.end.dateTime, evt.end.timeZone),
    location: evt.location?.displayName || "",
    organizer: evt.organizer?.emailAddress?.address || "",
    isAllDay: evt.isAllDay,
    responseStatus: evt.responseStatus?.response || "none",
    hasAttachments: evt.hasAttachments,
    isOnline: evt.isOnlineMeeting,
    onlineJoinUrl: evt.onlineMeeting?.joinUrl || null,
  };
}

function parseEventDetail(evt: any): EventDetail {
  const summary = parseEvent(evt);
  const bodyText =
    evt.body?.contentType === "text"
      ? evt.body.content?.trim() || ""
      : convert(evt.body?.content || "", {
          wordwrap: 120,
          selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
          ],
        }).trim();

  return {
    ...summary,
    body: bodyText,
    attendees: (evt.attendees || []).map((a: any) => ({
      name: a.emailAddress?.name || "",
      email: a.emailAddress?.address || "",
      status: a.status?.response || "none",
      type: a.type || "required",
    })),
    recurrence: evt.recurrence
      ? `${evt.recurrence.pattern?.type} (${evt.recurrence.pattern?.interval || 1})`
      : null,
    categories: evt.categories || [],
    importance: evt.importance || "normal",
    sensitivity: evt.sensitivity || "normal",
    webLink: evt.webLink || "",
  };
}

function formatDateTime(dateTime: string, timeZone: string): string {
  // Graph returns ISO-ish strings; format for display
  const d = new Date(dateTime + (timeZone === "UTC" ? "Z" : ""));
  return d.toISOString().replace("T", " ").slice(0, 16) + ` (${timeZone})`;
}

function formatTime(dateStr: string): string {
  // Extract just HH:MM from our formatted string
  const match = dateStr.match(/(\d{2}:\d{2})/);
  return match ? match[1] : dateStr;
}

export async function listEvents(
  client: Client,
  startDate: string,
  endDate: string,
  limit: number = 50
): Promise<EventSummary[]> {
  const response = await client
    .api("/me/calendarView")
    .query({
      startDateTime: `${startDate}T00:00:00Z`,
      endDateTime: `${endDate}T23:59:59Z`,
    })
    .top(limit)
    .orderby("start/dateTime")
    .select(
      "id,subject,start,end,location,organizer,isAllDay,responseStatus,hasAttachments,isOnlineMeeting,onlineMeeting"
    )
    .get();

  return (response.value || []).map(parseEvent);
}

export async function searchEvents(
  client: Client,
  query: string,
  startDate: string,
  endDate: string,
  limit: number = 20
): Promise<EventSummary[]> {
  const response = await client
    .api("/me/calendarView")
    .query({
      startDateTime: `${startDate}T00:00:00Z`,
      endDateTime: `${endDate}T23:59:59Z`,
      $filter: `contains(subject,'${query.replace(/'/g, "''")}')`,
    })
    .top(limit)
    .orderby("start/dateTime")
    .select(
      "id,subject,start,end,location,organizer,isAllDay,responseStatus,hasAttachments,isOnlineMeeting,onlineMeeting"
    )
    .get();

  return (response.value || []).map(parseEvent);
}

export async function getEvent(
  client: Client,
  eventId: string
): Promise<EventDetail> {
  const evt = await client
    .api(`/me/events/${eventId}`)
    .select(
      "id,subject,start,end,location,organizer,isAllDay,responseStatus,hasAttachments,isOnlineMeeting,onlineMeeting,body,attendees,recurrence,categories,importance,sensitivity,webLink"
    )
    .get();

  return parseEventDetail(evt);
}

export interface CreateEventOptions {
  subject: string;
  start: string; // ISO datetime e.g. "2026-03-28T10:00:00"
  end: string;
  timeZone?: string;
  location?: string;
  body?: string; // plain text or markdown
  attendees?: string[]; // email addresses
  isAllDay?: boolean;
  importance?: "low" | "normal" | "high";
  isOnline?: boolean;
}

export async function createEvent(
  client: Client,
  opts: CreateEventOptions
): Promise<{ id: string; webLink: string }> {
  const event: any = {
    subject: opts.subject,
    start: {
      dateTime: opts.start,
      timeZone: opts.timeZone || "Europe/Madrid",
    },
    end: {
      dateTime: opts.end,
      timeZone: opts.timeZone || "Europe/Madrid",
    },
    importance: opts.importance || "normal",
  };

  if (opts.isAllDay) {
    // All-day events need date-only format
    event.isAllDay = true;
    event.start.dateTime = opts.start.split("T")[0];
    event.end.dateTime = opts.end.split("T")[0];
  }

  if (opts.location) {
    event.location = { displayName: opts.location };
  }

  if (opts.body) {
    event.body = { contentType: "text", content: opts.body };
  }

  if (opts.attendees?.length) {
    event.attendees = opts.attendees.map((email) => ({
      emailAddress: { address: email.trim() },
      type: "required",
    }));
  }

  if (opts.isOnline) {
    event.isOnlineMeeting = true;
    event.onlineMeetingProvider = "teamsForBusiness";
  }

  const result = await client.api("/me/events").post(event);
  return { id: result.id, webLink: result.webLink };
}

export async function respondToEvent(
  client: Client,
  eventId: string,
  response: "accept" | "decline" | "tentativelyAccept",
  comment?: string
): Promise<void> {
  const body: any = { sendResponse: true };
  if (comment) body.comment = comment;

  await client.api(`/me/events/${eventId}/${response}`).post(body);
}

export async function deleteEvent(
  client: Client,
  eventId: string
): Promise<void> {
  await client.api(`/me/events/${eventId}`).delete();
}

export function printEventsTable(events: EventSummary[]): void {
  if (events.length === 0) {
    console.log("No events found.");
    return;
  }

  console.log(
    `\n${events.length} event(s):\n`
  );
  console.log(
    "Date".padEnd(12) +
      "Time".padEnd(14) +
      "Status".padEnd(10) +
      "Subject"
  );
  console.log("-".repeat(80));

  for (const e of events) {
    const date = e.isAllDay ? e.start : e.start.split(" ")[0];
    const time = e.isAllDay
      ? "all day"
      : `${formatTime(e.start)}-${formatTime(e.end)}`;
    const status = e.responseStatus.slice(0, 8);
    const loc = e.location ? ` [${e.location.slice(0, 20)}]` : "";
    console.log(
      date.padEnd(12) +
        time.padEnd(14) +
        status.padEnd(10) +
        e.subject.slice(0, 50) +
        loc
    );
  }
}

export function printEventDetail(e: EventDetail): void {
  console.log(`\n# ${e.subject}\n`);
  console.log(`Start:      ${e.start}`);
  console.log(`End:        ${e.end}`);
  if (e.isAllDay) console.log(`All day:    yes`);
  if (e.location) console.log(`Location:   ${e.location}`);
  console.log(`Organizer:  ${e.organizer}`);
  console.log(`Response:   ${e.responseStatus}`);
  console.log(`Importance: ${e.importance}`);
  if (e.isOnline && e.onlineJoinUrl) console.log(`Join URL:   ${e.onlineJoinUrl}`);
  if (e.recurrence) console.log(`Recurrence: ${e.recurrence}`);
  if (e.categories.length) console.log(`Categories: ${e.categories.join(", ")}`);

  if (e.attendees.length > 0) {
    console.log(`\nAttendees (${e.attendees.length}):`);
    for (const a of e.attendees) {
      const name = a.name ? `${a.name} ` : "";
      console.log(`  ${a.type === "optional" ? "(opt) " : ""}${name}<${a.email}> — ${a.status}`);
    }
  }

  if (e.body) {
    console.log(`\nBody:\n${e.body}`);
  }

  console.log(`\nWeb link: ${e.webLink}`);
  console.log(`Event ID: ${e.id}`);
}
