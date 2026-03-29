# Docker Standard for VPS Services

Default setup for containerised services on box.makkib.com or future VPS hosts. Designed for small-scale (1–10 services per host), deployed and managed remotely via Kamal from Claude Code.

---

## Architecture Overview

```
    Claude Code (WSL)
         │
         │  kamal deploy / kamal app logs / kamal rollback
         │  (SSH directly to VPS — no bastion needed)
         ▼
  ┌── VPS (box) ──────────────────────────┐
  │                                        │
  │  kamal-proxy (:80/:443, auto-SSL)      │
  │       │                                │
  │       ├── service-a                    │
  │       ├── service-b                    │
  │       └── service-c                    │
  │                                        │
  │  Alloy → Grafana Cloud                 │
  │    (logs + container metrics)           │
  └────────────────────────────────────────┘
         │
    ghcr.io (GitHub Container Registry)
         │  build local → push → server pulls
```

**No Docker socket exposed over the network.** All management via SSH from local machine. Claude Code's permission prompt is the approval gate.

---

## Prerequisites

Before the first Kamal deploy, verify these on the local machine (WSL) and the target VPS.

### Local (WSL)

```bash
# Docker daemon running (Docker Desktop or docker-ce in WSL)
docker info

# Kamal installed
kamal version

# SSH agent has a key loaded (Kamal uses this to connect to VPS)
ssh-add -l

# Can reach VPS as ops user
ssh ops@178.104.36.179 "whoami"

# Logged into ghcr.io
docker login ghcr.io
```

### VPS (one-time, as root)

```bash
# Create ops user with Docker access
adduser --disabled-password ops
usermod -aG docker ops

# Authorize your SSH key
mkdir -p /home/ops/.ssh
cp ~/.ssh/authorized_keys /home/ops/.ssh/authorized_keys
chown -R ops:ops /home/ops/.ssh
chmod 700 /home/ops/.ssh && chmod 600 /home/ops/.ssh/authorized_keys
```

All Kamal operations run as `ops` — never root. The `ssh_user` setting in `deploy.yml` enforces this.

---

## Kamal

[Kamal](https://kamal-deploy.org/) (v2, from 37signals) deploys Docker containers to VPS via SSH. No daemon on the server, no bastion, no extra infrastructure.

- **kamal-proxy** handles reverse proxy, auto Let's Encrypt SSL, zero-downtime deploys
- Builds locally, pushes to registry, server pulls — no build tooling needed on VPS
- `kamal setup` installs Docker on the server automatically on first run
- Multiple services share one kamal-proxy instance per host

### Install (WSL)

```bash
# Option A: Ruby gem
gem install kamal

# Option B: Docker (no Ruby needed)
docker pull ghcr.io/basecamp/kamal
alias kamal='docker run -it --rm -v "${PWD}:/workdir" -v "${SSH_AUTH_SOCK}:/ssh-agent" -v /var/run/docker.sock:/var/run/docker.sock -e "SSH_AUTH_SOCK=/ssh-agent" ghcr.io/basecamp/kamal'
```

### Key Commands

| Command | What it does |
|---------|-------------|
| `kamal setup` | First deploy: installs Docker, starts kamal-proxy, deploys app |
| `kamal deploy` | Build → push → pull → health check → switch (zero downtime) |
| `kamal redeploy` | Lighter deploy, skips bootstrap and prune |
| `kamal rollback <version>` | Revert to a previous image version |
| `kamal app logs` | Tail app container logs |
| `kamal app exec <cmd>` | Run command inside app container |
| `kamal app details` | Show running containers |
| `kamal audit` | Show deploy audit log from server |
| `kamal server exec "<cmd>"` | Run arbitrary command on server |

---

## Registry: GitHub Container Registry (ghcr.io)

Free for public and private repos under github.com/mabi8 and github.com/tlvss.

### One-time setup

```bash
# Create a PAT with write:packages scope at github.com/settings/tokens
echo "<PAT>" | docker login ghcr.io -u mabi8 --password-stdin
```

Image naming: `ghcr.io/mabi8/<service>` or `ghcr.io/tlvss/<service>`

---

## DNS

Create an A record **before** the first deploy — kamal-proxy needs the hostname to issue a Let's Encrypt certificate.

```
my-service.makkib.com  →  A  →  178.104.36.179
```

**Registrars:** OVH for existing domains, INWX for new domains (see `reference/infrastructure.md`). DNS propagation can take minutes to hours — verify with `dig my-service.makkib.com` before running `kamal setup`.

---

## Secrets Workflow (Agentic)

Claude Code **must never generate, guess, or log secret values**. The workflow:

1. Claude Code creates `.kamal-secrets.example` listing required env vars
2. Claude Code tells Markus which secrets are needed
3. **Markus** creates `.kamal/secrets` with actual values
4. Claude Code proceeds with `kamal setup` / `kamal deploy`

If `.kamal/secrets` is missing or incomplete, Claude Code should stop and ask — never fill in placeholder values.

---

## Standard Service Template

Bootstrap with `kamal init` or copy the template below. `kamal init` generates `config/deploy.yml`, `.kamal/secrets`, and a sample Dockerfile — then adapt to match this standard.

Every Kamal-deployed service follows this layout:

```
my-service/
├── Dockerfile
├── config/
│   └── deploy.yml          # Kamal config
├── .kamal/
│   └── secrets             # Gitignored, actual secret values
├── .kamal-secrets.example  # Checked in, documents required secrets
├── src/
└── ...
```

### config/deploy.yml (template)

```yaml
service: my-service
image: ghcr.io/mabi8/my-service

servers:
  web:
    hosts:
      - 178.104.36.179   # box.makkib.com

ssh:
  user: ops

proxy:
  host: my-service.makkib.com
  app_port: 3000
  ssl: true
  healthcheck:
    path: /up
    interval: 3
    timeout: 5

registry:
  server: ghcr.io
  username: mabi8
  password:
    - KAMAL_REGISTRY_PASSWORD

builder:
  arch:
    - amd64

env:
  clear:
    NODE_ENV: production
  secret:
    - DATABASE_URL

# Optional: accessories (databases, Redis, etc.)
# accessories:
#   db:
#     image: postgres:16-alpine
#     host: 178.104.36.179
#     port: 5432
#     env:
#       secret:
#         - POSTGRES_PASSWORD
#     directories:
#       - data:/var/lib/postgresql/data
```

### .kamal/secrets (template, gitignored)

```bash
KAMAL_REGISTRY_PASSWORD=ghp_xxxxxxxxxxxx
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
```

### Dockerfile (Node.js template)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Health endpoint required.** Your app must respond 200 on `/up` (or whatever `proxy.healthcheck.path` is set to). Kamal won't switch traffic until the health check passes.

---

## New Project Checklist (Greenfield)

Step-by-step for a brand new service, agentic workflow:

1. **Claude Code:** scaffold the project with app code + health endpoint (`GET /up` → 200)
2. **Claude Code:** run `kamal init` in the project root, then adapt `config/deploy.yml` to match the template above (set `ssh.user: ops`, registry, proxy host, etc.)
3. **Claude Code:** create `.kamal-secrets.example` documenting required secrets, add `.kamal/` to `.gitignore`
4. **Claude Code:** create `Dockerfile` (use multi-stage build, run as non-root `app` user)
5. **Claude Code:** test locally — `docker build -t my-service . && docker run -p 3000:3000 my-service` — verify `/up` returns 200
6. **Markus:** create DNS A record → `178.104.36.179` and verify with `dig`
7. **Markus:** create `.kamal/secrets` with actual values (registry PAT, DB credentials, etc.)
8. **Claude Code:** run `kamal setup` (Markus approves the Bash prompt)
9. **Claude Code:** verify — `kamal app logs`, `kamal app details`, check the URL in a browser
10. **Claude Code:** confirm Alloy picks up container logs (check Grafana or `kamal server exec "journalctl -u alloy -n 20"`)

---

## Deploy Flow

### First deploy

```bash
cd ~/repos/my-service
kamal setup
```

This will:
1. SSH into the server as `ops`
2. Install Docker if not present
3. Start kamal-proxy (handles :80/:443 and SSL)
4. Build the Docker image locally
5. Push to ghcr.io
6. Pull on the server
7. Start the container
8. Health check → switch traffic

### Subsequent deploys

```bash
kamal deploy
```

Build → push → pull → health check → zero-downtime switch → prune old containers.

### Claude Code workflow

```
1. Claude writes code, commits
2. Claude runs: kamal deploy
   (Markus approves the Bash permission prompt)
3. Kamal builds, pushes, deploys, health checks
4. Claude runs: kamal app logs   (to verify)
5. If broken: kamal rollback <version>
```

No bastion, no MCP, no custom tooling. SSH + Kamal + Claude Code's permission prompt.

---

## Observability

### Logging

Kamal containers log to Docker's default driver (json-file). Alloy can scrape these directly.

**Add to Alloy config** (`/etc/alloy/config.alloy`):

```hcl
// Docker container logs → Loki
loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.docker.containers.targets
  forward_to = [loki.write.grafana.receiver]
  labels     = { host = "box" }
}

// Docker container discovery
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}
```

**Also keep journald shipping** for kamal-proxy and system-level logs.

**Query in Grafana:**
```logql
{host="box", container=~"my-service.*"}
```

### Container Metrics

```hcl
// Docker container metrics → Prometheus
prometheus.scrape "docker" {
  targets    = discovery.docker.containers.targets
  forward_to = [prometheus.remote_write.grafana.receiver]
}
```

Gives CPU, memory, network, and disk I/O per container without cAdvisor.

### Health check alerting (optional)

kamal-proxy won't route traffic to unhealthy containers. For Grafana alerts on repeated restarts:

```promql
increase(container_restarts_total[5m]) > 2
```

---

## Migration Path: systemd → Kamal

Current services run as systemd units with `git pull && npm run build && systemctl restart`. To migrate a service:

1. Add `Dockerfile` + `config/deploy.yml` + `.kamal/secrets` to the repo
2. Test locally: `docker build -t my-service . && docker run -p 3000:3000 my-service`
3. Run `kamal setup` — deploys alongside the old systemd service (different port)
4. Verify: `kamal app logs`, check Grafana, test the domain
5. Stop old systemd unit: `systemctl disable --now <service>`
6. Point DNS (if needed) to the Kamal-proxied domain
7. Keep systemd unit disabled (not removed) for one week, then clean up

**Migrate one service at a time.**

### Migration order (suggested)

| Order | Service | Why first/last |
|-------|---------|----------------|
| 1 | New service | No migration needed, start fresh with Kamal |
| 2 | tlvss-leadqualifier | Daemon, low traffic, good test candidate |
| 3 | BCL Telegram bot | Stateful (SQLite) — needs volume mount |
| 4 | MCP stack services | Most complex, migrate last |

---

## Multi-Service on One Host

Multiple Kamal-deployed services share one kamal-proxy instance. Each service has its own `config/deploy.yml` with a unique `proxy.host`. kamal-proxy routes by hostname.

```
my-service.makkib.com  →  kamal-proxy  →  my-service container
bot.makkib.com         →  kamal-proxy  →  bcl-telegram container
api.makkib.com         →  kamal-proxy  →  mcp-stack container
```

No extra config needed — kamal-proxy discovers services automatically.

---

## Security Checklist

- [ ] No Docker socket exposed over TCP — all management via SSH
- [ ] Containers run as non-root user (`USER app` in Dockerfile)
- [ ] `.kamal/secrets` gitignored, `.kamal-secrets.example` checked in
- [ ] Health endpoint implemented and tested
- [ ] Registry is private (ghcr.io default is public — check settings)
- [ ] iptables rules unchanged — kamal-proxy binds 80/443, already allowed
- [ ] Kamal connects as `ops` user (`ssh.user: ops` in deploy.yml), never root
- [ ] SSH key auth only, no password auth on VPS
- [ ] Alloy has Docker discovery enabled for container logs + metrics

---

## Quick Reference

```bash
# Deploy
kamal deploy

# Check status
kamal app details
kamal app logs

# Rollback
kamal rollback <version>

# Run command on server
kamal server exec "docker stats --no-stream"

# Run command in app container
kamal app exec "node -e 'console.log(process.env.NODE_ENV)'"

# Full audit trail
kamal audit
```
