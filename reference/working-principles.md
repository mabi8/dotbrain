# Working Principles

How Markus and Claude collaborate. Optimised for speed, autonomy, and agentic workflows.

---

## Roles

- **Markus** — product owner and architect. Describes intent in natural language. Does not read or write code. Reviews summaries, not diffs.
- **Claude** — engineer. Plans, builds, tests, commits, deploys. Operates autonomously within approved scope.

## Workflow

```
Markus describes intent
  → Claude plans (propose approach, get thumbs-up)
  → Claude builds (code, test, commit — no approval per file)
  → Claude summarises ("what changed and why", not diffs)
  → Markus provides PAT / deploy command if needed
  → Claude verifies via logs or test output
```

Keep the loop tight. Don't ask permission for things already approved in the plan.

---

## Claude Code Speed Principles

### Parallelise everything
- Launch independent subagents concurrently (research, tests, builds)
- Make multiple tool calls in a single response when there are no dependencies
- Use `run_in_background` for long-running commands you don't need immediately

### Minimise round-trips
- Read multiple files in one message, not one at a time
- Glob/Grep before asking Markus where something is
- Batch related edits into one response rather than edit-confirm-edit cycles
- When a plan is approved, execute it fully — don't pause after each step

### Use the right tool
- `Glob` for finding files by name, not `find` in Bash
- `Grep` for searching content, not `grep`/`rg` in Bash
- `Read` for file contents, not `cat`/`head`/`tail`
- `Edit` for surgical changes, `Write` only for new files or full rewrites
- `Agent` (Explore) for broad codebase research that needs >3 queries
- `Agent` (general-purpose) for complex multi-step tasks that benefit from isolation

### Commit discipline
- Never commit unless Markus asks
- Atomic commits — one logical change per commit
- Present changes as "what changed and why" summaries
- Always iptables, never ufw, on all VPS

### Context management
- Keep CLAUDE.md files compact — they load every turn
- Push stable reference data to `~/repos/dotbrain/reference/` (read on demand)
- Use project memory for multi-session patterns, `tasks/lessons.md` for corrections

---

## Cursor + WSL Integration

### Environment
- Cursor runs on Windows, connects to WSL2 Ubuntu via `anysphere.remote-wsl`
- Claude Code runs inside WSL terminal (Cursor panel or standalone)
- All repos live in WSL filesystem (`~/repos/`) — never `/mnt/c/` for perf
- Git credentials stored in WSL (`credential.helper store`)

### File access
- Claude Code sees the WSL filesystem natively
- Windows paths (`C:\Users\...`) are at `/mnt/c/Users/...` but avoid for project files
- Cursor settings live on Windows side: `/mnt/c/Users/49172/AppData/Roaming/Cursor/User/settings.json`

### Terminal
- Cursor's integrated terminal runs in WSL by default (`terminal.integrated.defaultProfile.linux: bash`)
- Claude Code in the Cursor panel has the same WSL access as a standalone terminal

---

## Deployment Pattern

### VPS deploys (via SSH or SSS MCP)
1. Push to GitHub from local
2. SSH into VPS (or use SSS MCP `deploy_service` tool)
3. `git pull && npm run build && systemctl restart <service>`
4. Verify via `journalctl -u <service> -n 20` or Grafana logs

### Netlify deploys
- Push to main triggers auto-deploy
- Check status via Netlify MCP or dashboard

### Safety
- Approval-gated execution for destructive actions
- Always verify via logs after deploy
- iptables only, never ufw
