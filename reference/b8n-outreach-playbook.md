# b8n Outreach Restart — Lessons Learned & Playbook

**Date:** 2026-03-30
**Author:** Markus Binder (with Claude Code)
**For:** Leo, Tony

---

## What is this project?

Setting up cold outreach infrastructure for b8n from scratch: 17 domains, DNS, Zoho email accounts, and Instantly.ai campaigns. The goal is maximum email deliverability for B2B outreach.

We had a previous setup (see "What went wrong before") and this is the clean restart.

---

## What we did — step by step

### 1. Project scaffolding with CLAUDE.md

Before touching any infrastructure, we created a `CLAUDE.md` file that acts as the **project brain**. It tells Claude Code:

- What the project goal is and when it's due
- What tools are available (INWX API, Instantly.ai MCP, graph-mail)
- Where to find shared reference docs (`~/repos/dotbrain/reference/`)
- The directory structure and task tracking location

**Why this matters:** Every time you start a new Claude Code conversation in this directory, Claude reads `CLAUDE.md` automatically and has full context. No re-explaining. This is the single most important thing to set up first.

**Takeaway for Leo & Tony:** Start every project by writing a `CLAUDE.md`. It's your persistent briefing doc. Include: goal, deadline, tools, directory layout, and where to track tasks.

### 2. Domain inventory

We collected all 17 b8n domains into `docs/domains.md` — a single source of truth. Having them in a markdown table meant Claude could read and reference them instantly in every conversation.

Domains:
```
b8n-capital.com      b8n-equity.com       b8n-group.com
b8n-holdings.com     b8n-invest.com       b8n-investments.com
b8n-management.com   b8n-partners.com     b8n-privateequity.com
b8n-strategic.com    b8n-team.com         b8nsolutions.com
b8nteam.com          get-b8n.com          go-b8n.com
team-b8n.com         teamb8n.com
```

### 3. DNS automation — zones + MX records

This was the first real automation win. Instead of clicking through INWX's web UI 17 times, we:

#### a) Created all DNS zones via Python script

`dns/create_zones.py` — a 60-line script that:
- Reads INWX credentials from the existing `inwx-dns-recordmaster` config
- Calls `nameserver.create` for each domain via INWX's JSON-RPC API
- Handles "already exists" gracefully (idempotent)
- Sets up standard INWX nameservers (`ns.inwx.de`, `ns2.inwx.de`, `ns3.inwx.eu`)

Claude wrote this script, we reviewed it, ran it once — 17 zones created in seconds.

#### b) MX records via YAML + inwx-dnsrm

For each domain, we generated a YAML file (e.g., `dns/b8n-capital.com.yaml`) with Zoho EU MX records:

```yaml
b8n-capital.com:
  .:
    - type: MX
      content: mx.zoho.eu
      prio: 10
    - type: MX
      content: mx2.zoho.eu
      prio: 20
    - type: MX
      content: mx3.zoho.eu
      prio: 50
```

Then synced all 17 with `inwx-dnsrm` using the `-p` (preserve) flag to keep existing NS/A records intact.

**Takeaway:** If you have a CLI tool or API, tell Claude about it in `CLAUDE.md`. It can write scripts that call the API directly, turning a 2-hour manual task into a 2-minute automated one.

### 4. Email account strategy — deliverability-optimized

This is where we spent the most thinking time and where the previous setup went wrong.

#### What went wrong before

The old setup (`docs/old-predict-setup.md`) had **86+ email variants** across domains — every permutation of names, separators, and orderings:
```
markus.binder, binder.markus, markusbinder, bindermarkus,
markus_binder, binder_markus, m.binder, binder.m, mbinder, binderm,
m_binder, binder_m, m-binder, binder-m, markus.b, b.markus, ...
```

This is exactly what gets flagged by ESPs. Mass-created accounts on the same domain with pattern variations scream "spam operation."

#### What we did instead

**Principle: one account per domain, use the most trustworthy format.**

We chose `markus.binder@` (first.last) as the gold standard — it's the most professional, most trusted by spam filters, and most natural for a real business person.

But we also wanted data, so we set up a controlled A/B test with 3 variants across 12 domains:

| Variant | Count | Format | Purpose |
|---------|-------|--------|---------|
| Primary | 8 | `markus.binder@` | Baseline — professional first.last |
| Test A | 2 | `markus@` | Founder/personal tone |
| Test B | 2 | `m.binder@` | DACH corporate standard |

The remaining 5 domains are held in reserve for scaling later.

**Key insight:** Pattern diversity across domains doesn't help deliverability. ESPs fingerprint by domain reputation, IP, content, and sending behavior — not by whether your local-part matches other accounts on unrelated domains. Use the best format everywhere.

**Takeaway:** Less is more. One strong email per domain beats five weak ones. Test with intention (A/B), not with spray-and-pray.

### 5. Zoho as email provider

We chose Zoho Mail (EU region) because:
- Affordable for many domains/accounts
- Good deliverability reputation
- EU data residency
- API for account provisioning

MX records point to `mx.zoho.eu`, `mx2.zoho.eu`, `mx3.zoho.eu`.

#### Full Zoho setup via API — what we actually did

We built a CLI tool (`~/repos/dotbrain/tools/zoho-org/`) that manages the entire Zoho organization via their Organization API. This was the single biggest time-saver: instead of clicking through the Zoho admin console 12× for each step, we scripted the entire flow.

**OAuth setup (one-time):**
1. Create a Self-Client at https://api-console.zoho.eu/
2. Generate auth code with scopes: `ZohoMail.organization.accounts.ALL,ZohoMail.organization.groups.ALL,ZohoMail.organization.domains.ALL`
3. Exchange for refresh token via `POST https://accounts.zoho.eu/oauth/v2/token`
4. Store credentials in `tools/zoho-org/.env`

**Domain setup sequence (per domain, all automated):**

| Step | CLI command | What it does |
|------|-----------|--------------|
| 1 | `zoho-org domains add <domain>` | Register domain in Zoho |
| 2 | Add TXT verification record to INWX | `zoho-verification=zb<code>.zmverify.zoho.eu` |
| 3 | `zoho-org domains verify <domain> -m txt` | Verify ownership |
| 4 | `zoho-org domains enable-hosting <domain>` | Enable mail hosting (**required before MX verify**) |
| 5 | `zoho-org domains verify-mx <domain>` | Verify MX records |
| 6 | `zoho-org domains add-dkim <domain>` | Generate DKIM key pair |
| 7 | Add DKIM TXT record to INWX | `zoho._domainkey.<domain>` with the public key |
| 8 | `zoho-org domains verify-dkim <domain>` | Verify DKIM |

**Account creation:**
```bash
zoho-org accounts add -e markus.binder@b8n-capital.com -p "Password123!" --first Markus --last Binder
```

**Gotchas we discovered:**
- **Zoho rate-limits the OAuth refresh endpoint aggressively** — we had to add disk-based token caching (`.token-cache.json`) to avoid hammering it
- **CNAME verification doesn't work** when INWX has wildcard/redirect records — use TXT verification instead
- **`enableMailHosting` must be called** before `verifyMxRecord` — the API returns a misleading "not enabled" error otherwise
- **API mode strings are inconsistently cased** — `enableMailHosting` vs `addDkimDetail` vs `verifyMxRecord`. Trial and error required; Zoho docs are incomplete
- **SPF verification has no working API mode** — SPF status shows as unverified in the API even though the TXT records are live. Trigger from admin console or wait for auto-detection
- **IMAP access is disabled by default** on new accounts — must call `updateIMAPStatus` mode with `imapAccessEnabled: true` before Instantly (or any IMAP client) can connect. Instantly gives a generic "Bad Request" with no hint about the cause

### 6. DNS records — the full picture

Each domain gets these records in INWX (managed via `inwx-dnsrm`):

```yaml
b8n-capital.com:
  "--options":
    preserve_remote: true          # Don't delete existing NS/A records
  ".":
    - type: MX
      content: mx.zoho.eu
      prio: 10
    - type: MX
      content: mx2.zoho.eu
      prio: 20
    - type: MX
      content: mx3.zoho.eu
      prio: 50
    - type: TXT
      content: "v=spf1 include:zoho.eu ~all"
    - type: TXT
      content: "zoho-verification=zb63677948.zmverify.zoho.eu"
  _dmarc:
    - type: TXT
      content: "v=DMARC1; p=quarantine; rua=mailto:markus.binder@b8n.com; pct=100"
  zoho._domainkey:
    - type: TXT
      content: "v=DKIM1; k=rsa; p=<public-key>"
  zb63677948:                      # CNAME verification (optional, TXT is preferred)
    - type: CNAME
      content: business.zoho.eu
```

All YAML files live in `~/repos/dotbrain/tools/inwx-dns/records/`. To sync:
```bash
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records --dry   # preview
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records          # apply
```

### 7. Instantly.ai — accounts, warmup, and campaign

Instantly is the sending platform. Claude Code has Instantly.ai MCP tools built in, so the entire setup was done from the terminal.

#### Adding accounts to Instantly

Each Zoho email account was added to Instantly with IMAP/SMTP credentials:

```
Provider: IMAP (code 1)
IMAP: imappro.zoho.eu:993
SMTP: smtppro.zoho.eu:465
Username/password: same as Zoho account credentials
```

**Critical prerequisite:** IMAP access must be **explicitly enabled** on each Zoho account before Instantly can connect. This is done via the Zoho Organization API:

```bash
# PUT /api/organization/{zoid}/accounts/{accountId}
# Body: {"mode": "updateIMAPStatus", "zuid": "<zuid>", "imapAccessEnabled": true}
```

Without this, Instantly returns "Bad Request" when creating the account — no helpful error message.

#### Warmup

Warmup was enabled on all 12 accounts immediately after adding them. Instantly gradually increases send volume over 2-3 weeks to build domain reputation. All accounts are now warming up (started 2026-03-30).

#### Campaign: "26-03 B8N Outreach Restart"

| Setting | Value |
|---------|-------|
| Campaign ID | `30f8c90e-d282-4c5a-84f7-d226c02dbcb1` |
| Senders | All 12 b8n accounts |
| Schedule | Mon-Fri, 08:00-18:00 Australia/Melbourne |
| Daily limit | 30 emails/day/account |
| Email gap | 10 minutes between sends |
| Open tracking | Off (better deliverability) |
| Click tracking | Off (better deliverability) |
| Stop on reply | Yes |

**Target market:** Australia — timezone set to `Australia/Melbourne` so emails arrive during AEST business hours.

The campaign is currently **paused** (warmup only). To launch:
1. Wait for warmup to reach good scores (2-3 weeks, check in Instantly dashboard)
2. Prepare and upload lead lists
3. Refine the email sequence (current subject/body is a placeholder)
4. Activate via `instantly activate_campaign` or the Instantly dashboard

#### Instantly via Claude Code MCP

All Instantly operations are available as MCP tools in Claude Code:

```
# Account management
instantly list_accounts
instantly create_account          # IMAP/SMTP credentials
instantly manage_account_state    # pause, resume, enable/disable warmup

# Campaigns
instantly create_campaign
instantly update_campaign
instantly activate_campaign
instantly get_campaign_analytics

# Leads
instantly create_lead
instantly add_leads_to_campaign_or_list_bulk
instantly list_leads
```

No CLI tool needed — Claude calls the Instantly API directly via MCP.

---

## How we used Claude Code

### The workflow

1. **Start with `CLAUDE.md`** — project context, tools, structure
2. **Ask Claude to research/plan** — e.g., "which email formats maximize deliverability?"
3. **Challenge its answers** — when Claude suggested 10 different email patterns, we pushed back ("why not just use the gold standard?") and it corrected course
4. **Generate automation scripts** — DNS zone creation, YAML configs
5. **Track decisions in markdown** — everything lands in `docs/`, not in chat history

### What worked well

- **CLAUDE.md as persistent context** — never had to re-explain the project
- **MCP integrations** — Instantly.ai tools available directly in conversation
- **Script generation** — Claude wrote the INWX API script correctly on first try because we pointed it at the existing `inwx-dns-recordmaster` config
- **Decision documentation** — asking Claude to save decisions to files means they survive across conversations
- **Pushing back on suggestions** — Claude's first instinct was "diversity = good" for email patterns. The correct answer was simpler. Always question the reasoning.

### What to watch out for

- **Claude will over-engineer if you let it** — it suggested 10 different email username patterns when 1 was the right answer. Always ask "why?" and "is there evidence for that?"
- **Verify claims about deliverability** — Claude cited "ESP fingerprinting of local-part patterns" which turned out to be unsubstantiated. Trust but verify.
- **Save decisions to files, not just chat** — conversations are ephemeral. If Claude helped you make a decision, have it write it to a doc.
- **One thing at a time** — don't ask Claude to set up DNS, create email accounts, AND configure campaigns in one go. Sequential steps with verification between each.

---

## Tools reference

All tools live in `~/repos/dotbrain/tools/` and are documented in `~/repos/dotbrain/CLAUDE.md`.

| Tool | Location | What it does | How we use it |
|------|----------|-------------|---------------|
| `inwx-dnsrm` | pipx (global) | Syncs YAML DNS records to INWX | MX, SPF, DKIM, DMARC, verification records |
| `zoho-org` | `tools/zoho-org/` | Zoho Mail EU org management CLI | Domains, accounts, groups, DKIM via API |
| `dns/create_zones.py` | this project | Creates INWX nameserver zones | One-time setup for 17 domains |
| Instantly.ai (MCP) | Claude Code MCP | Campaign management | Warm-up, sending, analytics |
| `graph-mail` | `tools/graph-mail/` | M365 email access | Reading/managing inbox |
| `md-pdf` | `tools/md-pdf/` | Markdown to PDF | Reports, proposals |
| Claude Code | CLI | AI assistant in terminal | Scripts, planning, docs, API calls |

### zoho-org quick reference

```bash
# Run from ~/repos/dotbrain/tools/zoho-org/
alias zoho-org="npx tsx ~/repos/dotbrain/tools/zoho-org/src/index.ts"

# Organization
zoho-org org                              # Org details
zoho-org storage                          # Subscription/storage

# Accounts
zoho-org accounts list                    # List all users
zoho-org accounts get <email>             # User details
zoho-org accounts add -e <email> -p <pw> --first <F> --last <L>
zoho-org accounts enable <accountId>
zoho-org accounts disable <accountId>
zoho-org accounts delete <zuid>

# Domains
zoho-org domains list                     # Status overview (verified, MX, SPF, DKIM)
zoho-org domains add <domain>             # Add to Zoho
zoho-org domains verify <domain> -m txt   # Verify ownership
zoho-org domains enable-hosting <domain>  # Enable mail (before MX verify!)
zoho-org domains verify-mx <domain>       # Verify MX records
zoho-org domains add-dkim <domain>        # Generate DKIM key
zoho-org domains verify-dkim <domain>     # Verify DKIM after DNS setup
zoho-org domains delete <domain>

# Groups
zoho-org groups list
zoho-org groups add -e <email> -n <name>
```

---

## Status — what's done, what's left

### Done (2026-03-30)

- [x] 12 active domains added to Zoho, all verified
- [x] Mail hosting enabled on all 12
- [x] MX records deployed and verified (mx.zoho.eu, mx2, mx3)
- [x] SPF records deployed (`v=spf1 include:zoho.eu ~all`)
- [x] DKIM generated, DNS deployed, and verified on all 12
- [x] DMARC deployed (`p=quarantine`, reports to markus.binder@b8n.com)
- [x] 12 email accounts created (password: `B8n-Outreach-2026!`)
- [x] IMAP access enabled on all 12 Zoho accounts
- [x] All DNS managed as code in `~/repos/dotbrain/tools/inwx-dns/records/`
- [x] `zoho-org` CLI tool built for ongoing management
- [x] All 12 accounts added to Instantly.ai with IMAP/SMTP credentials
- [x] Warmup enabled on all 12 accounts (started 2026-03-30)
- [x] Campaign "26-03 B8N Outreach Restart" created, Australia/Melbourne timezone
- [x] 12 sender accounts assigned to campaign

### Still TODO

- [ ] Trigger SPF verification in Zoho admin console (records are live, Zoho just hasn't checked yet)
- [ ] Wait for warmup to reach good scores (~2-3 weeks, target mid-April 2026)
- [ ] Prepare Australia lead lists
- [ ] Draft outreach sequences (current subject/body is placeholder)
- [ ] Activate campaign
- [ ] Evaluate A/B test results after 2-3 weeks of sending

---

## Custom tools we built

All tools are in `~/repos/dotbrain/tools/` and documented in `~/repos/dotbrain/CLAUDE.md`.

### inwx-dns (DNS as code)
- Installed via `pipx install inwx-dns-recordmaster`
- YAML record files in `~/repos/dotbrain/tools/inwx-dns/records/<domain>.yaml`
- Credentials in `~/.config/inwx-dns-recordmaster/config.toml`
- Sync: `inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records`
- Always use `--dry` first, and `preserve_remote: true` in YAML to avoid deleting existing records

### zoho-org (Zoho organization management)
- TypeScript CLI in `~/repos/dotbrain/tools/zoho-org/`
- OAuth credentials in `tools/zoho-org/.env`
- Token caching in `.token-cache.json` (auto-refreshes, avoids rate limits)
- Manages: domains, accounts, groups, DKIM, mail hosting
- Run via: `npx tsx ~/repos/dotbrain/tools/zoho-org/src/index.ts <command>`

### Playbook: adding a new domain from scratch

```bash
# 1. Add domain to Zoho
zoho-org domains add newdomain.com
# Note the verification code from the output

# 2. Create INWX YAML with all DNS records
cat > ~/repos/dotbrain/tools/inwx-dns/records/newdomain.com.yaml <<EOF
newdomain.com:
  "--options":
    preserve_remote: true
  ".":
    - type: MX
      content: mx.zoho.eu
      prio: 10
    - type: MX
      content: mx2.zoho.eu
      prio: 20
    - type: MX
      content: mx3.zoho.eu
      prio: 50
    - type: TXT
      content: "v=spf1 include:zoho.eu ~all"
    - type: TXT
      content: "zoho-verification=zb<CODE>.zmverify.zoho.eu"
  _dmarc:
    - type: TXT
      content: "v=DMARC1; p=quarantine; rua=mailto:markus.binder@b8n.com; pct=100"
EOF

# 3. Deploy DNS
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records --dry
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records

# 4. Verify domain, enable hosting, verify MX
zoho-org domains verify newdomain.com -m txt
zoho-org domains enable-hosting newdomain.com
zoho-org domains verify-mx newdomain.com

# 5. Generate DKIM, add to DNS, verify
zoho-org domains add-dkim newdomain.com
# Copy the public key from output, add zoho._domainkey TXT record to YAML
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records
zoho-org domains verify-dkim newdomain.com

# 6. Create email account
zoho-org accounts add -e user@newdomain.com -p "SecurePass123!" --first First --last Last

# 7. Enable IMAP access (required for Instantly)
# Via Zoho API: PUT /api/organization/{zoid}/accounts/{accountId}
# Body: {"mode": "updateIMAPStatus", "zuid": "<zuid>", "imapAccessEnabled": true}
# (accountId and zuid are returned by the accounts add command)

# 8. Add to Instantly (via Claude Code MCP)
# instantly create_account with:
#   IMAP: imappro.zoho.eu:993
#   SMTP: smtppro.zoho.eu:465
#   provider_code: 1 (IMAP)

# 9. Enable warmup
# instantly manage_account_state enable_warmup
```

These live in the shared dotbrain repo so any future outreach project (or Leo/Tony) can use them without starting from scratch.

---

## File map

```
# This project
CLAUDE.md                          # Project brain — Claude reads this first
docs/
  domains.md                       # All 17 domains, single source of truth
  email-accounts.md                # 12 active accounts + 5 reserve domains
  2026-03-30_dns-setup-log.md      # What we did for DNS, step by step
  old-predict-setup.md             # Previous setup (what NOT to do)
  lessons-learned.md               # This file
dns/
  create_zones.py                  # Script to create INWX zones
  *.yaml                           # MX record configs per domain
tasks/
  todo.md                          # Task checklist

# Shared tools (~/repos/dotbrain/)
tools/
  inwx-dns/records/*.yaml          # DNS records as code (all b8n domains)
  zoho-org/                        # Zoho org management CLI
    src/index.ts                   #   CLI entrypoint
    src/api.ts                     #   API client (accounts, domains, groups, DKIM)
    src/auth.ts                    #   OAuth with disk token cache
    src/config.ts                  #   Config loader (.env)
    .env                           #   Credentials (not committed)
    .env.example                   #   Template
  graph-mail/                      # M365 email CLI
  md-pdf/                          # Markdown to PDF
```
