# Shared Reference Directory

Single source of truth for stable data that spans projects. Read on demand by AI assistants, not loaded every turn.

## Structure
```
reference/
├── company/              # Company-wide facts
│   ├── company.md        # Group structure, entities, key people
│   ├── terminology.md    # Business terms, style rules
│   └── standards.md      # Document formatting, compliance
├── infrastructure.md     # VPS hosts, MCP stack, services, monitoring, local dev
├── working-principles.md # How Markus + Claude collaborate, agentic workflow
└── README.md             # This file
```

## Maintenance
- Update when facts change (people, products, terms)
- Project CLAUDE.md files reference these — never duplicate content
- Add new topic directories as needed (e.g., `personal/`, `financial/`)
