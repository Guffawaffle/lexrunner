<<<<<<< HEAD
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
||||||| 0c946b1
=======
# Tracked Profile Example (.smartergpt)

This directory demonstrates the structure and contents of a tracked profile.

## Purpose

The tracked profile (`.smartergpt/`) serves as:
- **Repository default configuration** - Provides working defaults for all users
- **Team canonical example** - Documents team conventions and standards
- **Read-only reference** - Should not be written to by the runner (role: example)

## Structure

```
.smartergpt/
├── intent.md                         # Project goals and scope
├── scope.yml                         # PR discovery rules
├── deps.yml                          # Dependency relationships
├── gates.yml                         # Quality gates
├── stack.yml                         # PR ordering
├── merge-policy.yml                  # Merge rules
├── pull-request-template.md          # PR template
├── allowed-commands.json             # Security policy
├── prompts/                          # Canonical prompts
│   ├── create-project.md
│   └── idea.md
├── schemas/                          # JSON schemas (optional)
├── runner/                           # Working directory (gitignored!)
│   ├── plan.json
│   └── cache/
└── deliverables/                     # May track example outputs
```

## Configuration Files

All configuration files are at the **profile root**, not in a subdirectory.

### profile.yml (Optional)

```yaml
# Optional for tracked profile (defaults to role: example)
role: example
name: lex-pr-runner
version: 1.0.0
projectType: typescript
description: Example tracked profile for lex-pr-runner
```

### intent.md

```markdown
# Project Intent

## Goals
- Implement merge-weave functionality
- Support dependency-aware PR merging
- Provide quality gates framework

## Success Criteria
- All tests pass
- TypeScript compilation succeeds
- Documentation is up-to-date
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
    - "work-in-progress"
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

### gates.yml

```yaml
version: 1
gates:
  - name: typecheck
    run: npm run typecheck
    runtime: local
  - name: test
    run: npm test
    runtime: local
  - name: lint
    run: npm run lint
    runtime: local
```

### deps.yml

```yaml
# Explicit dependency declarations
# Augments auto-discovered dependencies
version: 1
dependencies: {}
```

### stack.yml

```yaml
# PR stack configuration
version: 1
stacks: []
```

### merge-policy.yml

```yaml
# Merge policies and rules
version: 1
policies:
  - name: require-ci
    type: status
    required_statuses:
      - "CI / build"
      - "CI / test"
```

### Prompts

See actual `.smartergpt/prompts/` directory in this repository for canonical examples.

## Working Directory

The `runner/` directory should be **gitignored** even in tracked profiles:

```gitignore
.smartergpt/runner/
.smartergpt/cache/
```

This prevents accidental commits of generated artifacts.

## Write Protection

The tracked profile has `role: example` (implicit or explicit in profile.yml), which means:
- ❌ Runner refuses to write artifacts (deliverables, logs, etc.)
- ✅ Config files can be manually edited and committed
- ✅ Serves as team default and documentation

To work with write operations, use `.smartergpt.local/` instead:

```bash
lex-pr init-local
```

## Customization

Don't modify the tracked profile directly for local development. Instead:

1. **Initialize local profile:**
   ```bash
   lex-pr init-local
   ```

2. **Override specific files in `.smartergpt.local/`:**
   ```bash
   cp .smartergpt/scope.yml .smartergpt.local/
   vim .smartergpt.local/scope.yml
   ```

3. **Runner automatically uses local overrides:**
   ```bash
   lex-pr plan --from-github
   # Uses .smartergpt.local/scope.yml if it exists
   ```

## Related Documentation

- [SmartGPT Structure v1 Spec](../../../docs/specs/smartergpt-structure-v1.md)
- [Profile Setup Guide](../README.md)
- [Profile Resolution](../../../docs/profile-resolution.md)
>>>>>>> pr-395
