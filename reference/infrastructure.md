# Infrastructure Reference

## VPS Hosts

### box.makkib.com (Primary)
- **IP:** 135.125.179.131
- **OS:** Ubuntu
- **Firewall:** iptables (NOT ufw) — always v4+v6
- **Roles:** Self-hosted MCPs, BCL Telegram bot, Talvoss daemon
- **Grafana Alloy:** ships journald → Loki, host metrics → Prometheus (label: `box="box"`)
- **Alloy config:** `/etc/alloy/config.alloy`, creds: `/etc/alloy/alloy.env`

### sss.makkib.com (Bastion / vps-cmd)
- **Firewall:** iptables (NOT ufw) — always v4+v6
- **Role:** SSS MCP bastion host, SSHes into worker VPS
- **Grafana Alloy:** label `host="sss"`

### Default iptables hardening (both hosts)
Flush → allow loopback → allow established/related → allow icmpv6 (v6 only) → allow 22/80/443 → drop all else. Save to `/etc/iptables/rules.v4` and `rules.v6`. Always apply both v4 and v6 together.

---

## MCP Stack

### Monorepo: github.com/mabi8/mcp-stack
- `packages/core` — shared utilities
- `packages/centerdevice` — 46 tools, port :9443, user `cdapi`, host `box`
- `packages/bidrento` — 40 tools, port :9444, user `bdroapi`, host `box`
- `packages/vps-cmd` — 7 tools, port :9445, user `ops`, host `sss.makkib.com`, branch `feature/vps-cmd`

### Deploy
```bash
sudo bash /home/cdapi/mcp-stack/deploy/update.sh {all|centerdevice|bidrento}
```

### vps-cmd (SSS MCP) Tools
`run_command`, `check_service`, `deploy_service`, `confirm_execution`, `list_services`, `read_file`, `write_file`

**Tier engine:** T1 auto-execute (read-only), T2 approval (deploy-flow), T3 approval (destructive)

Auth: passphrase-gated OAuth. Bastion on sss SSHes into worker VPS. `hosts.json` defines allowlists.

### Connected MCPs (Claude.ai)
- **CenterDevice** — `box.makkib.com/mcp` (self-hosted)
- **Bidrento** — `box.makkib.com/bidrento/mcp` (self-hosted)
- **SSS** — `sss.makkib.com/mcp` (self-hosted)
- **Microsoft 365** — Markus.Binder@B8n.com
- **Instantly.ai** — Talvoss cold outreach
- **Netlify** — Talvoss frontend hosting
- **Outline Wiki BCL** — `app.bcliving.de/outline/mcp`

### Roadmap (docs/ROADMAP.md)
**Known issues:**
- ClientRegistry not persisted (all MCPs, medium)
- Bidrento grant page no user identity (low)

**Planned:**
- Dockerize services (medium)
- Grafana MCP server via grafana/mcp-grafana (medium)
- vps-cmd per-user identity (low)

---

## BCL Telegram Bot

- **Bot:** @bclai_bot
- **Repo:** github.com/mabi8/bcl-telegram-claude
- **Deployed:** `~bclai/bcl-telegram-claude` on box.makkib.com
- **Service:** `bcl-telegram.service` (systemd)
- **Port:** 3842
- **Stack:** Telegraf, SQLite, claude-opus-4, CenterDevice MCP via OAuth
- **OAuth callback:** `https://box.makkib.com/bclai/auth/callback` → port 3842

---

## Monitoring

- **Stack:** Grafana Cloud (free tier) + Alloy agents on box + sss
- **Alloy ships:** journald logs → Loki, host metrics → Prometheus
- **Config:** `/etc/alloy/config.alloy`, creds `/etc/alloy/alloy.env`
- **Host labels:** box=`box`, sss=`sss`
- **Deprecated:** Log MCP (github.com/mabi8/log-mcp) — replaced by Grafana

---

## Talvoss Infrastructure

### Cold Email (Instantly.ai)
- **Mailboxes:** Zoho Mail EU across multiple domains
- **Domains:** gotalvoss.com, gotalvoss.de, trytalvoss.com, trytalvoss.de, talvoss-web.com, talvoss-web.de
- **Personas:** Markus Binder, Leopold Neuerburg
- **Accounts:** 4 per domain
- **Domain registrar:** OVH (~33 domains)

### Campaigns
- **Staging:** "NEVER SEND" — `c7cef6c8-bddd-43b0-87a4-b46dd65de8fa`
- **Live:** `2bccfc27-e899-449b-93f7-b734255ba257`

### Lead Pipeline
**Stages:** scored → identified → generating → ready → QA Check → emailed → emailing

- **Frontend:** `talvoss-lead-tinder` on Netlify
- **Daemon:** `tlvss-leadqualifier` at 135.125.179.131
- **Demo site:** demo.talvoss.com
- **Preview URLs:** `https://go.talvoss.com/site/{slug}`

### Target Architecture
- **Hosting:** Hetzner (preferred)
- **Domains:** INWX (preferred registrar)
- **Password manager:** Bitwarden Teams (for Talvoss team)

---

## GitHub

- **mabi8** — Markus personal (mcp-stack, bcl-telegram-claude, log-mcp, dotbrain)
- **tlvss** — Talvoss org (talvoss-worker, talvoss-lead-tinder, tlvss-leadqualifier)
- **canyalaes** — BC Living / Cas Mut properties (kg20, canyala.es)
- **PATs:** ask when needed, tokens not stored

---

## Local Dev Setup

- **Machine:** Windows PC, 13th Gen Intel i7-1370P, 32 GB RAM
- **OS:** WSL2 (Ubuntu 24.04) on Windows
- **IDE:** Cursor (connected to WSL via `anysphere.remote-wsl`)
- **CLI:** Claude Code (latest) in WSL terminal / Cursor integrated terminal
- **Font:** Geist Mono, 15px, line-height 1.6
- **Theme:** Custom warm dark (base `#2b2a27`, accent `#e8956a`)
- **Editor:** vim keybindings (vscodevim), minimap off, breadcrumbs off, word wrap on
- **Central repo:** github.com/mabi8/dotbrain at `~/repos/dotbrain`
- **Git auth:** credential.helper store, user mabi8, email markus.binder@blueoceancapital.de
- **Node:** v22.15, npm 11.12, Python 3.12

### SSH Commands Convention
Always single-line copy-paste:
```bash
su - [user] -c "cd ~/[repo] && git pull && npm run build" && systemctl restart [service]
```
