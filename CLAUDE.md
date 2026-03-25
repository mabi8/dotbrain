# dotbrain

Central repository for CLAUDE.md templates, .cursorrules templates, and shared reference data. Designed to be symlinked into project repos.

## Structure

```
templates/           # Seed files for new projects (symlink targets)
  CLAUDE.md.*        # CLAUDE.md templates by project type
  cursorrules.*      # .cursorrules templates by project type
reference/           # Shared context data (read on demand)
  company/           # Company-wide facts
scripts/
  link.sh            # Symlink helper
```

## Usage

To set up a new project:
```bash
./scripts/link.sh ~/repos/<project> software   # or corporate
```

This symlinks `CLAUDE.md` and `.cursorrules` from the appropriate templates into the target project. Fill in the `<PLACEHOLDERS>` after linking.

## Conventions

- Templates use `<PLACEHOLDER>` markers for project-specific values
- Reference files are the single source of truth — project files reference them, never duplicate
- All paths assume dotbrain lives at `~/repos/dotbrain/`
