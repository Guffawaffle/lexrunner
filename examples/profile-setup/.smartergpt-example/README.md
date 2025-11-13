# Example Tracked Profile Structure

This directory demonstrates a typical tracked profile (`.smartergpt/`) for a repository.

## Purpose

The tracked profile serves as:
- **Example configuration** for repository contributors
- **Default fallback** when no local profile exists
- **Documentation** of project standards

## Key Characteristics

- **Read-only role**: `role: example` (if profile.yml existed)
- **Tracked in git**: All files committed to repository
- **No working artifacts**: `runner/`, `cache/`, `deliverables/` are gitignored

## Structure

```
.smartergpt/
├── intent.md                         # Example project intent
├── scope.yml                         # Example PR discovery
├── deps.yml                          # Example dependencies
├── gates.yml                         # Example quality gates
├── stack.yml                         # Example stack ordering
├── merge-policy.yml                  # Example merge rules
├── pull-request-template.md          # PR template
├── allowed-commands.json             # Security policy
├── prompts/                          # Canon prompts
│   ├── create-project.md
│   └── idea.md
└── schemas/                          # JSON schemas
    ├── profile.schema.json
    ├── gates.schema.json
    ├── runner.stack.schema.json
    └── runner.scope.schema.json
```

## Configuration Files

### intent.md

```markdown
# Project Intent

## Goals
- Automate PR merge workflows
- Manage dependency-ordered merges
- Run quality gates uniformly

## Success Criteria
- All tests pass
- Type checking clean
- Lint warnings addressed
- Documentation updated
```

### scope.yml

```yaml
version: 1
target: main
sources:
  - query: "is:pr is:open"
selectors:
  include_labels:
    - "ready-to-merge"
    - "stack:*"
  exclude_labels:
    - "do-not-merge"
    - "wip"
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

### gates.yml

```yaml
version: 1
gates:
  - name: lint
    run: npm run lint
    runtime: local
    required: true

  - name: typecheck
    run: npm run typecheck
    runtime: local
    required: true

  - name: test
    run: npm test
    runtime: local
    required: true
```

## Prompts

Canonical prompts live in `prompts/` directory:

- `create-project.md` - Project creation prompt
- `idea.md` - Idea development prompt

These prompts use token expansion:
- `{{today}}` - Current date
- `{{repo_root}}` - Repository root
- `{{branch}}` - Current branch

## Schemas

JSON schemas for validation:

- `profile.schema.json` - Profile metadata
- `gates.schema.json` - Gates configuration
- `runner.stack.schema.json` - Stack file
- `runner.scope.schema.json` - Scope file

## Usage

### For Contributors

```bash
# Reference example config
cat .smartergpt/intent.md
cat .smartergpt/scope.yml

# Copy to local profile for customization
cp .smartergpt/gates.yml .smartergpt.local/
vim .smartergpt.local/gates.yml
```

### For Maintainers

```bash
# Update tracked examples
vim .smartergpt/gates.yml
git add .smartergpt/gates.yml
git commit -m "docs: Update example gates configuration"
```

## Notes

- **Never commit** `.smartergpt.local/` - that's for local development only
- **Do gitignore** `.smartergpt/runner/`, `.smartergpt/cache/`, `.smartergpt/deliverables/`
- **Do track** all config files and schemas
- **Do document** any project-specific conventions in `intent.md`
