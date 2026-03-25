# Claude Code Setup Guide

Complete reference for how Claude Code is configured, where files live, what tools are available, and how to create and manage projects.

---

## 1. Architecture Overview

```
~/.claude/                          # Global Claude Code configuration
├── CLAUDE.md                       # Global instructions (loaded every turn, all projects)
├── settings.json                   # Enabled plugins
├── settings.local.json             # Global permission overrides
├── keybindings.json                # Keyboard shortcuts
├── templates/                      # Project seed templates (git repo)
│   ├── CLAUDE.md.init.md           # Master setup guide with questionnaire
│   ├── CLAUDE.md.draft.corporate   # Corporate project seed
│   ├── CLAUDE.md.draft.software    # Software project seed
│   └── PROJECT_GUIDE.md.draft.corporate  # Corporate detailed specs seed
├── skills/                         # Custom skills (git repo)
│   ├── verify/SKILL.md             # /verify — document verification
│   ├── asx-release-crosscheck/SKILL.md  # /asx-release-crosscheck — figure matching
│   ├── contract-review → ...       # Symlinked installed skills
│   ├── find-skills → ...
│   ├── legal-document-analyzer → ...
│   └── skill-creator → ...
└── projects/                       # Per-project memory and session history
    └── -Users-lachlan/memory/      # Global memory (loaded when working from ~/)
        ├── MEMORY.md               # Index (always loaded, max 200 lines)
        ├── corporate.md            # Carma context, reporting patterns
        ├── project-setup.md        # Folder structure, naming, templates
        ├── tools-and-stack.md      # Tech stack, MCP servers, skills
        └── personal.md             # Personal project patterns

~/Projects/                         # All project directories
├── reference/                      # Shared reference data (read on demand)
│   ├── carma/                      # Company-wide facts
│   │   ├── company.md              # Board, management, products, partnerships
│   │   ├── terminology.md          # Business terms, style rules
│   │   ├── standards.md            # Document formatting, compliance, error patterns
│   │   └── financials/             # Period-specific metrics
│   │       └── h1-fy26.md          # H1 FY26 key figures
│   └── personal/                   # Personal project reference
│       ├── nrma-claim.md           # Claim numbers, dates, contacts
│       └── pearce-street.md        # Property, builder, scope details
├── YY-MM <Project Name>/           # Individual projects
│   ├── CLAUDE.md                   # Project instructions (loaded every turn)
│   ├── PROJECT_GUIDE.md            # Detailed specs (read on demand)
│   ├── tasks/
│   │   ├── todo.md                 # Deliverable checklist
│   │   └── lessons.md              # Corrections from prior sessions
│   ├── source/                     # Read-only reference materials
│   ├── drafts/                     # Working documents
│   ├── output/                     # Generated artifacts (gitignored)
│   ├── scripts/                    # Python processing
│   └── reference/                  # Project-specific registry files
└── .claude/settings.local.json     # Projects-level permissions
```

---

## 2. Context Loading — What Claude Sees Each Turn

Understanding what loads automatically vs. on demand is key to performance.

### Loaded every turn (always in context)
| Source | Scope | Location |
|--------|-------|----------|
| Global CLAUDE.md | All projects | `~/.claude/CLAUDE.md` |
| Global MEMORY.md | When working from ~/ | `~/.claude/projects/-Users-lachlan/memory/MEMORY.md` |
| Project CLAUDE.md | When in a project | `<project>/CLAUDE.md` |
| Project memory MEMORY.md | When in a project | `~/.claude/projects/<project-path>/memory/MEMORY.md` |

### Read on demand (only when Claude reads them)
| Source | Purpose | Location |
|--------|---------|----------|
| PROJECT_GUIDE.md | Detailed deliverable specs | `<project>/PROJECT_GUIDE.md` |
| Shared reference | Company facts, standards, financials | `~/Projects/reference/` |
| tasks/lessons.md | Prior corrections | `<project>/tasks/lessons.md` |
| Topic memory files | corporate.md, tools-and-stack.md, etc. | `~/.claude/projects/.../memory/*.md` |

### Design principle
Keep always-loaded files compact. Move stable, unchanging content (terminology, standards, compliance rules) to the shared reference directory where it's read once per session rather than loaded every turn.

---

## 3. Global Configuration

### `~/.claude/CLAUDE.md` — Global Instructions
Domain-neutral rules that apply to all projects:
- **Working style**: Plan-first, autonomous investigation, concise output, no emojis, use subagents
- **Quality**: Simplicity over elegance, root causes, minimal scope
- **Verification**: Never mark tasks complete without proving they work
- **Planning**: Write plans to `tasks/todo.md`, check in before non-trivial work
- **Self-improvement**: Update `tasks/lessons.md` after corrections
- **Git**: Never commit without being asked, atomic commits

### `~/.claude/settings.json` — Enabled Plugins
10 plugins active: skill-creator, claude-md-management, context7, claude-code-setup, commit-commands, github, slack, security-guidance, code-simplifier, playwright.

### `~/.claude/settings.local.json` — Global Permissions
Auto-allowed: Tana MCP (search, read, calendar, tag schema, import).

### `~/Projects/.claude/settings.local.json` — Projects-Level Permissions
Auto-allowed: `python3`, Backblaze web fetch, Playwright navigation.

### Per-Project Permissions
Each project can have its own `.claude/settings.local.json` for project-specific permissions (e.g., Gmail access for NRMA Insurance, Supabase access for Automated Costing).

---

## 4. Memory System

### Global Memory (`~/.claude/projects/-Users-lachlan/memory/`)
Active when working from the home directory. Five files:

| File | Contents |
|------|----------|
| `MEMORY.md` | Index with user profile, topic file pointers, quick reference |
| `corporate.md` | Carma context, ASX reporting patterns, verification workflow |
| `project-setup.md` | Folder structure, naming conventions, template locations |
| `tools-and-stack.md` | MCP servers, custom skills, tech stack, workflow patterns |
| `personal.md` | Personal project patterns, pointers to shared reference |

### Project Memory
Created automatically by Claude Code at `~/.claude/projects/<project-path>/memory/` when project-specific patterns emerge. Currently active for:
- **26-03 March Board** — co-founders report workflow, data dependencies
- **26-03 AI Buying CX** — architecture decisions, Snowflake/HubSpot schemas
- **26-02 Automated Costing** — Valuation Adjustments system architecture

### When to create project memory
- Multi-step workflows refined over iterations
- Architecture decisions with rationale
- Data source schemas and access patterns
- NOT for one-off corrections (those go in `tasks/lessons.md`)

---

## 5. Shared Reference Directory

`~/Projects/reference/` — single source of truth for stable data that spans projects.

### Carma (`~/Projects/reference/carma/`)

| File | Contents |
|------|----------|
| `company.md` | Board of directors, management team (names, roles, data responsibilities), business lines, products, key partnerships, escrow arrangements, strategic initiatives |
| `terminology.md` | Business terms (STC, IRC, GPU, PCP, etc.), style rules |
| `standards.md` | Voice & formatting rules, non-IFRS requirements, compliance notes, common error patterns |
| `financials/h1-fy26.md` | H1 FY26 income statement, operational metrics, Q2 breakdown, Prospectus forecasts |

### Personal (`~/Projects/reference/personal/`)

| File | Contents |
|------|----------|
| `nrma-claim.md` | Claim/policy/complaint numbers, incident date, property address, email accounts |
| `pearce-street.md` | Property address, builder quote details, scope gaps, deliverable list |

### Maintenance
- Update `company.md` when board/management changes occur
- Add new `financials/<period>.md` files each reporting cycle
- Update `terminology.md` when new business terms are established
- These files are the source — project CLAUDE.md files reference them, not duplicate them

---

## 6. Tools & Integrations

### MCP Servers

| Server | Purpose | Access |
|--------|---------|--------|
| tana-local | Outliner/knowledge base (localhost:8262) | Search, read, calendar, tag schema, import (auto-allowed) |
| google | Drive, Gmail, Calendar, Sheets, Slides, Docs | Per-project permissions |
| Claude.ai MCP | Gmail and Google Calendar (cloud) | Per-project permissions |

### Custom Skills

| Skill | Command | Purpose |
|-------|---------|---------|
| Verify | `/verify` | 9-step formal verification of material statements per ASX CGC Rec 4.3. Produces markdown checklists + optional XLSX + visual cross-reference reports |
| ASX Release Crosscheck | `/asx-release-crosscheck` | Cross-document figure consistency. Produces XLSX workbook with one tab per document + Issues tab |
| Contract Review | `/contract-review` | Contract analysis against negotiation playbook |
| Legal Document Analyzer | `/legal-document-analyzer` | Legal doc parsing and risk identification |
| Find Skills | `/find-skills` | Discover installable skills |
| Skill Creator | `/skill-creator` | Create and modify custom skills |

Skills are stored at `~/.claude/skills/` (git-tracked for custom, symlinked for installed).

### Installed Plugins

| Plugin | Purpose |
|--------|---------|
| context7 | Query up-to-date programming documentation |
| commit-commands | Git commit, push, PR workflows |
| github | GitHub integration |
| slack | Slack messaging and search |
| playwright | Browser automation |
| claude-md-management | CLAUDE.md file management |
| claude-code-setup | Automation recommender |
| code-simplifier | Code simplification |
| security-guidance | Security guidance |
| skill-creator | Create custom skills |

### Tech Stack

| Tool | Purpose |
|------|---------|
| Pandoc | Markdown to/from DOCX conversion |
| Python 3 + openpyxl | Excel generation and data processing |
| pymupdf | PDF image extraction for visual verification |
| marimo | Interactive notebooks (not Jupyter) |
| Git | Version control on all projects |
| macOS / zsh / Homebrew | Platform |

---

## 7. Creating a New Project

Full process documented in `~/.claude/templates/CLAUDE.md.init.md`. Summary:

### Quick start — Corporate

```bash
cd ~/Projects
mkdir "YY-MM <Project Name>"
cd "YY-MM <Project Name>"
git init
cp ~/.claude/templates/CLAUDE.md.draft.corporate CLAUDE.md
cp ~/.claude/templates/PROJECT_GUIDE.md.draft.corporate PROJECT_GUIDE.md
mkdir -p source drafts tasks
touch tasks/todo.md tasks/lessons.md
```

Then:
1. Fill in CLAUDE.md Orientation section (compact — key dates, deliverables table)
2. Delete unused sections (Drafting Approach or Review Approach)
3. Fill in PROJECT_GUIDE.md (reference `~/Projects/reference/carma/` for standard company data)
4. Populate `source/` with reference materials
5. Set up `tasks/todo.md` with deliverable checklist
6. `git add CLAUDE.md PROJECT_GUIDE.md tasks/ && git commit -m "Project setup"`

### Quick start — Software

```bash
cd ~/Projects
mkdir "YY-MM <Project Name>"
cd "YY-MM <Project Name>"
git init
cp ~/.claude/templates/CLAUDE.md.draft.software CLAUDE.md
mkdir -p tasks
touch tasks/todo.md tasks/lessons.md
```

Then:
1. Fill in CLAUDE.md Orientation section
2. Fill in Project Details (tech stack, build commands, key paths)
3. Fill in Architecture section
4. Set up `tasks/todo.md`

### Naming convention
`YY-MM <Descriptive Name>` — YY-MM of the primary deadline, space-separated, title case.
Examples: `26-02 H1 FY26 February Board`, `26-03 AI Buying CX`, `26-03 Pearce Street Renovations`.

### Starting a session
1. CLAUDE.md loads automatically (orientation + reference pointers)
2. Read `tasks/lessons.md` for prior corrections
3. Read relevant section of `PROJECT_GUIDE.md` for the current deliverable
4. Read shared reference files from `~/Projects/reference/` as needed
5. Pick up the next deliverable from `tasks/todo.md`

---

## 8. Project Lifecycle

### During work
- Track deliverables in `tasks/todo.md` — check items off as completed
- Record corrections in `tasks/lessons.md` — Claude does this automatically after being corrected
- Source materials are read-only in `source/`
- Working documents in `drafts/`, one file per deliverable
- Generated output in `output/` (gitignored)

### Cross-project consistency
- Shared financial figures must match across all deliverables in a release cycle
- One deliverable is nominated as the authoritative source (noted in CLAUDE.md Orientation)
- When updating a shared figure, grep `drafts/` for the same figure and update all instances

### Verification workflow (corporate)
1. Draft deliverables using `/verify` or `/asx-release-crosscheck` skills
2. Skills produce structured outputs (markdown checklists, XLSX workbooks)
3. Issues are categorised by severity: CRITICAL, HIGH, MEDIUM, LOW
4. Iterate until all critical/high issues are resolved

### Closing a project
- Ensure all `tasks/todo.md` items are checked
- Final git commit
- Project directory remains in `~/Projects/` for reference by future projects

---

## 9. File Locations — Quick Reference

### Configuration
| What | Where |
|------|-------|
| Global instructions | `~/.claude/CLAUDE.md` |
| Plugin settings | `~/.claude/settings.json` |
| Global permissions | `~/.claude/settings.local.json` |
| Keyboard shortcuts | `~/.claude/keybindings.json` |
| Projects-level permissions | `~/Projects/.claude/settings.local.json` |

### Templates
| What | Where |
|------|-------|
| Setup guide | `~/.claude/templates/CLAUDE.md.init.md` |
| Corporate CLAUDE.md seed | `~/.claude/templates/CLAUDE.md.draft.corporate` |
| Software CLAUDE.md seed | `~/.claude/templates/CLAUDE.md.draft.software` |
| Corporate PROJECT_GUIDE seed | `~/.claude/templates/PROJECT_GUIDE.md.draft.corporate` |

### Shared Reference
| What | Where |
|------|-------|
| Company facts | `~/Projects/reference/carma/company.md` |
| Business terms | `~/Projects/reference/carma/terminology.md` |
| Document standards | `~/Projects/reference/carma/standards.md` |
| Financial metrics | `~/Projects/reference/carma/financials/*.md` |
| Personal (NRMA) | `~/Projects/reference/personal/nrma-claim.md` |
| Personal (Pearce St) | `~/Projects/reference/personal/pearce-street.md` |

### Skills
| What | Where |
|------|-------|
| /verify | `~/.claude/skills/verify/SKILL.md` |
| /asx-release-crosscheck | `~/.claude/skills/asx-release-crosscheck/SKILL.md` |
| Verification lessons | `~/.claude/projects/-Users-lachlan-Projects/memory/verification_skills.md` |

### Memory
| What | Where |
|------|-------|
| Global memory index | `~/.claude/projects/-Users-lachlan/memory/MEMORY.md` |
| Global topic files | `~/.claude/projects/-Users-lachlan/memory/*.md` |
| Projects-level memory | `~/.claude/projects/-Users-lachlan-Projects/memory/MEMORY.md` |
| Project-specific memory | `~/.claude/projects/-Users-lachlan-Projects-<name>/memory/` |
