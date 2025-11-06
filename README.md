# LexRunner — Merge-Weave & Fanout CLI (`lex-pr`)

![Proprietary](https://img.shields.io/badge/License-Proprietary-red)
![Uses Lex (MIT)](https://img.shields.io/badge/Powered%20by-Lex%20(MIT)-blue)

**`lex-pr` powered by LexRunner.** Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly.

---

## Branding & Licensing

**LexRunner** is a proprietary product built on top of **Lex**, the MIT-licensed OSS core. See [ADR-000](docs/adr/ADR-000-product-naming-and-branding.md) for naming and branding decisions.

- **Product:** LexRunner (proprietary, merged pyramid & fanout orchestration)
- **CLI:** `lex-pr` (command-line interface)
- **OSS Core:** [Lex](https://github.com/Guffawaffle/lex) (MIT license, frames & policy)

### LexRunner (Proprietary) vs Lex (MIT OSS)

| Aspect | **LexRunner** (Paid) | **Lex** (OSS) |
|--------|---------------------|--------------|
| **Purpose** | Enterprise merge-weave orchestration CLI | Atlas/Memory/Policy core frameworks |
| **License** | Proprietary | MIT (open source) |
| **Repo** | `Guffawaffle/lex-pr-runner` | `Guffawaffle/lex` |
| **Audience** | Teams running automated fanout/merge workflows | Developers building on frames/policy primitives |

👉 **Choose Lex if:** You need frames, policy scanning, or atlas functionality independently.
👉 **Choose LexRunner if:** You need the full merge-weave orchestration CLI (built on Lex).

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
- Prefix isolation (`--prefix`, default `lex-pr-runner`)

### Quick Use

```bash
# Build once so dist/mcp/server.js is present
npm run build

# Generate primary + workspace variant (recursive scan)
python3 scripts/gen_mcp_servers.py \
  -r /srv -r /home/guff \
  --recursive \
  --include '^(smartergpt|lex-serve|lex-pr-runner)$' \
  --mutate lex-pr-runner \
  --workspace-out servers.workspace.json

# Or use the convenience npm script (uses defaults)
  }
```

### Output Shape (primary)

```jsonc
{
  "mcpServers": {
    "lex-pr-runner-smartergpt": {
      "command": "node",
      "args": ["/home/guff/lex-pr-runner/dist/mcp/server.js"],
      "env": {
        "ALLOW_MUTATIONS": "false",
        "LEX_PR_PROFILE_DIR": "/srv/sites/smartergpt/.smartergpt"
      },
      "workingDirectory": "/srv/sites/smartergpt"
    }
  }
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


## Two-track separation (firm)

See [`docs/TERMS.md`](docs/TERMS.md) for complete canonical terms and separation rules. Core runner (`src/**`) never stores user/work artifacts. `.smartergpt/**` contains portable example profile only.

## Requirements

- **Node.js**: Version specified in `.nvmrc` (currently 20.18.0)
- **npm**: Version specified in `packageManager` field of `package.json` (currently 10.0.0)
- **Git**: Configured with `user.name` and `user.email`

Use `npm run cli -- doctor` to verify your environment meets all requirements.

## Quick start

### For New Users

```bash
# 1. Install globally or in your project
npm install -g lex-pr-runner

# 2. Initialize workspace (interactive)
lex-pr init

# 3. Verify environment
lex-pr doctor

# 4. Discover PRs
lex-pr discover

# 5. Generate plan
lex-pr plan --from-github

# 6. Review plan interactively
lex-pr plan-review plan.json

# 7. Execute gates
lex-pr execute plan.json

# 8. Merge PRs
lex-pr merge plan.json
```

See [docs/quickstart.md](docs/quickstart.md) for a complete 5-minute onboarding guide.

## 📚 Documentation

Complete documentation and interactive plan review guides

See the full documentation index: [docs/README.md](docs/README.md)

Quick links:
- **Getting Started**: docs/quickstart.md — 5-minute onboarding
- **Merge Pyramid Tutorial**: docs/tutorials/quick-merge-pyramid.md — discover → plan → execute → merge workflow
- **Diffgraph Planner**: docs/diffgraph-planner.md — automatic dependency discovery & merge ordering
- **Architecture Overview**: docs/architecture.md — system design & philosophy
- **CLI Reference**: docs/cli.md — complete command documentation
- **Troubleshooting**: docs/troubleshooting.md — common issues & solutions
- **Migration Guide**: docs/migration-guide.md — migrating to lex-pr-runner
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

### Documentation

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
  "stderr_path": "/path/to/stderr.log",  // optional
  "stdout_path": "/path/to/stdout.log",  // optional
  "meta": {                              // optional
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
    name: auth-system      # Dependencies resolve by 'name' field
    branch: feature/auth-system
    sha: abc123def456
    deps: []               # Use 'deps' array (references other item names)
    strategy: rebase-weave
  - id: 2
    name: api-endpoints    # Generator defaults: name := id
    branch: feature/api-endpoints
    deps: ["auth-system"]  # Depends on item with name="auth-system"
    strategy: merge-weave
```

## CLI Exit Codes

The CLI follows standard Unix conventions for automation and CI integration:

- **`0`**: Success - operation completed without errors
- **`2`**: Validation errors - invalid configuration, unknown dependencies, schema violations
- **`1`**: Unexpected errors - system failures, network issues, crashes

### Security Subcommand Exit Codes (Extended)

For `security` subcommands (`check-rotation`, `scan-plan`, `validate-secrets`):

| Code | Meaning | Notes |
|------|---------|-------|
| 0 | Success / No findings | Status = ok |
| 1 | Findings detected | Status = findings (action required) |
| 2 | Internal error | Status = error (investigate stack) |

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
const testDir = path.join(os.tmpdir(), `lex-pr-runner-determinism-test-${path.basename(__filename)}`);
process.chdir(testDir);
```

This keeps tests isolated and prevents intermittent failures when running the full test suite.

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
python3 scripts/gen_mcp_servers.py      -r /srv -r /home/guff --recursive      --include '^(smartergpt|lex-serve|lex-pr-runner)$'      --policy-file mutate-policy.json      --mutate lex-pr-runner      -o servers.json --workspace-out servers.workspace.json
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
