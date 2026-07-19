# Architecture Overview

## Design Philosophy

lexrunner is built on four core principles:

### 1. **Determinism First**

- Same inputs → identical outputs (byte-for-byte)
- No timestamps, random ordering, or non-deterministic behavior
- Canonical JSON with stable key ordering
- Cross-platform portability (Windows, macOS, Linux)

### 2. **Two-Track Separation**

- **Core Runner** (`src/**`): CLI logic, never stores user/work artifacts
- **Workspace Profile** (`.smartergpt/**`): Portable configuration and examples
- Clear boundary prevents mixing code and data

### 3. **Local-First Operations**

- All operations run locally with no server dependencies
- Privacy-first: no secrets in artifacts
- GitHub API calls only for discovery, not execution

### 4. **Cumulative Intelligence**

- Successful executions advance the work; failed executions improve the next attempt
- Terminal executions leave inspectable durable evidence rather than only activity or logs
- Retries record a meaningful changed premise instead of blindly replaying work
- See [LexRunner Principles](./PRINCIPLES.md) for the normative definitions and provenance

The [orchestration primitives decision record](./architecture/orchestration-primitives.md) applies
these principles to current Cursor, OpenClaw, Claude Code, Codex/Symphony, and GitHub Copilot
patterns without importing their product assumptions wholesale.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    lexrunner                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │  Runner CLI  │────────▶│  MCP Server  │            │
│  │   (TypeScript)│         │  (Adapter)   │            │
│  └──────────────┘         └──────────────┘            │
│         │                         │                     │
│         ▼                         ▼                     │
│  ┌──────────────────────────────────────┐              │
│  │         Core Components               │              │
│  ├──────────────────────────────────────┤              │
│  │  • Plan Generator                     │              │
│  │  • Dependency Resolver                │              │
│  │  • Gate Executor                      │              │
│  │  • Merge Coordinator                  │              │
│  │  • GitHub Integration                 │              │
│  └──────────────────────────────────────┘              │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Workspace Profile    │
              ├───────────────────────┤
              │  • intent.md          │
              │  • scope.yml          │
              │  • deps.yml           │
              │  • gates.yml          │
              │  • profile.yml        │
              └───────────────────────┘
```

## Core Components

### Runner CLI (`src/cli.ts`)

The primary command-line interface built with Commander.js.

**Key Commands:**

- `init` - Initialize workspace
- `discover` - Find PRs from GitHub
- `plan` - Generate merge plan
- `execute` - Run quality gates
- `merge` - Execute merge operations
- `doctor` - Environment validation

### Plan Generator (`src/core/plan.ts`)

Creates merge plans from configuration and GitHub data.

**Inputs:**

- `scope.yml` - PR selection criteria
- `deps.yml` - Dependency definitions
- GitHub API - Live PR data

**Output:**

- `plan.json` - Structured merge plan with dependency graph

### Dependency Resolver (`src/mergeOrder.ts`)

Computes topologically sorted merge order using Kahn's algorithm.

**Features:**

- Cycle detection
- Parallel execution opportunities
- Deterministic ordering (alphabetical tiebreaker)

### Gate Executor (`src/gates.ts`)

Runs quality gates with dependency-aware execution.

**Capabilities:**

- Parallel execution where possible
- Exit code/duration/stdout/stderr capture
- JSON output with stable schema
- Policy-based evaluation

### GitHub Integration (`src/github/`)

Read-only GitHub API client for PR discovery.

**Operations:**

- List open pull requests
- Fetch PR metadata (title, author, labels)
- Branch information
- No write operations (safety)

### MCP Server (`src/mcp/server.ts`)

Optional Model Context Protocol adapter.

**Exposed Tools:**

- `plan.create` - Generate merge plan
- `gates.run` - Execute quality gates
- `merge.apply` - Perform merge operations

**Resources:**

- `.smartergpt/runner/*` - Read-only access to artifacts

## Data Flow

### 1. Discovery Phase

```
GitHub API → discover → PRs list
                ↓
         scope.yml filtering
                ↓
         Filtered PR set
```

### 2. Planning Phase

```
Filtered PRs + deps.yml → Plan Generator
                ↓
         Dependency graph construction
                ↓
         Topological sort
                ↓
         plan.json (with merge order)
```

### 3. Execution Phase

```
plan.json + gates.yml → Gate Executor
                ↓
         Run gates in dependency order
                ↓
         Collect results
                ↓
         gate-results/*.json
```

### 4. Merge Phase

```
plan.json + gate results → Merge Coordinator
                ↓
         Validate all gates pass
                ↓
         Execute git operations
                ↓
         Merge PRs in order
```

## Configuration Resolution

### Profile Directory Precedence

1. `--profile-dir <path>` - Explicit CLI override
2. `LEX_PR_PROFILE_DIR` - Environment variable
3. `.smartergpt.local/` - Local overlay (not tracked)
4. `.smartergpt/` - Example profile (tracked, default)

See [profile-resolution.md](./profile-resolution.md) for details.

### Configuration Files

| File          | Purpose                       | Priority   |
| ------------- | ----------------------------- | ---------- |
| `stack.yml`   | Explicit plan with items/deps | Highest    |
| `scope.yml`   | PR selection criteria         | Fallback   |
| `deps.yml`    | Dependency definitions        | Supporting |
| `gates.yml`   | Quality gate configuration    | Supporting |
| `profile.yml` | Profile metadata              | Metadata   |

## Error Handling

### Exit Codes

- **`0`** - Success
- **`2`** - Validation errors (user input)
- **`1`** - System errors (unexpected)

See [errors.md](./errors.md) for complete taxonomy.

### Error Categories

1. **Validation Errors** (exit 2)
   - Invalid JSON schema
   - Unknown dependencies
   - Cycle detection
   - Configuration errors

2. **System Errors** (exit 1)
   - Network failures
   - File I/O errors
   - Unexpected crashes

## Security Model

### Privacy Guarantees

- **No server dependencies** - All operations local
- **No secret storage** - Tokens from environment only
- **Read-only GitHub access** - No write operations
- **No telemetry** - Zero data collection

### Safe Defaults

- `--dry-run` is default for merge operations
- Explicit `--execute` flag required for writes
- Gate failures block merges
- Rollback support for failures

## Performance Characteristics

### Scalability

- **PRs**: Tested with 100+ PRs
- **Gates**: Parallel execution (configurable workers)
- **Dependencies**: O(V + E) topological sort
- **Memory**: Streaming JSON parsing where possible

### Determinism Verification

```bash
# Verify byte-identical outputs
lex-pr plan --out .artifacts1
lex-pr plan --out .artifacts2
cmp .artifacts1/plan.json .artifacts2/plan.json
```

## Extension Points

### Custom Gates

Add gates to `gates.yml`:

```yaml
gates:
  - name: custom-check
    command: ./scripts/custom-gate.sh
    timeout: 60
```

### Custom Strategies

Future support for custom merge strategies:

- `rebase-weave` - Rebase with conflict resolution
- `merge-weave` - Merge with weave contract
- `squash-weave` - Squash with weave rules

## Testing Strategy

### Test Levels

1. **Unit Tests** (`*.spec.ts`)
   - Pure functions
   - Schema validation
   - Dependency resolution

2. **Integration Tests** (`integration-*.test.ts`)
   - CLI commands
   - File operations
   - End-to-end workflows

3. **E2E Tests** (`e2e-*.test.ts`)
   - Full automation pipeline
   - Multi-PR scenarios
   - Determinism verification

### Test Isolation

- Per-test temporary directories
- No shared state between tests
- Deterministic fixtures in `fixtures/`

## Related Documentation

- [CLI Reference](./cli.md) - Complete command documentation
- [Quickstart Guide](./quickstart.md) - 5-minute onboarding
- [Autopilot Levels](./autopilot-levels.md) - Automation levels
- [Error Taxonomy](./errors.md) - Error handling
- [Weave Contract](./weave-contract.md) - Merge strategies
