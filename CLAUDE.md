# dotbrain

Central repository for CLAUDE.md templates, .cursorrules templates, and shared reference data. Designed to be symlinked into project repos.

## Structure

```
templates/           # Seed files for new projects (symlink targets)
  CLAUDE.md.*        # CLAUDE.md templates by project type
  cursorrules.*      # .cursorrules templates by project type
reference/           # Shared context data (read on demand)
  company/           # Company-wide facts
  docker-standard.md # Default Docker, Traefik, observability setup
  infrastructure.md  # VPS hosts, MCP stack, services, monitoring
  working-principles.md  # How Markus + Claude collaborate
  ressources/            # Kindle/Snipd highlights & distilled decision frameworks
scripts/
  link.sh            # Symlink helper
```

## Usage

To set up a new project:
```bash
./scripts/link.sh ~/repos/<project> software    # software projects live under ~/repos
./scripts/link.sh ~/projects/<project> corporate # non-software projects live under ~/projects
```

This symlinks `CLAUDE.md` and `.cursorrules` from the appropriate templates into the target project. Fill in the `<PLACEHOLDERS>` after linking.

## Graph Mail Tool

Location: `tools/graph-mail/`
Usage: `npx tsx ~/repos/dotbrain/tools/graph-mail/src/index.ts <command>`
Fetches M365 email threads with attachments to local files for analysis. Can also send emails, create draft replies in Outlook, and manage calendar events.

Supports two auth contexts:
- **Graph API** (default): primary mailbox — `login --account <alias>`
- **EWS** (`--archive` flag): online archive mailbox — `login-ews --account <alias>`

The online archive (In-Place Archive) is **not accessible via Graph API**. The `--archive` flag transparently routes through EWS SOAP. EWS requires the `EWS.AccessAsUser.All` delegated permission on the Azure app registration (resource: Office 365 Exchange Online), with admin consent granted.

Archive search uses subject-based conversation threading (not ConversationId, which the archive doesn't expose). Thread fetching via `--archive` groups messages by subject topic.

Commands:
```bash
# Auth
graph-mail login -a boc                       # Graph API (primary mailbox)
graph-mail login-ews -a boc                   # EWS (online archive)

# Search (add --archive for online archive)
graph-mail search -a boc -q "search terms"
graph-mail filter-search -a boc -k "keyword" --from 2023-01-01 --to 2024-12-31
graph-mail search -a boc -q "keyword" --archive

# Threads
graph-mail thread -a boc -q "query" -o ./output/name
graph-mail thread -a boc -c "conversation-id-or-topic" -o ./output/name --archive

# Archive folder listing
graph-mail archive-folders -a boc

# Send/Reply (always primary mailbox)
graph-mail send -a boc --to addr -s "Subject" -b body.md
graph-mail reply -a boc -m <message-id> -b body.md
```

## MD to PDF Tool

Location: `tools/md-pdf/`
Usage: `python3 ~/repos/dotbrain/tools/md-pdf/md2pdf.py input.md -o output.pdf`
Converts Markdown to McKinsey-style PDFs (WeasyPrint + custom CSS). Supports tables, code highlighting, blockquote callouts, footnotes, and page numbers. Use `--css` to override the built-in stylesheet. Accepts `-` for stdin.

## INWX DNS Tool

Location: `tools/inwx-dns/`
Records: `tools/inwx-dns/records/<domain>.yaml`
Credentials: `~/.config/inwx-dns-recordmaster/config.toml`

Manages DNS records for INWX domains declaratively via YAML files. Uses [inwx-dns-recordmaster](https://github.com/mxmehl/inwx-dns-recordmaster).

```bash
# Sync all domains (dry run first)
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records --dry

# Sync all domains for real
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records

# Sync single domain
inwx-dnsrm sync -c ~/repos/dotbrain/tools/inwx-dns/records -d example.com

# Import existing remote records to YAML
inwx-dnsrm convert -d example.com > tools/inwx-dns/records/example.com.yaml
```

Record file format:
```yaml
example.com:
  ".":
    - type: A
      content: 1.2.3.4
    - type: MX
      content: mail.example.com
      prio: 10
  www:
    - type: CNAME
      content: example.com
```

## Zoho Organization Tool

Location: `tools/zoho-org/`
Usage: `npx tsx ~/repos/dotbrain/tools/zoho-org/src/index.ts <command>`
Credentials: `tools/zoho-org/.env` (copy from `.env.example`)

Manages Zoho Mail EU organization: accounts, domains, groups via the Organization API.

Setup:
1. Create Self-Client at https://api-console.zoho.eu/
2. Generate auth code with scopes: `ZohoMail.organization.accounts.ALL,ZohoMail.organization.groups.ALL,ZohoMail.organization.domains.ALL`
3. Exchange for refresh token: `curl -X POST "https://accounts.zoho.eu/oauth/v2/token" -d "grant_type=authorization_code&client_id=...&client_secret=...&code=..."`
4. Copy `.env.example` to `.env` and fill in `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`

Commands:
```bash
zoho-org org                          # Show org details
zoho-org accounts list                # List all users
zoho-org accounts add -e user@dom --first X --last Y -p Pass123  # Add user
zoho-org domains list                 # List domains
zoho-org domains add example.com      # Add domain
zoho-org domains verify example.com   # Verify domain (TXT)
zoho-org domains verify-mx example.com
zoho-org groups list                  # List groups
zoho-org groups add -e team@dom -n Team  # Create group
```

## CenterDevice Upload Tool

Location: `tools/centerdevice-upload/`
Usage: `npx tsx ~/repos/dotbrain/tools/centerdevice-upload/src/index.ts <command>`
Credentials: `tools/centerdevice-upload/.env` (copy from `.env.example`)

Uploads and downloads files to/from CenterDevice. Bypasses the MCP base64 limitation — works with real files of any size.

Setup:
1. Copy `.env.example` to `.env`, fill in `CD_CLIENT_ID` and `CD_CLIENT_SECRET` (same OAuth app as mcp-stack centerdevice)
2. Run `cd-upload login` — opens browser OAuth flow, paste the callback URL to complete

Commands:
```bash
# Auth (browser OAuth, paste callback URL)
cd-upload login

# Verify credentials
cd-upload whoami

# Download documents by ID
cd-upload download <document-id> -o ./output/
cd-upload download <id1> <id2> <id3> -o ./output/

# Upload files (single, multiple, or directory)
cd-upload upload invoice.pdf --collection <id> --folder <id> --tag BOC
cd-upload upload *.pdf -c <collection-id> -f <folder-id>
cd-upload upload ./scans/ -c <collection-id> -t BOC -t "Steuer"

# Upload new version of existing document
cd-upload upload-version <document-id> updated-file.pdf

# Browse structure (find collection/folder IDs)
cd-upload collections
cd-upload folders -c <collection-id>
cd-upload folders -p <parent-folder-id>

# Search documents
cd-upload search "Kontoauszug" -c <collection-id>

# Dry run (show what would be uploaded)
cd-upload upload ./scans/ -c <id> -f <id> --dry
```

## SQ Awards Tool

Location: `tools/sq-awards/`
Usage: `npx tsx ~/repos/dotbrain/tools/sq-awards/src/index.ts <command>`
Credentials: `tools/sq-awards/.env` (copy from `.env.example`)

Searches Singapore Airlines KrisFlyer award seat availability via Playwright (browser-based, PPS Club login for full inventory visibility).

Setup:
1. Copy `.env.example` to `.env`, fill in `SQ_KRISFLYER_ID` and `SQ_KRISFLYER_PIN`
2. Run `login` command first to establish session cookies

Commands:
```bash
# Login (opens browser window — solve CAPTCHA if needed, session auto-detected)
sq-awards login

# Search (use xvfb-run for no visible window; SQ blocks headless browsers)
xvfb-run sq-awards search --origin SYD --destination SIN --date 2026-07-01 --cabin business
xvfb-run sq-awards scan --date 2026-07-01                         # All default routes
xvfb-run sq-awards scan --date 2026-07-01 --return-date 2026-07-20  # Include FRA-SIN return
xvfb-run sq-awards scan --date 2026-07-01 --routes SYD-SIN,SIN-FRA  # Filter routes
```

Default routes: SYD→SIN (late afternoon), SIN→FRA/MUC/BCN/ZRH, return FRA→SIN (evening).

## DocuSign Send Tool

Location: `tools/docusign-send/`
Usage: `npx tsx ~/repos/dotbrain/tools/docusign-send/src/index.ts <command>`
Credentials: `tools/docusign-send/.env` (copy from `.env.example`)

Sends documents for signature via DocuSign eSignature REST API. Uses JWT (RS256) for server-to-server auth.

Setup:
1. Copy `.env.example` to `.env`, fill in `DS_INTEGRATION_KEY`, `DS_USER_ID`, `DS_ACCOUNT_ID`, `DS_BASE_URI`
2. Place RSA private key as `tools/docusign-send/private.key`
3. Grant JWT consent once: open `https://<auth-host>/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<integration-key>&redirect_uri=http://localhost:3000/callback` and click Allow

Auth hosts: `account-d.docusign.com` (sandbox), `account.docusign.com` (production)

Commands:
```bash
# Verify credentials
docusign-send whoami

# Send document for signature (free-form signing by default)
docusign-send send contract.pdf --to "Name <email>"
docusign-send send contract.pdf --to "Alice <a@x.com>" --to "Bob <b@x.com>"

# Send with anchor placeholders (/sn1/, /dt1/, /nm1/ for signer 1, etc.)
docusign-send send contract.pdf --to "Alice <a@x.com>" --anchors

# Create draft instead of sending immediately
docusign-send send contract.pdf --to "Name <email>" --draft

# CC recipients
docusign-send send doc.pdf --to "Signer <s@x.com>" --cc "Copy <c@x.com>"

# List recent envelopes
docusign-send list
docusign-send list --status completed --from 2026-01-01

# Check envelope status
docusign-send status <envelope-id>

# Download signed documents
docusign-send download <envelope-id> -o ./output/

# Void an in-progress envelope
docusign-send void <envelope-id> -r "Reason"
```

Anchor placeholders (use `--anchors` flag):
- `/sn1/`, `/sn2/` — signature fields per signer
- `/dt1/`, `/dt2/` — date signed fields
- `/nm1/`, `/nm2/` — full name fields

## QPlix API Tool

Location: `tools/qplix-api/`
Usage: `npx tsx ~/repos/dotbrain/tools/qplix-api/src/index.ts <command>`
Credentials: `tools/qplix-api/.env` (just `QPLIX_BASE_URL=https://gkk.qplix.com`)
Spec: `tools/qplix-api/spec/openapi.{json,yaml}` — full OpenAPI for the tenant

Read-only CLI for QPlix portfolio data (clients, legal entities, reports, transactions, positions). Used for BOC group portfolio reporting and document download via GKK's QPlix tenant.

**Auth — non-obvious:** /qapi/v1/* authenticates by F5 BIG-IP + .NET session cookies *only* — the Okta JWTs visible in the InvestorPortal are red-herrings (they're used by /qapi/user/* helpers but not the data API). Sending an Authorization: Bearer header makes the app return 401. Cookies are session-scoped (die when browser closes), so the only path is to mint them via a real headed browser.

Setup:
1. Copy `.env.example` to `.env`, set `QPLIX_BASE_URL` (default `https://gkk.qplix.com`)
2. Run `qplix-api login` once — opens Chromium, complete M365 SSO. Persistent profile at `.browser-profile/` keeps M365 session sticky for ~weeks; subsequent `login` runs are usually silent.
3. Sessions cache for 25 min (F5 idle timeout is ~30). Re-run `login` when API calls start returning 401.

Commands:
```bash
# Auth
qplix-api login [--debug]              # Mint F5 session cookies (headed browser)
qplix-api logout [--hard]              # Clear cache (--hard also wipes browser profile)

# Clients
qplix-api clients list [--limit N]
qplix-api clients get <clientId>
qplix-api clients groups <clientId>

# Legal entities (portfolios)
qplix-api le list [-s "search"] [--include-virtual] [--limit N]
qplix-api le get <id> [--inherited]
qplix-api le custodians <id>
qplix-api le bank-accounts <id> <custodianId>
qplix-api le properties <id>
qplix-api le documents <id> [path]
qplix-api le query <id> <presetId> [--start-date YYYY-MM-DD] [--due-date YYYY-MM-DD]
qplix-api le transactions <id> <presetId> [--from YYYY-MM-DD] [--due-date YYYY-MM-DD]

# Reports
qplix-api reports list [--legal-entity <id>...] [--released-only]
qplix-api reports get <id>
qplix-api reports templates
qplix-api reports pdf <id> <outPath>

# Raw passthrough (escape hatch when no dedicated command exists)
qplix-api raw get /qapi/v1/<path> [-q key=value ...]
qplix-api raw post /qapi/v1/<path> -b '{"json":"body"}'
```

**Navigating the OpenAPI spec without blowing context:** the spec files are large (openapi.json ≈ 580 KB / 19k lines, openapi.yaml ≈ 1.2 MB / 33k lines). Don't `Read` them wholesale. Search first:

```bash
# List all paths matching a keyword
python3 -c "import json; s=json.load(open('tools/qplix-api/spec/openapi.json')); [print(p) for p in s['paths'] if 'transaction' in p.lower()]"

# Inspect a specific endpoint's params + response schema
python3 -c "import json; s=json.load(open('tools/qplix-api/spec/openapi.json')); print(json.dumps(s['paths']['/qapi/v1/legalEntities/{id}/queryResults/{presetId}'], indent=2))"

# Resolve a $ref-ed schema by name
python3 -c "import json; s=json.load(open('tools/qplix-api/spec/openapi.json')); print(json.dumps(s['components']['schemas']['<SchemaName>'], indent=2))"
```

Common queries cheat-sheet:
- "Who are the clients?" → `qplix-api clients list`
- "What portfolios exist?" → `qplix-api le list`
- "Latest BOC report PDF" → `qplix-api reports list --legal-entity <BOC-id>`, then `qplix-api reports pdf <reportId> ./out.pdf`
- "Positions/transactions for a portfolio" → first need a saved preset ID — list via `qplix-api raw get /qapi/v1/legalEntities/<id>/queryPresets` (or whichever path the spec exposes), then run `le query` / `le transactions` against it.

## Conventions

- Templates use `<PLACEHOLDER>` markers for project-specific values
- Reference files are the single source of truth — project files reference them, never duplicate
- All paths assume dotbrain lives at `~/repos/dotbrain/`
- Software projects live under `~/repos/`, non-software (corporate) projects under `~/projects/`
