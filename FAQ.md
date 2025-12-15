# FAQ — lexrunner

Quick answers to common questions. See `docs/README.md` for the full documentation index.

## What is lexrunner?

A deterministic CLI that fans out tasks as many PRs, computes a merge pyramid (dependency order), runs gates uniformly (lint/type/test/etc.), and merges cleanly.

## Where does the runner read inputs from?

At integration time, only from a single frozen `plan.json` (Schema v1). See `docs/schemas.md` and `src/schema.ts`.

## What's the difference between `src/**` and `.smartergpt/**`?

- `src/**`: Core runner (stateless, packageable). Never stores user/work artifacts.
- `.smartergpt/**`: Portable example profile for humans/agents. Not read at runtime by the runner.

## What's the difference between `.smartergpt/` and `.smartergpt.local/`?

- **`.smartergpt/`**: Tracked example profile (role: example)
  - Provides team defaults and documentation
  - Read-only (runner refuses to write artifacts)
  - Tracked in git
  - Contains canonical prompts in `prompts/` subdirectory

- **`.smartergpt.local/`**: Local development profile (role: development)
  - Personal/project-specific customizations
  - Read-write (runner can write artifacts)
  - Gitignored
  - Overrides tracked profile on file-by-file basis
  - Can have custom prompts in `prompts/` subdirectory

See [Profile Resolution](./docs/profile-resolution.md) and [SmartGPT Structure v1 Spec](./docs/specs/smartergpt-structure-v1.md) for details.

## Why are config files at the profile root instead of in a `runner/` subdirectory?

**Actual structure:**
```
.smartergpt/
├── intent.md              # ✅ Config at root
├── scope.yml              # ✅ Config at root
├── gates.yml              # ✅ Config at root
└── runner/                # ✅ Working artifacts only
    ├── plan.json
    └── cache/
```

**Reason:** The `runner/` directory is for **working artifacts only** (plan.json, cache, logs), not configuration. Config files are at the profile root for simpler access and consistency. The `runner/` directory is gitignored to prevent commits of generated content.

## What's in the `runner/` directory?

The `runner/` directory contains **working artifacts only**:
- `plan.json` - Generated execution plan
- `snapshot.md` - Current state snapshot
- `cache/` - Ephemeral cache data
- `logs/` - Execution logs
- `bin/` - Temporary binaries
- `wt/` - Work tree

**Important:** Config files (intent.md, scope.yml, etc.) are NOT in `runner/`. They're at the profile root.

The entire `runner/` directory should be gitignored.

## How do prompts work? What's the precedence?

Prompts are template files used for plan generation with token expansion (`{{today}}`, `{{branch}}`, etc.).

**Precedence chain** (highest to lowest):
1. **`LEX_PROMPTS_DIR`** environment variable - Explicit override for cross-repo usage
2. **`.smartergpt.local/prompts/`** - Local overlay (not tracked)
3. **`.smartergpt/prompts/`** - Tracked canonical prompts

**Example:**
```bash
# Use Lex prompts from another repo
export LEX_PROMPTS_DIR=/path/to/lex/.smartergpt/prompts
lex-pr plan --from-github
```

See [Prompts Configuration](./docs/prompts.md) for complete documentation.

## How do I share prompts across multiple repositories?

Three methods:

**1. Environment Variable (Recommended for CI/CD)**
```bash
export LEX_PROMPTS_DIR=/path/to/shared/prompts
```

**2. Symlink (Recommended for Development)**
```bash
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
```

**3. Copy (Recommended for Customization)**
```bash
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

See [examples/profile-setup/cross-repo-prompts/](./examples/profile-setup/cross-repo-prompts/) for detailed guide.

## What tokens are supported in prompts?

| Token | Description | Example Output |
|-------|-------------|----------------|
| `{{today}}` | Current date (YYYY-MM-DD) | `2025-11-13` |
| `{{now}}` | ISO timestamp without colons | `2025-11-13T14-30-45-123` |
| `{{repo_root}}` | Git repository root path | `/path/to/repo` |
| `{{workspace_root}}` | Workspace root path | `/path/to/workspace` |
| `{{branch}}` | Current git branch | `main` |
| `{{commit}}` | Current commit SHA | `a1b2c3d4...` |

**Example:**
```markdown
# Report for {{branch}} - {{today}}
Repository: {{repo_root}}
```

See [Prompts Configuration](./docs/prompts.md) for details.

## Where do deliverables go?

Deliverables placement depends on the profile:

- **`.smartergpt/deliverables/`**: May be tracked for example outputs (use sparingly)
- **`.smartergpt.local/deliverables/`**: Always gitignored, contains timestamped deliverable sets

Deliverables include:
- `analysis.json` - Structured merge analysis
- `weave-report.md` - Human-readable report
- `execution-log.md` - Tracking template

See [Deliverables Management](./docs/deliverables-management.md) for details.

## How do I migrate from an old structure where config was in `runner/`?

**Old (incorrect):**
```
.smartergpt/
└── runner/
    ├── intent.md          # ❌ Config in subdirectory
    ├── scope.yml
    └── gates.yml
```

**New (correct):**
```
.smartergpt/
├── intent.md              # ✅ Config at root
├── scope.yml
├── gates.yml
└── runner/                # ✅ Working artifacts only
    ├── plan.json
    └── cache/
```

**Migration steps:**
```bash
cd .smartergpt
mv runner/intent.md .
mv runner/scope.yml .
mv runner/gates.yml .
mv runner/deps.yml .
# Move other config files as needed
```

See [SmartGPT Structure v1 Spec - Migration Guide](./docs/specs/smartergpt-structure-v1.md#migration-guide) for complete instructions.

## How do I generate a plan?

Use GitHub discovery and plan commands:
- `npm run cli -- discover --json`
- `npm run cli -- plan --from-github --json > plan.json`

## How do I run gates locally and in CI?

`npm run cli -- execute plan.json` — the same semantics apply in both places. See `docs/cli.md` and `docs/gate-report-examples.md`.

## Are outputs deterministic?

Yes. We sort items and keys for stable diffs. The determinism check is described in `AGENTS.md`.

## How do I scan for secrets or vulnerabilities?

Security subcommands:
- `lex-pr security scan-plan plan.json`
- `lex-pr security check-rotation GITHUB_TOKEN --max-age 90`
- `lex-pr security validate-secrets GITHUB_TOKEN DATABASE_URL`

See `docs/SECURITY_IMPLEMENTATION.md`.

## Do you support SARIF ingestion for a vulnerability gate?

The security scanning service is present (`src/security/scanning.ts`) and a SARIF-backed "vuln" gate is on the roadmap (Issue #129). Until then, you can run npm audit locally and enforce thresholds via policy.

## How do I contribute?

See `CONTRIBUTING.md`. Keep PRs small and deterministic. Include a "How to verify" section.

## Why are config files at profile root instead of in `runner/`?

Config files (`intent.md`, `scope.yml`, `gates.yml`, etc.) define runner behavior and live at the **profile root** for easy access. The `runner/` directory is reserved for **working artifacts** (plan.json, cache, logs) generated during execution.

**Structure:**
```
.smartergpt.local/
├── intent.md              # Config at root
├── scope.yml              # Config at root
├── gates.yml              # Config at root
└── runner/                # Working artifacts only
    ├── plan.json
    ├── cache/
    └── logs/
```

## What's the difference between `.smartergpt/` and `.smartergpt.local/`?

- **`.smartergpt/`**: Tracked example profile (read-only). Contains canonical config and prompts for the repository.
- **`.smartergpt.local/`**: Local development profile (gitignored). Your working copy where you customize config and the runner writes artifacts.

**Profile precedence:** `.smartergpt.local/` files override `.smartergpt/` files.

## How do prompts work? Can I share prompts across repositories?

Yes! Prompts use a three-level precedence chain:

1. **`LEX_PROMPTS_DIR` env variable** - Cross-repository override
2. **`.smartergpt.local/prompts/`** - Local prompt overlay
3. **`.smartergpt/prompts/`** - Tracked canonical prompts

**Cross-repo usage example:**
```bash
# Point LexRunner to Lex prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr plan --from-github
```

**See:** `docs/prompts.md` for comprehensive guide including token expansion (`{{today}}`, `{{branch}}`, etc.) and usage patterns.

## What tokens can I use in prompts?

Prompts support dynamic token expansion:

| Token | Expands To | Example |
|-------|------------|---------|
| `{{today}}` | YYYY-MM-DD | `2025-11-13` |
| `{{now}}` | ISO timestamp | `2025-11-13T14-30-45` |
| `{{repo_root}}` | Repo path | `/path/to/repo` |
| `{{branch}}` | Current branch | `main` |
| `{{commit}}` | Commit SHA | `a1b2c3d4...` |

**See:** `docs/prompts.md` for complete token reference.

## Why does `.smartergpt/` have a `deliverables/` directory?

This is legacy from early development. In practice:
- **Tracked profiles** (`role: example`) should NOT write deliverables
- **Local profiles** (`role: development`) write to `.smartergpt.local/deliverables/`

The runner enforces write protection based on profile role.

## How do I migrate from an old structure with config in `runner/`?

1. Run `lex-pr doctor` to check current structure
2. Move config files from `runner/` to profile root:
   ```bash
   mv .smartergpt.local/runner/intent.md .smartergpt.local/
   mv .smartergpt.local/runner/scope.yml .smartergpt.local/
   mv .smartergpt.local/runner/gates.yml .smartergpt.local/
   ```
3. Verify with `lex-pr doctor` again

**See:** `docs/specs/smartergpt-structure-v1.md` for complete migration guide.
