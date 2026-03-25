# dotbrain

Central repo for AI coding assistant configuration. Symlink templates into project repos so every project gets consistent CLAUDE.md and .cursorrules files.

## Quick start

```bash
# New software project
mkdir ~/repos/myapp && cd ~/repos/myapp && git init
~/repos/dotbrain/scripts/link.sh ~/repos/myapp software

# New corporate/document project
mkdir ~/repos/board-report && cd ~/repos/board-report && git init
~/repos/dotbrain/scripts/link.sh ~/repos/board-report corporate
```

Then fill in the `<PLACEHOLDERS>` in the linked files.

## What's inside

| Directory | Purpose |
|-----------|---------|
| `templates/` | CLAUDE.md and .cursorrules seed files by project type |
| `reference/` | Shared company context, terminology, standards |
| `scripts/` | `link.sh` — symlink helper |

## Templates

| Type | CLAUDE.md | .cursorrules |
|------|-----------|-------------|
| `software` | Dev projects — stack, build commands, architecture | Code style, conventions, commands |
| `corporate` | Document projects — deliverables, voice, review workflow | Writing style, quality checks, references |

## Adding a new template type

1. Create `templates/CLAUDE.md.<type>` and `templates/cursorrules.<type>`
2. Add the type to the case check in `scripts/link.sh`
