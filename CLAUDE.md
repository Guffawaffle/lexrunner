# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lexrunner** is a TypeScript CLI tool for parallel PR workflows with dependency management and quality gates. The tagline: _Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly._

**Tech Stack**: TypeScript, ESM modules, Node.js 24+, Commander.js, Vitest

## Build & Test Commands

```bash
# Install dependencies
npm ci

# Development mode (watch + reload)
npm run dev

# Run CLI in development (TypeScript with tsx)
npm run cli -- <command>

# Build for production (ESM + CJS)
npm run build

# Run CLI from built artifacts
npm run cli:built -- <command>

# Type checking
npm run typecheck

# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Generate schemas
npm run generate:schemas
```

## Architecture

### Two-Track Separation (Critical)

**Core Runner** (`src/**`):

- CLI logic, MCP adapter, core library
- NEVER stores user/work artifacts
- Contains all runtime code

**Workspace Profile** (`.smartergpt/**`):

- Portable example profile only
- Track: `intent.md`, `scope.yml`, `deps.yml`, `gates.yml`, `stack.yml`, `pull-request-template.md`
- Ignore: `.smartergpt/runner/`, `cache/`, `deliverables/`
- Deliverables are posted as PR comments, NOT committed

### Core Components

**Plan Generator** (`src/core/plan.ts`):

- Transforms configuration into normalized plan
- Input: `scope.yml`, `deps.yml`, `stack.yml`, or GitHub API
- Output: `plan.json` (schema-validated)
- Deterministic: same inputs → identical outputs

**Dependency Resolver** (`src/mergeOrder.ts`):

- Kahn's algorithm for topological sort
- Cycle detection with clear error messages
- Alphabetical tiebreaker for deterministic ordering

**Gate Executor** (`src/gates.ts`):

- Runs quality gates (lint, test, typecheck, etc.)
- Parallel execution where dependencies allow
- Policy-aware with retry support

**GitHub Integration** (`src/github/`):

- Read-only API client for PR discovery
- Auto-discovery with label filtering
- Dependency suggestion with heuristics

**MCP Server** (`src/mcp/server.ts`):

- Optional Model Context Protocol adapter
- Exposes tools: `plan.create`, `gates.run`, `merge.apply`
- Read-only resources from `.smartergpt/runner/`
- Run with: `npm run mcp`

### CLI Structure

Main CLI (`src/cli.ts`):

- Commander.js-based command structure
- Modular command registration (see `src/commands/`)
- JSON output mode for CI/automation (`--json` flag)
- Exit codes: 0 (success), 2 (validation error), 1 (system error)

Key commands:

- `plan` - Generate merge plan
- `execute` - Run quality gates
- `merge` - Execute merge operations
- `discover` - Find GitHub PRs
- `doctor` - Environment validation
- `init` - Workspace setup
- `plan-review` - Interactive plan validation

### Test Architecture

Tests use Vitest with per-test isolation:

**Unit tests** (`*.spec.ts`):

- Pure function testing
- Schema validation
- Dependency resolution

**Integration tests** (`integration-*.test.ts`):

- CLI commands
- File operations
- End-to-end workflows

**Test isolation pattern**:

```typescript
const testDir = path.join(os.tmpdir(), `lexrunner-${path.basename(__filename)}`);
process.chdir(testDir);
```

This prevents race conditions when tests run in parallel and change `process.cwd()`.

## Configuration Files

**Profile Resolution Precedence**:

1. `--profile-dir <path>` (CLI override)
2. `LEX_PR_PROFILE_DIR` (environment variable)
3. `.smartergpt.local/` (local overlay, gitignored)
4. `.smartergpt/` (example profile, tracked)

**Configuration Files** (in profile directory):

- `stack.yml` - Explicit plan with items/deps (highest priority)
- `scope.yml` - PR selection criteria (fallback)
- `deps.yml` - Dependency definitions
- `gates.yml` - Quality gate configuration
- `profile.yml` - Profile metadata and role

## Determinism Principles

This codebase prioritizes **byte-for-byte deterministic outputs**:

1. **Canonical JSON**: Stable key ordering via `canonicalJSONStringify()`
2. **Sorted arrays**: All arrays sorted alphabetically (items, deps, gates)
3. **No timestamps**: Avoid time-dependent data in artifacts
4. **Cross-platform**: Works identically on Windows, macOS, Linux

Verify determinism:

```bash
npm run cli -- plan --out .artifacts1
npm run cli -- plan --out .artifacts2
cmp .artifacts1/plan.json .artifacts2/plan.json  # Should be identical
```

## ESM Module Patterns

**Critical ESM Requirements**:

1. **Import extensions required**: Always use `.js` extension in imports

   ```typescript
   import { foo } from "./foo.js"; // ✅ Correct
   import { foo } from "./foo"; // ❌ Wrong
   ```

2. **No `__dirname` or `__filename`**: Use ESM equivalents

   ```typescript
   import { fileURLToPath } from "node:url";
   import { dirname } from "node:path";

   const __filename = fileURLToPath(import.meta.url);
   const __dirname = dirname(__filename);
   ```

3. **Dynamic imports**: Use `await import()` for conditional loading

   ```typescript
   const { reviewPlan } = await import("./interactive/planReview.js");
   ```

4. **Entry point detection**: Use `import.meta.url` comparison
   ```typescript
   const isDirectExec = import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
   ```

## File Editing Rules

**CRITICAL**: These rules from `.github/copilot-instructions.md` apply to Claude Code as well:

✅ **Use editing tools for file modifications**:

- Use `Edit` tool for modifying existing files
- Use `Read` tool before editing to understand context
- Use `Write` tool only for new files

❌ **NEVER use shell commands for editing**:

- No `sed -i` or `awk` for in-place edits
- No `echo > file` or `cat << EOF` for file writes
- No `git checkout --theirs` followed by shell edits

**Conflict Resolution**: Always use `Edit` tool with exact string matching:

```typescript
// Read the conflict first
Read({ file_path: "src/cli.ts", limit: 100 });

// Resolve with Edit tool
Edit({
  file_path: "src/cli.ts",
  old_string: `import { foo } from "./foo.js";
<<<<<<< HEAD
import { bar } from "./bar.js";
=======
import { baz } from "./baz.js";
>>>>>>> branch`,
  new_string: `import { foo } from "./foo.js";
import { bar } from "./bar.js";
import { baz } from "./baz.js";`,
});
```

## Development Patterns

### Adding a New Command

1. Create command module in `src/commands/` (if complex)
2. Register in `src/cli.ts` using `.command()` or `registerXCommand()`
3. Add tests in `tests/` with appropriate suffix
4. Update help text if needed

Example:

```typescript
// src/commands/mycommand.ts
import { Command } from "commander";

export function registerMyCommand(
  program: Command,
  getJsonMode: () => boolean,
  exitWith: (error: unknown) => never
) {
  program
    .command("my-command")
    .description("...")
    .option("--json", "JSON output")
    .action(async (opts) => {
      try {
        // Implementation
      } catch (error) {
        exitWith(error);
      }
    });
}

// src/cli.ts
import { registerMyCommand } from "./commands/mycommand.js";
registerMyCommand(program, () => jsonModeActive, exitWith);
```

### Adding a Schema

1. Define Zod schema in `src/schema/` or `src/schema.ts`
2. Create generator script in `scripts/generate-*-schema.ts`
3. Run `npm run generate:schemas` to update `schemas/`
4. Add validation tests in `tests/`

Example schema pattern:

```typescript
import { z } from "zod";

export const MySchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

export type MyType = z.infer<typeof MySchema>;
```

### Working with Profiles

Development workflow:

```bash
# Create local overlay (gitignored)
npm run cli -- init-local

# Verify profile resolution
npm run cli -- doctor

# Generate plan using local profile
npm run cli -- plan
```

Production workflow uses `.smartergpt/` tracked profile.

## Common Gotchas

1. **Exit codes**: Use `throwExit(code)` not `process.exit(code)` for proper cleanup

   ```typescript
   import { throwExit } from "./cli/exitHandler.js";
   throwExit(2); // ✅ Validation error
   process.exit(2); // ❌ Bypasses handlers
   ```

2. **JSON mode**: Check `jsonModeActive` before console.log

   ```typescript
   import { writeJsonOutput } from "./cli/output.js";

   if (jsonModeActive) {
     writeJsonOutput(data);
   } else {
     console.log("Human-readable output");
   }
   ```

3. **Profile writes**: Validate write permissions for example/role profiles

   ```typescript
   import { validateWriteOperation } from "./config/profileResolver.js";
   validateWriteOperation(profilePath, role, "operation description");
   ```

4. **Test isolation**: Use per-file temp directories to avoid parallel test conflicts

   ```typescript
   const testDir = path.join(os.tmpdir(), `lexrunner-test-${path.basename(__filename)}`);
   ```

5. **Commander error handling**: Use `exitOverride` and custom error handling
   ```typescript
   program.exitOverride((err: CommanderError) => {
     throw new CLIExitSignal(err.exitCode ?? 1, err.message);
   });
   ```

## Code Organization

```
src/
├── cli.ts                 # Main CLI entry point (ESM)
├── cli-security.ts        # Security subcommands
├── commands/              # Modular command implementations
│   ├── init.ts
│   ├── status.ts
│   ├── planDiff.ts
│   └── ...
├── core/                  # Core business logic
│   ├── plan.ts           # Plan generation
│   ├── snapshot.ts       # Snapshot generation
│   ├── inputs.ts         # Configuration loading
│   └── ...
├── github/               # GitHub API integration
├── git/                  # Git operations
├── mcp/                  # MCP server adapter
│   └── server.ts         # MCP entry point
├── schema.ts             # Zod schemas
├── schema/               # Additional schemas
├── util/                 # Utilities
│   ├── canonicalJson.ts  # Deterministic JSON
│   ├── progress.ts       # Progress reporting
│   └── ...
├── cli/                  # CLI-specific utilities
│   ├── output.ts        # JSON output helpers
│   ├── flags.ts         # Flag parsing
│   ├── exitHandler.ts   # Exit handling
│   └── formatters.ts    # Output formatting
├── config/              # Configuration management
│   ├── profileResolver.ts
│   └── localOverlay.ts
├── monitoring/          # Logging, metrics, audit
├── security/            # Security features
└── autopilot/           # Autopilot levels

tests/                   # Vitest tests
├── *.spec.ts           # Unit tests
├── integration-*.test.ts # Integration tests
└── e2e-*.test.ts       # End-to-end tests

schemas/                # Generated JSON schemas
docs/                   # Documentation
scripts/                # TypeScript utility scripts
.smartergpt/            # Example profile (tracked)
```

## TypeScript Configuration

**tsconfig.json**:

- Target: ES2020
- Module: ES2020 (ESM)
- Strict mode enabled
- `noEmit: true` (tsup handles builds)

**Build with tsup**:

- Outputs both ESM (`.js`) and CJS (`.cjs`)
- Generates `.d.ts` type definitions
- Two entry points: `cli.ts` and `mcp/server.ts`

## Git & GitHub Workflow

**Commit Style**:

- Imperative mood: "Add feature" not "Added feature"
- Optional prefixes: `runner:`, `mcp:`, `schema:`, `tests:`, `ci:`, `docs:`, `workspace:`

**Branch Protection**:

- NEVER modify branch protections
- NEVER force push to main/master
- Use `--dry-run` by default for merge operations

**PR Workflow**:

1. Create feature branch
2. Implement with tests
3. Verify determinism: `npm run build && git diff --exit-code`
4. One PR = One feature/fix (tight scope)
5. Add "How to verify" section to PR description

## Security Model

- **Privacy-first**: No telemetry, no external servers
- **Secrets**: Never commit secrets, use environment variables
- **GitHub API**: Read-only by default (token from `GITHUB_TOKEN`)
- **Safe defaults**: `--dry-run` is default for destructive operations
- **MCP mutations**: Off by default, require `ALLOW_MUTATIONS=true`

## Related Documentation

Key docs to reference:

- `docs/architecture.md` - System design
- `docs/TERMS.md` - Canonical terminology
- `docs/quickstart.md` - 5-minute onboarding
- `docs/cli.md` - Complete CLI reference
- `docs/profile-resolution.md` - Profile precedence
- `.github/copilot-instructions.md` - File editing rules (applies to Claude Code)

## Canonical Terms (from docs/TERMS.md)

- **lexrunner**: The repository/project
- **Runner CLI**: TypeScript CLI app (`src/**`)
- **MCP server**: Optional adapter (`src/mcp/server.ts`)
- **Workspace profile**: Example config (`.smartergpt/**`)
- **Gate**: Quality check (lint, test, typecheck)
- **Plan**: Resolved set of items to merge (`plan.json`)
- **Item**: Unit in the plan (often a PR)
- **Integration branch**: Temporary branch for batch verification

## Working with This Codebase

When making changes:

1. **Read architecture first**: Understand two-track separation
2. **Maintain determinism**: Sort all arrays, use canonical JSON
3. **Add tests**: Unit + integration tests required
4. **Follow file editing rules**: Use Edit/Read/Write tools, not shell commands
5. **Verify build cleanliness**: `npm run build && git diff --exit-code`
6. **Test isolation**: Use per-file temp dirs in tests
7. **ESM imports**: Always use `.js` extensions
8. **Exit handling**: Use `throwExit()` not `process.exit()`
9. **Document breaking changes**: Update CLAUDE.md and docs/ as needed
