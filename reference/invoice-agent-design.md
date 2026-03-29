# Invoice Agent — Design Exploration

Replacing Joy's manual invoice processing with an AI agent. This document surfaces the decisions that need answering before building.

**Current flow:**
```
Invoices arrive via email (Markus + Susie → invoice-private@blueoceancapital.de)
  → Auto-archived in CenterDevice (folder ab1d3284)
  → Joy manually reconciles in Xero
  → Joy generates weekly ABA payment file
  → Maria uploads ABA to ANZ/CBA for review + payment
```

**Target flow:**
```
Invoices arrive via email
  → Auto-archived in CenterDevice
  → Agent ingests, extracts, reconciles
  → Agent generates weekly ABA file
  → Maria reviews + uploads to bank
```

---

## 1. Infrastructure & Logging

### The Core Question
Where does the agent run, and how are its actions logged for audit?

### Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| **Docker on box via Kamal** | Fits existing pattern, Alloy already ships container logs to Grafana/Loki, zero-downtime deploys, rollback | One more service on box — but box is lightly loaded |
| **Standalone script (cron on box)** | Simpler, no container overhead | No health checks, no zero-downtime, harder to manage secrets, manual log setup |
| **Cloud function (AWS Lambda / GCP)** | No server to manage | New infrastructure, new billing, harder to integrate with existing Grafana, CenterDevice MCP on box |

### Recommended Approach
**Docker on box via Kamal.** The entire Docker/Kamal/Alloy pipeline is already proven. Container logs flow to Loki automatically. The agent gets a health endpoint, structured logging, and rollback — all for free. This is the simplest option that also satisfies audit requirements, because every action the agent takes becomes a log line in Grafana.

### Information Gaps
- **Grafana retention:** How long are Loki logs retained on the free tier? ATO (Australian Tax Office) requires 5 years for financial records. If Grafana Cloud free tier only retains 30 days, you need a secondary archive (e.g., log export to CenterDevice or S3).
- **Xero API access:** Do you have OAuth credentials for the Xero API? Which Xero organisation is used for private invoices?
- **CenterDevice API access:** The CenterDevice MCP on box already has 46 tools — can the agent call these directly, or does it need its own credentials?

### Dependencies
- Alloy config on box must include Docker container discovery (already documented in docker-standard.md)
- DNS record needed if the agent exposes an HTTP endpoint (e.g., for webhooks)

---

## 2. Data Flow: CenterDevice to Agent

### The Core Question
How does the agent know when a new invoice arrives, and how does it extract the data?

### Trade-offs

| Trigger | Pro | Con |
|---------|-----|-----|
| **Scheduled poll (e.g., every 2 hours)** | Simple, predictable, easy to debug | Delay between arrival and processing; must track "already processed" state |
| **Email webhook / Graph API subscription** | Near-real-time processing | More complex setup; must handle webhook reliability, retries, and deduplication |
| **CenterDevice event / folder watch** | Reacts to the archive step directly | CenterDevice MCP doesn't expose webhooks — would need polling anyway |

### Recommended Approach
**Scheduled poll against CenterDevice**, not email. The invoices are already auto-archived into a known CenterDevice folder. The agent should:

1. Poll the CenterDevice folder (via MCP tools: `list_documents`, `get_document_metadata`) on a schedule (e.g., every 4 hours during business hours, or once daily)
2. Compare against a local "processed" list (SQLite or a simple JSON ledger)
3. For new documents: download, extract data, proceed to reconciliation

This avoids the complexity of email parsing entirely — CenterDevice is the single source of truth. The auto-archive rule already handles email → CenterDevice. The agent only needs to watch one folder.

### Invoice Data Extraction
This is the hardest part. Invoices come in varied formats (PDF, image, email body). Options:

| Method | Pro | Con |
|--------|-----|-----|
| **Claude vision (PDF/image → structured data)** | Handles any format, high accuracy, can reason about ambiguous fields | Cost per invocation, needs prompt engineering for consistent output |
| **OCR + regex** | Cheap, fast | Brittle, breaks on new vendor formats |
| **Xero's built-in OCR (bills API)** | Xero extracts data when you upload a PDF | Limited control, may miscategorize, still needs review |

**Recommendation:** Use Claude for extraction. Send the PDF/image to Claude with a structured prompt that returns JSON: `{vendor, amount, currency, date, due_date, description, gst_amount}`. This is the most robust approach for varied invoice formats, and you're already paying for Claude anyway.

### Information Gaps
- **Invoice volume:** How many invoices per week? (affects polling frequency and cost)
- **Invoice formats:** Are they mostly PDFs? Scanned images? Inline email text?
- **CenterDevice folder structure:** Is everything flat in one folder, or organised by month/vendor?
- **Existing auto-archive rule:** What triggers the CenterDevice archive — an M365 mail rule, or something else?

### Dependencies
- CenterDevice MCP tools must be accessible from the agent (same box, so direct localhost calls or via the MCP API on port 9443)
- Claude API key for invoice data extraction

---

## 3. Agent Actions: What Should It Actually Do?

### The Core Question
What's the minimum scope that replaces Joy, and what's the right phasing?

### Option A: Extract → Push to Xero as Bill

**What it does:** Agent extracts invoice data, creates a draft bill in Xero with the PDF attached.

**Complexity:** Low. One API call to Xero per invoice.

**What it doesn't do:** No categorisation, no payment file, no reconciliation. Joy's Xero work is partially replaced — someone still needs to review, approve, categorise, and generate the ABA file.

**Verdict:** Not enough. This saves 20% of Joy's work (data entry) but leaves 80% (categorisation, reconciliation, payment) manual.

### Option B: Extract → Categorise → Tag in CenterDevice → Sync to Xero

**What it does:** Adds categorisation and CenterDevice tagging on top of Option A.

**Complexity:** Medium. Requires a category mapping (vendor → Xero account code), and CenterDevice tagging via MCP.

**What it doesn't do:** Still no ABA file. Maria can't do anything with this alone.

**Verdict:** Nice for organisation but doesn't close the loop. The weekly deliverable (ABA file) is still missing.

### Option C: Extract → Xero Bill → Weekly ABA File → Notify Maria

**What it does:** Full pipeline. Agent extracts data, creates categorised bills in Xero, and every Friday generates an ABA file from approved bills, then notifies Maria to upload.

**Complexity:** High. Requires Xero bill creation, category mapping, ABA file generation (specific Australian banking format), and a notification channel.

**What it doesn't do:** CenterDevice tagging (nice-to-have, not critical).

**Verdict:** This is the minimum viable replacement for Joy.

### Option D: Phased Rollout (Recommended)

| Phase | Scope | Goal |
|-------|-------|------|
| **Phase 1** | Extract invoice data + create draft bill in Xero (unapproved) | Validate extraction accuracy. You review in Xero for 2-3 weeks. |
| **Phase 2** | Add auto-categorisation (vendor → account code mapping) + auto-approve bills under a threshold (e.g., < $500 for known vendors) | Reduce review burden. Flag unknowns for manual review. |
| **Phase 3** | Weekly ABA file generation from approved bills + notify Maria via WhatsApp/email | Close the loop. Joy is fully replaced. |
| **Phase 4** (optional) | CenterDevice tagging, Airtable dashboard, Susie notifications | Polish and visibility. |

### Recommended Approach
**Phase 1 first, run it for 2-3 weeks.** The extraction accuracy is the make-or-break — if Claude misreads amounts or vendors, everything downstream fails. Phase 1 lets you validate this with zero risk (draft bills in Xero that you review manually).

### Information Gaps
- **Xero account codes:** What chart of accounts do you use? How many expense categories?
- **Vendor list:** How many unique vendors? Is there a stable set of recurring vendors (electricity, internet, insurance) or high variability?
- **Approval threshold:** What dollar amount are you comfortable auto-approving for known vendors?
- **ABA file specs:** Which bank format — ANZ or CBA? (They differ slightly.) Do you have a sample ABA file from Joy?

### Dependencies
- Phase 2 depends on a vendor → category mapping (can be bootstrapped from Xero history)
- Phase 3 depends on Xero API access for bill approval status + ABA format spec
- Phase 3 depends on a notification channel (WhatsApp Business Bot or email)

---

## 4. Reconciliation & Data Storage

### The Core Question
Where does reconciliation state live, and do you need anything beyond Xero?

### What "Reconciliation" Means Here

In this context, reconciliation has two layers:

1. **Invoice → Bill matching:** Did the agent correctly extract the invoice data and create the right bill in Xero? (Validation)
2. **Bill → Payment matching:** After Maria uploads the ABA file and the bank processes payments, do the payments match the bills? (Bank reconciliation)

Layer 1 is the agent's job. Layer 2 is traditionally done in Xero via bank feeds.

### Airtable: Do You Need It?

| Scenario | Airtable adds value | Airtable is overhead |
|----------|--------------------|--------------------|
| You want a dashboard showing invoice status (received → extracted → in Xero → paid) | Yes — Airtable's views are great for this | |
| You want Susie/Maria to see pipeline status without Xero access | Yes — share an Airtable view | |
| You just need invoices processed and bills in Xero | | Yes — Xero already tracks bill status |
| You need audit trail of agent decisions | | Yes — Grafana logs are better for this |

### Recommended Approach
**Don't use Airtable in Phase 1-3.** Xero is the system of record for bills and payments. The agent's logs (in Grafana/Loki) are the audit trail for its decisions. Adding Airtable creates a sync problem — you'd need to keep Airtable and Xero in sync, which is exactly the kind of manual reconciliation you're trying to eliminate.

**Consider Airtable only if** you need a non-technical dashboard for Maria/Susie to see invoice status without Xero access. Even then, a simple Grafana dashboard might suffice.

**If you do use Airtable later (Phase 4):** Treat it as a read-only view populated by the agent, never as a source of truth. All financial data lives in Xero. Airtable is just a window.

### Information Gaps
- **Bank feeds:** Does Xero have live bank feeds for ANZ/CBA? If yes, bank reconciliation is mostly automatic.
- **Who needs visibility?** Does Susie need to see invoice status, or just know when something needs her attention?
- **Xero access:** Do Maria and Susie have Xero logins? What roles?

### Dependencies
- If Airtable is used, the agent needs Airtable API access (one more credential to manage)
- Xero's bill status (draft → awaiting approval → approved → paid) is the natural state machine — building on top of it avoids duplicate state

---

## 5. Audit Trail Design

### The Core Question
What needs to be logged, where, and for whom?

### Who Needs What

| Person | Needs to see | Frequency |
|--------|-------------|-----------|
| **Markus** | Exceptions, errors, weekly summary | On demand + weekly |
| **Susie** | "Your invoice for X was processed" | Per invoice (optional) |
| **Maria** | "ABA file ready for upload" + file link | Weekly |
| **Accountant / ATO** | Full trail: invoice received → data extracted → bill created → categorised → approved → paid | On audit (rare) |

### What Must Be Logged

Every agent action should produce a structured log entry:

```json
{
  "timestamp": "2026-03-28T10:15:00Z",
  "action": "invoice_extracted",
  "invoice_id": "cd-doc-abc123",
  "vendor": "AGL Energy",
  "amount": 245.30,
  "currency": "AUD",
  "category": "Utilities",
  "xero_bill_id": "xero-bill-xyz",
  "confidence": 0.95,
  "status": "draft_created"
}
```

Key events to log:
1. Invoice detected in CenterDevice (document ID, filename, date)
2. Data extracted (all fields + confidence scores)
3. Bill created in Xero (Xero bill ID, status)
4. Category assigned (which category, auto or manual)
5. Exception flagged (what went wrong, who was notified)
6. ABA file generated (which bills included, total amount, file hash)
7. Maria notified (channel, timestamp)

### Where Should It Live?

| Store | Good for | Bad for |
|-------|----------|---------|
| **Grafana/Loki (via container logs)** | Operational monitoring, debugging, alerting | Long-term compliance archive (30-day retention on free tier) |
| **Xero (bill notes/history)** | Financial audit trail, already attached to the transaction | Operational debugging |
| **CenterDevice (tagged documents)** | Document-level audit, linking invoices to bills | Querying across transactions |
| **SQLite (in container volume)** | Agent's internal state, processed-invoice ledger | Shared visibility |

### Recommended Approach
**Layered audit trail:**

1. **Grafana/Loki** — operational logs. Every action logged as structured JSON. Use for monitoring, alerting, debugging. Accept 30-day retention.
2. **Xero bill notes** — financial audit trail. When creating a bill, add a note: "Auto-created by invoice-agent from CenterDevice doc {id}, extracted on {date}". This gives the ATO trail directly in the financial system.
3. **SQLite ledger** — agent's internal state. Maps CenterDevice document IDs to Xero bill IDs. Tracks processing status. Persisted via Docker volume.

This gives you operational visibility (Grafana), financial compliance (Xero), and agent state (SQLite) without any third-party dependency.

### Information Gaps
- **Grafana Cloud retention:** Confirm the retention period on your current plan. If it's 30 days, that's fine for operations but not for compliance.
- **ATO requirements:** What's the actual retention requirement for supporting documents? (Typically 5 years for income tax purposes.) CenterDevice already holds the source documents — does that suffice?
- **Xero audit log:** Does your Xero plan include an audit trail feature?

### Dependencies
- SQLite volume must be persisted across container restarts (Kamal volume mount in deploy.yml)
- Xero bill notes require API write access

---

## 6. Approval & Human Checkpoints

### The Core Question
What runs fully automatically, and where do humans stay in the loop?

### Recommended Checkpoint Design

| Step | Phase 1 | Phase 2 | Phase 3 (steady state) |
|------|---------|---------|----------------------|
| Invoice extraction | Auto | Auto | Auto |
| Bill creation in Xero | **Draft** (you review) | Auto for known vendors, **draft** for new | Auto for known, **draft** for new |
| Categorisation | Manual (you assign in Xero) | Auto for known vendors | Auto for known, flag unknowns |
| Bill approval | Manual (you approve in Xero) | Auto under threshold, manual above | Auto under threshold, manual above |
| ABA file generation | N/A | N/A | **Auto, but Maria reviews before upload** |
| Bank upload | N/A | N/A | **Always manual** (Maria uploads) |

### Exception Handling

| Exception | Action |
|-----------|--------|
| **Extraction confidence < 80%** | Create draft bill, flag for manual review, notify Markus via WhatsApp |
| **Unknown vendor** | Create draft bill, tag as "new vendor", notify Markus to assign category |
| **Amount > threshold** (e.g., $2,000) | Create bill but don't auto-approve, notify Markus |
| **Duplicate invoice** (same vendor + amount + date) | Don't create bill, log warning, notify Markus |
| **CenterDevice document unreadable** | Log error, skip, notify Markus |
| **Xero API error** | Retry 3x with backoff, then alert via Grafana |

### Notification Channels

| Channel | Use for |
|---------|---------|
| **WhatsApp Business Bot (group)** | Exceptions, weekly summary, ABA file ready |
| **Email** | ABA file delivery to Maria (with file attached) |
| **Grafana alerts** | System errors (API failures, container restarts) |

### Information Gaps
- **WhatsApp Business Bot:** Do you already have one set up, or is this new infrastructure to build?
- **Approval threshold:** What dollar amount divides "auto-approve" from "manual review"?
- **Susie's involvement:** Does Susie submit invoices, or does she just forward emails? Does she need to be notified when her invoices are processed?
- **Maria's workflow:** Does Maria currently get the ABA file via email, or does she download it from somewhere?

### Dependencies
- WhatsApp Business Bot is a separate build item (Meta Business API, or a service like Twilio)
- Exception notification requires the vendor mapping to exist (so it can identify "unknown" vendors)

---

## 7. Xero Integration & ABA File Generation

### The Core Question
Should the agent generate the ABA file itself, or should Xero handle it?

### Trade-offs

| Approach | Pro | Con |
|----------|-----|-----|
| **Xero's built-in batch payment / ABA export** | Xero handles the format, already integrated with your chart of accounts | Less control, requires bills to be fully approved in Xero first, may need Xero premium plan |
| **Agent generates ABA file from Xero data** | Full control over format, can include custom validation, works with any Xero plan | Must implement ABA format spec correctly (it's fiddly — fixed-width records, BSB validation, balanced totals) |
| **Hybrid: use Xero API to approve bills, then export ABA via Xero** | Best of both, Xero is the authority | Depends on Xero plan supporting ABA export via API |

### ABA File Format (Quick Reference)
The ABA (Australian Bankers' Association) format is a fixed-width text file:
- Record type 0: File header (bank name, user ID, date)
- Record type 1: Detail records (BSB, account, amount, payee name, reference)
- Record type 7: File trailer (totals, record count)

It's well-documented but unforgiving — a single character out of place and the bank rejects the file.

### Recommended Approach
**Check if Xero supports ABA export via API first.** If Xero can generate the ABA file from approved bills (via batch payment API), use that. It's less code, less risk of format errors, and Xero is already the financial system of record.

If Xero can't do this via API (or requires a plan upgrade), then the agent generates it. In that case:
1. Query Xero for approved bills due this week
2. For each bill, look up the vendor's bank details (BSB, account number — stored in Xero or in the agent's vendor mapping)
3. Generate the ABA file following the spec
4. Validate the file (balanced totals, valid BSBs)
5. Email the file to Maria

### Information Gaps (Critical)
- **Xero plan:** Which Xero plan are you on? Does it support batch payments and ABA export via API?
- **Vendor bank details:** Where are vendor BSB/account numbers stored? In Xero? In a spreadsheet? Does Joy maintain this?
- **ABA file from Joy:** Can you get a sample ABA file that Joy has generated? This would be the spec to match.
- **Bank requirements:** Do ANZ and CBA accept the same ABA format, or are there bank-specific variations?
- **Payment accounts:** Which bank account(s) do payments come from? Is it always the same account?

### Dependencies
- Xero API OAuth setup (application registration, OAuth 2.0 flow)
- Vendor bank details must be accessible to the agent
- ABA file validation should be tested against the bank before going live

---

## 8. Trigger & Scheduling

### The Core Question
When does each part of the agent run?

### Recommended Schedule

| Task | Trigger | Frequency | Time |
|------|---------|-----------|------|
| **Invoice ingestion** (poll CenterDevice, extract, create bills) | Cron | Daily | 07:00 AEST Mon-Fri |
| **Reconciliation check** (verify Xero bills match CenterDevice docs) | Cron | Daily | 08:00 AEST Mon-Fri |
| **Exception digest** (WhatsApp summary of items needing attention) | Cron | Daily (only if exceptions exist) | 09:00 AEST Mon-Fri |
| **ABA file generation** | Cron | Weekly | Friday 10:00 AEST |
| **ABA file delivery to Maria** | After ABA generation | Weekly | Friday ~10:05 AEST |

### Why Not Real-Time?

Invoices don't need real-time processing. They're not time-critical — they sit in a folder until the weekly payment run. Daily ingestion is plenty. Real-time (webhook-triggered) processing adds complexity (webhook reliability, retry logic, duplicate detection) for no practical benefit.

### Time Zone Consideration
The agent runs on box.makkib.com (UTC). All schedule times should be in AEST/AEDT since the bank and Maria are in Australia. Account for daylight saving shifts.

### Information Gaps
- **Payment deadline:** Is the ABA file always uploaded on Friday, or does it vary?
- **Maria's timezone:** Is she in AEST? When does she typically upload the file to the bank?
- **Invoice urgency:** Are there ever invoices that need same-day payment? If so, the daily batch won't work for those.

### Dependencies
- Cron scheduling: either system cron on box, or an in-container scheduler (node-cron)
- Friday ABA generation depends on all prior days' bills being in Xero and approved

---

## Summary: Decision Matrix

| # | Decision | Recommended | Confidence | Blocked by |
|---|----------|-------------|------------|------------|
| 1 | Infrastructure | Docker on box via Kamal | High | Nothing — ready to go |
| 2 | Data source | Poll CenterDevice folder | High | Confirm folder structure |
| 3 | Extraction method | Claude vision API | High | Confirm invoice formats |
| 4 | Scope | Phased: extract → categorise → ABA | High | Nothing |
| 5 | Reconciliation store | Xero + SQLite (no Airtable) | Medium | Confirm Xero bank feeds |
| 6 | Audit trail | Grafana + Xero notes + SQLite | High | Confirm Grafana retention |
| 7 | Approval flow | Auto for known, manual for new/high-value | Medium | Define threshold + vendor list |
| 8 | ABA generation | Xero API if supported, else agent-built | Low | **Must check Xero plan + API** |
| 9 | Notifications | WhatsApp group + email for Maria | Medium | WhatsApp Bot setup needed |
| 10 | Schedule | Daily ingest, weekly ABA on Friday | High | Confirm Maria's schedule |

## Next Steps: What to Answer Before Building

**Must answer (blocks Phase 1):**
1. Xero API credentials — do you have an app registered, or do we need to set one up?
2. Invoice volume and formats — roughly how many per week, and are they mostly PDFs?
3. CenterDevice folder structure — flat or organised?

**Must answer (blocks Phase 3):**
4. Xero plan and ABA support via API
5. Vendor bank details — where are they stored?
6. Sample ABA file from Joy
7. Approval threshold amount
8. WhatsApp Business Bot — existing or new?

**Nice to confirm:**
9. Grafana Cloud log retention period
10. Maria's timezone and preferred upload day/time
11. Susie's notification preferences
