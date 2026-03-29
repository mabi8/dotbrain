# WhatsApp Business API for Canyala

## Context

Canyala (Can Yala villa, Ibiza) needs WhatsApp on **+34 930 49 00 40** to communicate with guests, contractors, and internally (Markus/team). The goal is programmatic access from our automation stack, not just the mobile app.

## Recommended Approach: Twilio WhatsApp API

**Why Twilio:**
- Embedded signup creates Meta Business Account inline — no manual business.facebook.com setup
- Handles token management, no System User tokens to create/rotate
- Clean SDK: `twilio.messages.create({from: 'whatsapp:+34930490040', to: '...', body: '...'})`
- Template submission via Twilio console (not Meta Business Manager)
- Simpler webhook payloads than raw Meta Graph API
- Landline numbers supported (voice call verification)

**Cost:** ~$0.005/msg Twilio markup + Meta conversation fees (first 1,000/month free per category). At Canyala's volume (~20-50 conversations/month) this is effectively zero. Infrastructure runs on existing box.makkib.com.

---

## Setup Steps

### Step 1: Prep the Number (Markus, manual)

1. Back up any important WhatsApp chats on the phone for +34 930 49 00 40
2. Delete WhatsApp account from the app (Settings > Account > Delete account)
   - The number must be deregistered from any WhatsApp app before API registration

### Step 2: Twilio Account + WhatsApp Sender (Markus, manual)

1. Sign up at [twilio.com](https://www.twilio.com) (or use existing account)
2. Go to Messaging > Senders > WhatsApp Senders > Add new sender
3. Twilio's embedded signup flow will:
   - Create a Meta Business Account (or link existing)
   - Register **+34 930 49 00 40** as WhatsApp Business number (voice call verification for landline)
   - Set display name: "Can Yala" or "Canyala Ibiza"
   - Business category: "Travel & Tourism"
4. Note down:
   - **Twilio Account SID**
   - **Twilio Auth Token**
   - **WhatsApp Sender** (format: `whatsapp:+34930490040`)

### Step 3: Message Templates (Twilio Console)

Submit content templates in Twilio Console > Messaging > Content Template Builder.
Required for business-initiated messages (WhatsApp policy — you can only start conversations using approved templates):

| Template | Audience | Content |
|----------|----------|---------|
| `guest_checkin` | Guests | Welcome + check-in instructions, WiFi, house rules link |
| `guest_checkout` | Guests | Checkout reminder + instructions |
| `guest_welcome` | Guests | Pre-arrival welcome with directions |
| `contractor_schedule` | Contractors | Appointment confirmation with date/time |
| `contractor_reminder` | Contractors | Reminder for upcoming maintenance visit |

Once a guest/contractor replies, the 24h conversation window opens for free-form messages.

### Step 4: Build `canyala-whatsapp` Service

New repo: `github.com/canyalaes/canyala-whatsapp` (or `mabi8/canyala-whatsapp`)

**Stack** (matches ecosystem):
- TypeScript + Node.js 22
- Express (HTTP server for webhook + health)
- Twilio SDK (`twilio` npm package)
- SQLite (conversation log, contact registry)
- Claude API (fully automatic guest replies)
- MCP server (SSE transport, same pattern as CenterDevice/Bidrento)
- Kamal deploy to box.makkib.com

**Core modules:**

```
canyala-whatsapp/
├── src/
│   ├── index.ts              # Express server, health endpoint, MCP SSE transport
│   ├── webhook.ts            # POST /webhook — receive incoming messages from Twilio
│   ├── twilio.ts             # Twilio client wrapper (send text, send template, media)
│   ├── contacts.ts           # Contact registry (guest/contractor/internal + metadata)
│   ├── router.ts             # Route incoming messages by contact type
│   ├── handlers/
│   │   ├── guest.ts          # Guest message handling (fully automatic Claude replies)
│   │   ├── contractor.ts     # Contractor message handling + internal forwarding
│   │   └── internal.ts       # Internal/admin commands (e.g., "send checkin +34...")
│   ├── claude.ts             # Claude API integration for generating guest replies
│   ├── notify.ts             # Forward alerts to Markus (internal WA or Telegram)
│   ├── mcp/
│   │   ├── server.ts         # MCP server setup (SSE transport, tool registry)
│   │   └── tools.ts          # MCP tools: send_message, list_conversations, search_messages, manage_contacts
│   └── db.ts                 # SQLite schema + queries (conversations, contacts, messages)
├── config/
│   └── deploy.yml            # Kamal config
├── Dockerfile
├── .kamal-secrets.example
└── package.json
```

**Key functionality:**

1. **Webhook receiver** — Twilio sends incoming messages to `POST https://wa.makkib.com/webhook`
2. **Contact registry** — SQLite table mapping phone numbers to roles (guest/contractor/internal) with metadata (stay dates, contractor specialty, etc.)
3. **Smart routing:**
   - Guest messages → Claude auto-replies (house info, local tips, issue escalation to Markus)
   - Contractor messages → logged, forwarded to internal chat
   - Internal messages → admin commands (e.g., "send checkin +34612345678")
4. **Outbound** — send template messages and free-form replies via Twilio SDK
5. **Notification forwarding** — new guest/contractor messages alert Markus via WhatsApp (internal) or Telegram (@bclai_bot)
6. **MCP interface** — tools (send_message, list_conversations, search_messages, manage_contacts) accessible from Claude.ai

### Step 5: Deploy via Kamal

```yaml
# config/deploy.yml
service: canyala-whatsapp
image: ghcr.io/mabi8/canyala-whatsapp

servers:
  web:
    hosts:
      - 178.104.36.179  # box.makkib.com

ssh:
  user: ops

proxy:
  host: wa.makkib.com
  app_port: 3000
  ssl: true
  healthcheck:
    path: /up

registry:
  server: ghcr.io
  username: mabi8
  password:
    - KAMAL_REGISTRY_PASSWORD

env:
  clear:
    NODE_ENV: production
  secret:
    - TWILIO_ACCOUNT_SID
    - TWILIO_AUTH_TOKEN
    - TWILIO_WHATSAPP_FROM    # whatsapp:+34930490040
    - ANTHROPIC_API_KEY       # For Claude-assisted replies
```

**DNS:** A record `wa.makkib.com` → 178.104.36.179

### Step 6: Connect Webhook in Twilio

In Twilio Console > Messaging > WhatsApp Senders > +34 930 49 00 40 > Configuration:
- Webhook URL: `https://wa.makkib.com/webhook`
- Method: POST

---

## Interaction Model

```
Guest sends WhatsApp message
  → Twilio webhook → wa.makkib.com/webhook
  → Router identifies contact as "guest"
  → Claude generates contextual reply (house info, local tips)
  → Auto-reply sent back via Twilio SDK
  → Alert forwarded to Markus (internal WhatsApp or Telegram)

Markus sends "send checkin +34612345678"
  → Router identifies as internal command
  → Sends guest_checkin template via Twilio
  → Logs in SQLite

From Claude.ai (MCP):
  → send_message tool → Twilio SDK → guest receives WhatsApp
  → list_conversations tool → query SQLite → see recent threads
```

---

## Decisions

- **Number migration required:** +34 930 49 00 40 is currently on WhatsApp. Must be deregistered from the app before registering with Twilio/Cloud API. Chat history on the phone will be lost (back up first).
- **Twilio as BSP** — simpler onboarding than direct Meta Cloud API, negligible cost difference at our volume.
- **Fully automatic guest replies** — Claude responds instantly, forwards to Markus for awareness. Markus can override/intervene anytime.
- **MCP interface included** — expose tools (send_message, list_conversations, search_messages, manage_contacts) so Markus can interact from Claude.ai, same pattern as CenterDevice/Bidrento MCPs.

---

## Implementation Order

### Phase A: Twilio + Number Setup (Markus, manual)
1. Back up WhatsApp chats on the phone for +34 930 49 00 40
2. Delete WhatsApp account from the app (Settings > Account > Delete account)
3. Sign up / log in at twilio.com
4. Add WhatsApp sender: +34 930 49 00 40 (embedded Meta Business signup + voice verification)
5. Submit message templates via Twilio Content Template Builder
6. Create DNS A record: `wa.makkib.com` → 178.104.36.179

### Phase B: Build Service (Claude)
1. Scaffold `canyala-whatsapp` repo with Express + health endpoint + Twilio webhook
2. Implement Twilio client (send text, send template, receive messages)
3. Add SQLite schema (contacts, conversations, messages)
4. Add contact registry + message routing by contact type
5. Add Claude-powered automatic guest reply handler
6. Add internal command handler ("send checkin +34...", "add guest +34... Name CheckinDate")
7. Add notification forwarding (new messages → Markus via internal WA)
8. Add MCP server (SSE transport) with tools: send_message, list_conversations, search_messages, manage_contacts

### Phase C: Deploy & Connect
1. Create Dockerfile + deploy.yml, deploy via Kamal to box.makkib.com
2. Configure webhook URL in Twilio Console → `https://wa.makkib.com/webhook`
3. Test end-to-end: send test message from personal phone → verify auto-reply + forwarding
4. Connect MCP to Claude.ai (add to Connected MCPs)
5. Register Markus's number as internal contact, test admin commands

### Phase D: Go Live
1. Add real guest/contractor contacts
2. Send first template message to a test guest
3. Verify full flow: guest reply → Claude auto-response → Markus notification
