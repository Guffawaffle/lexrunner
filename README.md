# LexRunner — Merge-Weave & Fanout CLI (`lex-pr`)

![Source Available](https://img.shields.io/badge/License-Source--Available-orange)
![Uses Lex (MIT)](<https://img.shields.io/badge/Powered%20by-Lex%20(MIT)-blue>)

**`lex-pr` powered by LexRunner.** Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly.

---

## Branding & Licensing

**LexRunner** is a source-available product built on top of **Lex**, the MIT-licensed OSS core. See [ADR-000](docs/adr/ADR-000-product-naming-and-branding.md) for naming and branding decisions.

- **Product:** LexRunner (source-available, merge pyramid & fanout orchestration)
- **CLI:** `lex-pr` (command-line interface)
- **OSS Core:** [Lex](https://github.com/Guffawaffle/lex) (MIT license, frames & policy)

### LexRunner (Source-Available) vs Lex (MIT OSS)

| Aspect       | **LexRunner** (Source-Available)               | **Lex** (OSS)                                   |
| ------------ | ---------------------------------------------- | ----------------------------------------------- |
| **Purpose**  | Enterprise merge-weave orchestration CLI       | Atlas/Memory/Policy core frameworks             |
| **License**  | Source-available personal use                  | MIT (open source)                               |
| **Repo**     | `Guffawaffle/LexRunner`                        | `Guffawaffle/lex`                               |
| **Audience** | Teams running automated fanout/merge workflows | Developers building on frames/policy primitives |

👉 **Choose Lex if:** You need frames, policy scanning, or atlas functionality independently.
👉 **Choose LexRunner if:** You need the full merge-weave orchestration CLI (built on Lex).

### Lex Dependency Management

LexRunner consumes Lex as an npm dependency (`@smartergpt/lex`). For details on packaging decisions and version management, see [ADR-008: Lex Packaging Strategy](docs/adr/ADR-008-lex-packaging.md).

#### Current Version

- **Package:** `@smartergpt/lex`
- **Version:** `^2.1.1` (allows compatible updates)
- **License:** MIT
- **Registry:** https://www.npmjs.com/package/@smartergpt/lex

#### Managing Lex Updates

Use the provided script to manage Lex dependency:

```bash
# Check for available updates
./scripts/package-lex.sh check

# Validate current installation
./scripts/package-lex.sh validate

# Update to latest compatible version
./scripts/package-lex.sh update

# Show package information
./scripts/package-lex.sh info
```

#### Manual Update Process

To update Lex manually:

```bash
# 1. Check for updates
npm outdated @smartergpt/lex

# 2. Update to latest compatible version
npm update @smartergpt/lex

# 3. Or install specific version
npm install @smartergpt/lex@2.1.1

# 4. Run tests to validate
npm test

# 5. Commit if tests pass
git add package.json package-lock.json
git commit -m "chore: update @smartergpt/lex to 2.1.1"
```

#### Versioning Expectations

- **Semantic Versioning:** Lex follows semver strictly
  - **MAJOR** — Breaking API changes (requires LexRunner code updates)
  - **MINOR** — New features, backward compatible (safe to update)
  - **PATCH** — Bug fixes, backward compatible (safe to update)
- **Caret Range:** `^2.1.1` allows MINOR and PATCH updates, blocks MAJOR
- **Testing:** Always run tests after updating Lex
- **CI Integration:** GitHub Dependabot monitors for updates and security issues

#### Licensing

- **Lex License:** MIT (permissive open source)
- **LexRunner License:** SmarterGPT Source-Available Personal Use License
- **Attribution:** See [NOTICE.md](NOTICE.md) for required attributions
- **Compliance:** Automated via `scripts/check-license-compliance.mjs`

For more details, see:

- [Lex Public API Documentation](docs/LEX_PUBLIC_API.md)
- [Lex Integration Guide](docs/LEX_INTEGRATION.md)
- [License Compliance Guide](docs/LICENSING.md)

---

## MCP Multi-Repo Integration

The repository includes an optional **Model Context Protocol (MCP) server** (`src/mcp/server.ts`) that exposes deterministic tools for plan & gate workflows.

### Why

Use a single built artifact to service multiple local repositories (each as an isolated endpoint) without adding persistent services to your compose stack. This keeps lex-serve minimal (nginx + tunnel) while enabling agent orchestration.

### Generator Script

Auto-generate `servers.json` describing per-repo MCP endpoints.

Script location:

`scripts/gen_mcp_servers.py`

Key capabilities:

- Recursive or shallow git repo discovery under provided roots
- Include / exclude regex filters (`--include`, `--exclude`)
- Mutation allow-list via repeated `--mutate <repo>` or structured `--policy-file`
- Per-repo `.env.mcp` overlay (non-destructive; does not override explicit flags/policy)
- Profile detection precedence: `.smartergpt.local` → `.smartergpt`
- Dist autodetect: built `dist/mcp/server.js` → fallback `tsx src/mcp/server.ts`
- Deterministic sorted keys + SHA-256 hash guard (skip rewrite if unchanged)
- Optional read-only workspace variant (`--workspace-out`)
- Prefix isolation (`--prefix`, default `lexrunner`)

### Quick Use

```bash
# Build once so dist/mcp/server.js is present
npm run build

# Generate primary + workspace variant (recursive scan)
python3 scripts/gen_mcp_servers.py \
  -r /srv -r /home/guff \
  --recursive \
  --include '^(smartergpt|lex-serve|lexrunner)$' \
  --mutate lexrunner \
  --workspace-out servers.workspace.json

# Or use the convenience npm script (uses defaults)
  }
```

### Output Shape (primary)

```jsonc
{
  "mcpServers": {
    "lexrunner-smartergpt": {
      "command": "node",
      "args": ["/home/guff/lexrunner/dist/mcp/server.js"],
      "env": {
        "ALLOW_MUTATIONS": "false",
        "LEX_PR_PROFILE_DIR": "/srv/sites/smartergpt/.smartergpt",
      },
      "workingDirectory": "/srv/sites/smartergpt",
    },
  },
}
```

Workspace variant (`servers.workspace.json`) mirrors entries but forces `ALLOW_MUTATIONS=false` for all.

### Orchestrator Flow (Suggested)

1. `profile.resolve` (confirm profile path & role)
2. `local.init` (if runner artifacts missing)
3. `plan.create`
4. `gates.run`
5. `merge.apply` (dry run) → eligibility summary
6. `merge.apply` (real) only after explicit approval & env `ALLOW_MUTATIONS=true`

See `orchestrator-prompt.md` for a supervisory prompt template.
}

````

Workspace variant (`servers.workspace.json`) mirrors entries but forces `ALLOW_MUTATIONS=false` for all.

### Orchestrator Flow (Suggested)
1. `profile.resolve` (confirm profile path & role)
2. `local.init` (if runner artifacts missing)
3. `plan.create`
4. `gates.run`
5. `merge.apply` (dry run) → eligibility summary
6. `merge.apply` (real) only after explicit approval & env `ALLOW_MUTATIONS=true`

See `orchestrator-prompt.md` for a supervisory prompt template.


## Two-track separation (firm)

See [`docs/TERMS.md`](docs/TERMS.md) for complete canonical terms and separation rules. Core runner (`src/**`) never stores user/work artifacts. `.smartergpt/**` contains portable example profile only.

## Requirements

- **Node.js**: Version specified in `.nvmrc` (currently 22)
- **npm**: Version specified in `packageManager` field of `package.json` (currently 10.0.0)
- **Git**: Configured with `user.name` and `user.email`

Use `npm run cli -- doctor` to verify your environment meets all requirements.

## Quick start

### Installation

```bash
# Install globally
npm install -g lexrunner

# Or install in your project
npm install --save-dev lexrunner
````

After installation, you'll see a reminder to initialize your workspace:

```
📦 lexrunner installed! Run "npx lex-pr init" to set up your workspace.
```

### For New Users

**Quick Start: Merge-Weave Workflow (Recommended)**

The fastest path to merging multiple PRs:

```bash
# 1. Discover open PRs
lex-pr weave discover

# 2. Generate merge plan
lex-pr weave plan --from-github --output plan.json

# 3. Preview execution (dry-run)
lex-pr weave apply --dry-run

# 4. Execute gates
lex-pr weave apply

# 5. Merge PRs (optional)
lex-pr merge --plan plan.json --execute
```

**📖 Full guide:** [MERGE_WEAVE_QUICKSTART.md](./MERGE_WEAVE_QUICKSTART.md)

**Traditional Workflow:**

```bash
# 1. Initialize workspace (creates .smartergpt.local/ with v1 structure)
npx lex-pr init

# 2. Verify environment
npx lex-pr doctor

# 3. Discover PRs
npx lex-pr discover

# 4. Generate plan
npx lex-pr plan --from-github

# 5. Review plan interactively
npx lex-pr plan-review plan.json

# 6. Execute gates
npx lex-pr execute plan.json

# 7. Merge PRs
npx lex-pr merge plan.json
```

See [docs/quickstart.md](docs/quickstart.md) for a complete 5-minute onboarding guide.

### Using Merge-Weave in Other Lex Ecosystem Repos

LexRunner's merge-weave functionality can be used in any Lex ecosystem repository (lex, lexsona, etc.):

```bash
# Quick start for adopting repos
curl -fsSL https://raw.githubusercontent.com/Guffawaffle/LexRunner/main/scripts/quick-start-merge-weave.sh | bash

# Or manually:
# 1. Install LexRunner
npm install --save-dev github:Guffawaffle/LexRunner

# 2. Discover PRs and generate plan
npx lex-pr discover --owner YOUR_ORG --repo YOUR_REPO --labels ready-to-merge --output plan.json

# 3. Preview merge operations
npx lex-pr merge --plan plan.json --dry-run

# 4. Execute merge
npx lex-pr merge --plan plan.json --execute --cleanup
```

**Complete Setup Guide:** See [docs/MERGE_WEAVE_SETUP.md](docs/MERGE_WEAVE_SETUP.md) for detailed installation instructions, configuration examples, and troubleshooting.

**Convenience Scripts:**

- [`scripts/merge-weave-wrapper.sh`](scripts/merge-weave-wrapper.sh) - Simple wrapper for common operations
- [`scripts/quick-start-merge-weave.sh`](scripts/quick-start-merge-weave.sh) - Automated setup for new repos

## Front-End Capture Pipeline

The front-end capture pipeline enables rapid idea-to-project workflows using GitHub Issues (no PRs).

### Commands

#### `lex-pr idea`

Capture feature ideas, generate Feature Spec v0, create/update Idea Issues.

**Usage:**

```bash
# Interactive mode (prompts for all inputs)
lex-pr idea

# Non-interactive with flags
lex-pr idea \
  --title "Add dark mode support" \
  --description "Implement theme switcher with light/dark modes"

# Dry run (no Issue creation)
lex-pr idea \
  --title "Add dark mode support" \
  --description "Implement theme switcher" \
  --dry-run

# Update existing Issue (idempotent via fingerprinting)
lex-pr idea \
  --title "Add dark mode support (revised)" \
  --description "Implement theme switcher with auto-detection" \
  --update-issue 123

# Custom output path
lex-pr idea \
  --title "Add dark mode support" \
  --description "Implement theme switcher" \
  --output /tmp/my-idea.json
```

**Options:**

- `--title <string>` - Idea title (interactive if omitted)
- `--description <string>` - Brief description (interactive if omitted)
- `--interactive` - Force interactive mode
- `--dry-run` - Generate spec without creating Issue
- `--output <path>` - Output path for Feature Spec v0 (default: `.smartergpt.local/deliverables/_session/idea-{timestamp}.json`)
- `--repo <owner/repo>` - Target repository (default: auto-detect from git remote)
- `--label <label>` - Additional labels (repeatable)
- `--update-issue <num>` - Update existing Issue (idempotent)

**Output:**

- Feature Spec v0 JSON (validated against schema)
- GitHub Idea Issue with `[IDEA]` prefix and `idea`, `needs-triage` labels
- Fingerprint for idempotent updates

---

#### `lex-pr create-project`

Load Feature Spec v0, generate Execution Plan v1, create Epic + Sub-Issues.

**Usage:**

```bash
# Basic usage (requires Feature Spec v0 from lex-pr idea)
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json

# Dry run (no Issue creation)
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json \
  --dry-run

# With custom labels
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json \
  --epic-labels "phase-1,high-priority" \
  --issue-labels "sprint-3"

# Custom output path
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json \
  --output /tmp/execution-plan.json

# Skip sub-issue linking
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json \
  --no-link
```

**Options:**

- `--spec <path>` - Feature Spec v0 file (required)
- `--dry-run` - Generate plan without creating Issues
- `--output <path>` - Output path for Execution Plan v1 (default: `.smartergpt.local/deliverables/_session/plan-{timestamp}.json`)
- `--repo <owner/repo>` - Target repository (default: auto-detect from spec)
- `--project <name/num>` - Link Issues to GitHub Project (optional)
- `--epic-labels <labels>` - Additional Epic labels (comma-separated)
- `--issue-labels <labels>` - Additional sub-issue labels (comma-separated)
- `--no-link` - Skip sub-issue linking

**Output:**

- Execution Plan v1 JSON (validated against schema)
- GitHub Epic Issue with `epic` label
- GitHub Sub-Issues (feature, testing, docs) linked to Epic

---

### Workflow Example

**End-to-end: Idea → Epic + Sub-Issues**

```bash
# Step 1: Capture idea
lex-pr idea \
  --title "Add webhooks support" \
  --description "Allow users to configure webhooks for events"

# Output:
# ✓ Feature Spec v0 written to: .smartergpt.local/deliverables/_session/idea-2025-11-09T14-30-00.json
# ✓ Idea Issue created: https://github.com/owner/repo/issues/456

# Step 2: Generate project
lex-pr create-project \
  --spec .smartergpt.local/deliverables/_session/idea-2025-11-09T14-30-00.json

# Output:
# ✓ Execution Plan v1 written to: .smartergpt.local/deliverables/_session/plan-2025-11-09T14-35-00.json
# ✓ Epic created: https://github.com/owner/repo/issues/457
# ✓ Sub-Issue created: https://github.com/owner/repo/issues/458 (feature)
# ✓ Sub-Issue created: https://github.com/owner/repo/issues/459 (testing)
# ✓ Sub-Issue created: https://github.com/owner/repo/issues/460 (docs)
```

---

### Safety Mechanisms

**PR Prevention:**

- Commands are Issues-only; no PR creation logic
- Runtime guards detect accidental PR API calls
- PR-related flags (`--create-pr`, `--pr`) rejected

**Artifact Path Restrictions:**

- Writes allowed only to `.smartergpt.local/deliverables/_session/`
- PR directories (`/PR-<number>/`, `/artifacts/PR-*/`) blocked
- Custom output paths validated before write

**Schema Validation:**

- All inputs/outputs validated against Zod schemas
- Pre-flight checks before Issue creation
- Detailed error messages with line numbers

---

### Schemas

**Feature Spec v0:**

```json
{
  "schemaVersion": "0.1.0",
  "title": "Add dark mode support",
  "description": "Implement theme switcher with light/dark modes",
  "acceptanceCriteria": [
    "User can toggle between light and dark themes",
    "Theme preference persists across sessions",
    "All UI components support both themes"
  ],
  "technicalContext": "Use CSS variables and localStorage",
  "constraints": "Must work in IE11+",
  "repo": "owner/repo",
  "createdAt": "2025-11-09T14:30:00.000Z"
}
```

**Execution Plan v1:**

```json
{
  "schemaVersion": "1.0.0",
  "sourceSpec": {
    /* Feature Spec v0 */
  },
  "epic": {
    "title": "Add dark mode support",
    "description": "Implement theme switcher with light/dark modes",
    "acceptanceCriteria": [
      /* from Feature Spec */
    ]
  },
  "subIssues": [
    {
      "id": "feature-impl",
      "title": "Implement Add dark mode support",
      "description": "Core implementation of feature",
      "type": "feature",
      "acceptanceCriteria": [
        /* from Feature Spec */
      ],
      "dependsOn": []
    },
    {
      "id": "tests",
      "title": "Add tests for Add dark mode support",
      "description": "Unit and integration tests",
      "type": "testing",
      "acceptanceCriteria": ["Unit tests pass", "Integration tests pass", "Coverage > 80%"],
      "dependsOn": ["feature-impl"]
    },
    {
      "id": "docs",
      "title": "Document Add dark mode support",
      "description": "User-facing documentation",
      "type": "docs",
      "acceptanceCriteria": ["README updated", "Examples added", "API docs complete"],
      "dependsOn": ["feature-impl"]
    }
  ],
  "createdAt": "2025-11-09T14:35:00.000Z"
}
```

For complete documentation, see [docs/front-end-capture-pipeline.md](docs/front-end-capture-pipeline.md).

## 📚 Documentation

Complete documentation and interactive plan review guides

See the full documentation index: [docs/README.md](docs/README.md)

Quick links:

- **Getting Started**: docs/quickstart.md — 5-minute onboarding
- **Front-End Capture Pipeline**: docs/front-end-capture-pipeline.md — idea → project workflow (Issues-only)
- **Merge Pyramid Tutorial**: docs/tutorials/quick-merge-pyramid.md — discover → plan → execute → merge workflow
- **Diffgraph Planner**: docs/diffgraph-planner.md — automatic dependency discovery & merge ordering
- **Prompts Configuration**: docs/prompts.md — prompts precedence, cross-repo usage, token expansion
- **Architecture Overview**: docs/architecture.md — system design & philosophy
- **CLI Reference**: docs/cli.md — complete command documentation
- **Troubleshooting**: docs/troubleshooting.md — common issues & solutions
- **Migration Guide**: docs/migration-guide.md — migrating to lexrunner
- **FAQ**: FAQ.md — quick answers to common questions
- **Video Tutorials**: docs/tutorials/ — step-by-step video guides
- **Workflows**: docs/workflows/ — examples for different team sizes
- **CI/CD Integrations**: docs/integrations/ — platform-specific setup

Interactive Plan Review

Review and edit plans before execution. Example workflows:

```bash
# Interactive review with validation
lex-pr plan-review plan.json

# Compare two plans
lex-pr plan-diff old-plan.json new-plan.json

# Save review history
lex-pr plan-review plan.json --save-history --output approved-plan.json
```

See docs/interactive-plan-review.md for the full interactive workflow guide.

## Diffgraph Planning

The diffgraph planner automatically discovers dependencies between PRs and computes optimal merge order. It combines:

1. **Explicit dependencies** from PR descriptions (e.g., `Depends-on: #123`)
2. **Implicit dependencies** from file-change analysis
3. **Validation** for cycles, orphans, and invalid references
4. **Topological sorting** for deterministic merge layers

### Quick Example

```bash
# Generate plan from GitHub PRs with auto-discovery
lex-pr plan --from-github --output plan.json

# Review suggested dependencies
lex-pr plan --suggest-deps --threshold=0.7

# Execute in dependency order
lex-pr execute --plan plan.json
```

### Key Features

- **Automatic dependency discovery** - detects implicit dependencies via file overlap
- **Cycle detection** - prevents circular dependencies
- **Confidence scoring** - ranks suggestions by reliability (0.0-1.0)
- **Multiple heuristics** - shared files, directory proximity, test overlap
- **Hybrid workflow** - combine explicit + implicit dependencies
- **GitHub CI integration** - automatically import gate results from GitHub check runs (v0.6.0+)

### Documentation

**Getting Started:**

- [Quickstart Guide](docs/quickstart.md) - Get up and running in 5 minutes
- [Merge-Weave Quickstart](docs/merge-weave-quickstart.md) - End-to-end merge-weave walkthrough with examples

**Reference:**

- **[Environment Variables](docs/environment-variables.md)** - environment configuration, CI safety, and aliasing
- **[Profile Resolution](docs/profile-resolution.md)** - profile precedence and configuration
- **[Complete Guide](docs/diffgraph-planner.md)** - full feature documentation
- **[Troubleshooting](docs/troubleshooting-planner.md)** - common errors and solutions
- **[Tutorials](docs/tutorials/diffgraph-planner/)** - step-by-step guides
  - [01-simple-stack.md](docs/tutorials/diffgraph-planner/01-simple-stack.md) - linear dependencies
  - [02-diamond-pattern.md](docs/tutorials/diffgraph-planner/02-diamond-pattern.md) - fan-out/fan-in
  - [03-large-batch.md](docs/tutorials/diffgraph-planner/03-large-batch.md) - 20+ PRs
  - [04-fixing-cycles.md](docs/tutorials/diffgraph-planner/04-fixing-cycles.md) - cycle resolution
  - [05-hybrid-workflow.md](docs/tutorials/diffgraph-planner/05-hybrid-workflow.md) - explicit + implicit

### For Development

```bash
# install dependencies
npm install

# dev mode
npm run dev

# run CLI (ts)
npm run cli -- plan --help
```

## CLI Commands

### Plan Generation

```bash
# Generate plan artifacts (plan.json + snapshot.md)
npm run cli -- plan [--out .smartergpt/runner]

# JSON-only mode for CI integration
npm run cli -- plan --json

# Custom output directory
npm run cli -- plan --out ./my-artifacts
```

### Other Commands

```bash
# Environment and config sanity checks
npm run cli -- doctor

# Gate report aggregation
npm run cli -- report <directory> [--out json|md]

# Orchestration: Batch planning with Kahn's algorithm
npm run cli -- orchestrate:plan-batch --issues 156,157,160
npm run cli -- orchestrate:plan-batch --input analysis.json --json

# Python CLI (legacy)
lex-pr schema validate plan.json
lex-pr merge-order plan.json --json
```

### Orchestration Commands

The `orchestrate:plan-batch` command generates deterministic batch plans using Kahn's algorithm:

```bash
# From explicit issue list
lex-pr orchestrate:plan-batch --issues 156,157,160,161,164

# From issue analyzer output
lex-pr orchestrate:plan-batch --input analysis.json --json > batch-plan.json
```

**Features:**

- Deterministic topological sorting (same input → same output)
- Stable priority queue (score → createdAt → number)
- Layer-based batching for parallel execution
- Cycle detection with helpful error messages
- SHA256 hash for plan reproducibility

See [`docs/orchestration.md`](docs/orchestration.md) for detailed documentation.

### Agent Stall Detection

Monitor Copilot agent PRs for activity and automatically nudge or escalate when agents stall:

```bash
# Check PR status once
lex-pr fanout monitor --prs 123,456

# Watch PRs continuously with auto-nudge
lex-pr fanout monitor --prs 123,456,789 --watch --interval 5m --action nudge

# Custom thresholds and auto-escalation
lex-pr fanout monitor --prs 123 \
  --warning-threshold 5m \
  --stall-threshold 15m \
  --action escalate

# JSON output for automation
lex-pr fanout monitor --prs 123,456 --json
```

**Features:**

- Automatic stall detection (configurable thresholds: 10m warning, 20m stall)
- Auto-nudge stalled agents with GitHub comments
- Auto-escalate for human intervention
- Watch mode for continuous monitoring
- JSON output for CI/CD integration

**Detection States:**

- **Active** - Recent commits, no action needed
- **Stalled** - No commits >= threshold, auto-nudge/escalate
- **Complete** - PR ready for review

See [`docs/agent-stall-detection.md`](docs/agent-stall-detection.md) for complete documentation and examples.

### Gate Report Aggregation

The `report` command aggregates gate results from a directory of JSON files:

```bash
# Aggregate gate reports (JSON output)
npm run cli -- report ./gate-results --out json

# Generate markdown summary
npm run cli -- report ./gate-results --out md
```

**Gate Result Format:**
Each gate result file must follow the JSON schema with stable keys:

```json
{
  "item": "item-name",
  "gate": "gate-name",
  "status": "pass|fail",
  "duration_ms": 1000,
  "started_at": "2024-01-15T10:30:00Z",
  "stderr_path": "/path/to/stderr.log", // optional
  "stdout_path": "/path/to/stdout.log", // optional
  "meta": {
    // optional
    "exit_code": "0",
    "command": "npm test"
  }
}
```

**Features:**

- Stable, deterministic output with sorted items and gates
- Validation against JSON schema
- Summary statistics (allGreen, pass/fail counts)
- Multiple output formats (JSON, Markdown)
- Exit code 0 if all gates pass, 1 if any fail

## Turn Cost Tracking

LexRunner implements **Turn Cost** tracking to measure coordination overhead during merge-weave and gate execution operations. Turn Cost quantifies the "friction" in automation workflows beyond simple token counts.

### Formula

```
Turn Cost = λL + γC + ρR + τT + αA
```

Where:

- **L (Latency)**: API response time, gate execution time, merge time
- **C (Context Reset)**: Tokens required to rebuild context (N/A for deterministic runner)
- **R (Renegotiation)**: Conflict resolution retries, clarification turns
- **T (Token Bloat)**: Excess tokens used beyond expected budget
- **A (Attention Switch)**: Human interventions, manual conflict resolutions

Default weights: `λ=0.1, γ=0.1, ρ=0.3, τ=0.2, α=0.3`

### Usage

**Execute Command:**

```bash
# Enable Turn Cost tracking during gate execution
lex-pr execute plan.json --track-turncost

# JSON output includes Turn Cost summary
lex-pr execute plan.json --track-turncost --json
```

**Merge Command:**

```bash
# Track Turn Cost during merge-weave operations
lex-pr merge --execute --track-turncost

# Dry run with conflict detection and Turn Cost preview
lex-pr merge --track-turncost
```

### Output Format

**Human-readable:**

```
=== Turn Cost ===
Weighted Score: 3.20
Latency: 12.50s
Renegotiations: 1
Attention Switches: 0
vs Prior Run: -45%
```

**JSON:**

```json
{
  "turnCost": {
    "components": {
      "latencyMs": 12500,
      "contextResetTokens": 0,
      "renegotiationCount": 1,
      "tokenBloat": 2400,
      "attentionSwitchCount": 0
    },
    "weightedScore": 3.2,
    "eventCount": 4,
    "priorRunScore": 5.8,
    "improvement": "-45%"
  }
}
```

### What Gets Tracked

| Operation           | Latency             | Renegotiation       | Attention Switch |
| ------------------- | ------------------- | ------------------- | ---------------- |
| Gate execution      | ✅ Per-gate timing  | ✅ Gate retries     | ❌ (future)      |
| Merge operations    | ✅ Total merge time | ✅ Conflict retries | ❌ (future)      |
| Conflict resolution | ✅ Resolution time  | ✅ Retry attempts   | ✅ Manual fixes  |

### Business Value

From the coordination cost compression thesis:

> "Token costs are linear; Turn costs compound through cascading misunderstandings."

Turn Cost tracking enables:

- **Measuring actual coordination overhead** (not just API costs)
- **Identifying high-friction workflows** that need optimization
- **Optimizing for human attention** (the scarcest resource)
- **Comparing automation efficiency** across runs

### Related

- Issue [#376](https://github.com/Guffawaffle/LexRunner/issues/376): Token Optimization Epic
- Issue [#330](https://github.com/Guffawaffle/LexRunner/issues/330): Frames & Metrics
- Issue [#327](https://github.com/Guffawaffle/LexRunner/issues/327): Budget Guards

## Configuration

### Profile Resolution

The runner uses a **precedence chain** to locate the profile directory:

1. `--profile-dir <path>` - Explicit CLI override
2. `LEX_PR_PROFILE_DIR` - Environment variable
3. `.smartergpt.local/` - Local overlay (development, not tracked)
4. `.smartergpt/` - Tracked example profile (default)

**Quick start:**

```bash
# Initialize local overlay for development
npm run cli -- init-local

# Runner automatically uses .smartergpt.local/
npm run cli -- plan

# Or use explicit override
npm run cli -- plan --profile-dir /custom/path
```

See [docs/profile-resolution.md](docs/profile-resolution.md) for complete documentation, migration guide, and examples.

### Configuration Files

The planner reads configuration from the resolved profile directory:

- **`stack.yml`**: Explicit plan with items, dependencies, and strategies (highest priority)
- **`scope.yml`**: Target branch and PR selection criteria (fallback)
- **`deps.yml`**: Dependency definitions (future use)
- **`profile.yml`**: Profile metadata and role (`example`, `development`, `local`)

### Example stack.yml

```yaml
version: 1
target: main
items:
  - id: 1
    name: auth-system # Dependencies resolve by 'name' field
    branch: feature/auth-system
    sha: abc123def456
    deps: [] # Use 'deps' array (references other item names)
    strategy: rebase-weave
  - id: 2
    name: api-endpoints # Generator defaults: name := id
    branch: feature/api-endpoints
    deps: ["auth-system"] # Depends on item with name="auth-system"
    strategy: merge-weave
```

## CLI Exit Codes

The CLI follows standard Unix conventions for automation and CI integration:

- **`0`**: Success - operation completed without errors
- **`2`**: Validation errors - invalid configuration, unknown dependencies, schema violations
- **`1`**: Unexpected errors - system failures, network issues, crashes

### Security Subcommand Exit Codes (Extended)

For `security` subcommands (`check-rotation`, `scan-plan`, `validate-secrets`):

| Code | Meaning               | Notes                               |
| ---- | --------------------- | ----------------------------------- |
| 0    | Success / No findings | Status = ok                         |
| 1    | Findings detected     | Status = findings (action required) |
| 2    | Internal error        | Status = error (investigate stack)  |

JSON output is deterministic with ordered keys: `command,status,exitCode,findings,timestamp`.

Format flags:
`--format text|json` (default text), `--no-color` disables ANSI styling in text mode.

**Secret Rotation:**

- See [docs/security/rotation-guide.md](docs/security/rotation-guide.md) for rotation patterns and cadences
- Example script: `tsx scripts/rotate-secrets-example.ts` (deterministic JSON output)

```bash
# CI-friendly validation
npm run cli -- plan --json || echo "Plan validation failed with exit code $?"
```

## Project layout

- `src/core`: planner, gates runner, weave strategies
- `src/cli.ts`: human CLI (Commander)
- `src/mcp/server.ts`: MCP tool/resource surface (adapter)
- `.smartergpt/`: canonical inputs + runner artifacts

## Deterministic Behavior

The runner prioritizes **deterministic outputs** for reliable CI/CD integration:

```bash
# Verify determinism - identical inputs produce identical byte outputs
npm run cli -- plan --out .artifacts1
npm run cli -- plan --out .artifacts2
cmp .artifacts1/plan.json .artifacts2/plan.json  # Should be identical
```

**Key guarantees:**

- Canonical JSON with stable key ordering (no timestamps)
- Raw-byte deterministic hashing for artifact verification
- Cross-platform portability (Windows, macOS, Linux)
- Dependency resolution by `name` field with cycle detection

## Note about tests and temp directories

When running tests the suite may run files in parallel. Some tests temporarily change the process working directory (for example to exercise CLI behaviors) and create/remove temp directories. To avoid race conditions and `getcwd()` failures we use a per-test-file temporary directory naming pattern (based on the test filename) so parallel test files don't collide when they change `process.cwd()` or remove temporary folders. If you add new tests that change directory, follow the same pattern:

```ts
const testDir = path.join(os.tmpdir(), `lexrunner-determinism-test-${path.basename(__filename)}`);
process.chdir(testDir);
```

This keeps tests isolated and prevents intermittent failures when running the full test suite.

## Performance Benchmarks

The project includes a comprehensive performance regression test suite to track critical operation performance over time.

### Running Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmark
npm run benchmark -- core/topologicalSort.bench.ts

# Compare against baseline (CI mode)
npm run benchmark:ci

# Update baseline metrics (after performance improvements)
npm run benchmark:baseline
```

### What's Measured

- **Core Algorithms**: Topological sort, plan parsing, dependency resolution (10-500 nodes)
- **I/O Operations**: File operations, git operations
- **End-to-End Workflows**: Complete plan generation and execution pipelines

### CI Integration

Benchmarks run automatically on PRs via GitHub Actions. The workflow:

1. Executes all benchmarks
2. Compares results against committed baseline
3. Posts performance report as PR comment
4. **Fails PR if >20% performance regression detected**
5. **Warns if 10-20% slower**

See `tests/benchmarks/README.md` for detailed documentation.

## Notes

- Deterministic > clever. Outputs are sorted for stable diffs.
- `schemas/plan.schema.json` is the source of truth for validation.
- Dependencies resolve by `name` field (generator can default `name := id`)

## MCP: Multi-Repo Integration

Generate MCP server manifests for all local repos. The generator discovers git roots under `/srv` and `/home/guff`, detects `.smartergpt(.local)` profiles, and writes a deterministic `servers.json`.

```bash
# Build once (for dist), then generate
npm run build
npm run generate:mcp-servers

# Customize (recursive, filters, policy-file, mutate allow-list)
python3 scripts/gen_mcp_servers.py      -r /srv -r /home/guff --recursive      --include '^(smartergpt|lex-serve|lexrunner)$'      --policy-file mutate-policy.json      --mutate lexrunner      -o servers.json --workspace-out servers.workspace.json
```

### MCP Section Notes

- Profile precedence: `.smartergpt.local` → `.smartergpt`.
- Mutations are **off** by default; enable per-repo via `--mutate` or policy file.
- If `dist/mcp/server.js` is missing, generator falls back to `npx tsx src/mcp/server.ts`.
- `servers.workspace.json` is a read-only variant (all `ALLOW_MUTATIONS=false`).

### MCP Section Exit Codes

- `0`: success, no changes
- `2`: dry-run indicates the output would change
- `1`: error
