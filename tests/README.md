# Short notes for test authors

Some tests in this repository change the process working directory (via `process.chdir`) and create temporary files/directories to simulate real workspaces. When running Vitest with parallel workers, multiple test files can run at the same time. If different test files use the same temp path they can collide: one test may remove the directory while another test is still using it, which leads to transient failures such as `getcwd() failed: No such file or directory` or ENOENT errors when creating artifacts.

To avoid this, follow the per-file temp directory pattern used across the test suite:

```ts
import * as os from "os";
import * as path from "path";

// Ensure the temp directory is unique per test file
const testDir = path.join(os.tmpdir(), `lexrunner-determinism-test-${path.basename(__filename)}`);

// Create and switch into the directory
fs.mkdirSync(testDir, { recursive: true });
process.chdir(testDir);

// ... run tests that write files or call the CLI ...

// Cleanup in afterEach/afterAll
process.chdir("/");
fs.rmSync(testDir, { recursive: true });
```

## Why this matters

- Vitest may execute multiple worker processes; filesystem operations (mkdir/rm/chdir) are not atomic across processes on the same temp path.
- Using per-file unique temp paths makes tests deterministic and avoids flaky CI failures.

## Best practices

- Prefer creating and removing any test directories inside beforeEach/afterEach to limit the window where collisions could occur.
- When possible, avoid relying on `process.cwd()` globally; prefer passing explicit cwd values to subprocesses or library calls.
- Keep tests hermetic: always clean up files you create.

If you add documentation elsewhere (e.g., CONTRIBUTING.md), include this guidance so future contributors don't reintroduce flaky tests.

# Autopilot Level 3-4 E2E Tests

The `autopilot-e2e-level3-4.spec.ts` file contains comprehensive end-to-end tests for Autopilot Levels 3-4:

**Level 3 Test Coverage:**

- Integration branch creation and naming validation
- Multi-PR integration scenarios (sequential and parallel dependencies)
- Merge conflict detection and handling
- Gate execution on integration branches
- Integration branch lifecycle (create → merge → cleanup)
- Error handling and recovery testing
- Complex dependency graphs (diamond, deep chain, wide parallel)
- Performance testing for high-throughput execution

**Level 4 Test Coverage (Stub Tests):**

- PR cleanup and comment posting functionality (placeholders for when Level 4 is implemented)
- Integration branch finalization and deletion
- Custom comment templates

**Test Fixtures:**

- `fixtures/plan.integration-pyramid.json`: Multi-level dependency pyramid with foundation → features → integration
- `fixtures/plan.deep-chain.json`: 10-PR sequential dependency chain
- `fixtures/plan.wide-parallel.json`: 12 parallel PRs with no dependencies

**Running the tests:**

```bash
# Run all autopilot E2E tests
npm test -- autopilot-e2e-level3-4.spec.ts

# Run specific test suites
npm test -- autopilot-e2e-level3-4.spec.ts -t "Integration Branch Workflows"
npm test -- autopilot-e2e-level3-4.spec.ts -t "Gate Execution"
npm test -- autopilot-e2e-level3-4.spec.ts -t "Complex Dependency Graphs"
```

**Key Design Decisions:**

- Tests create real git repositories in temp directories for authentic integration testing
- All tests are deterministic and avoid timing dependencies
- Level 4 tests are stubs documenting expected behavior for when the implementation is complete
- Fixtures provide realistic PR graph patterns for validation

# Diffgraph Planner E2E Tests

The `e2e/planner.spec.ts` file contains comprehensive end-to-end tests for the diffgraph planner with dependency auto-discovery:

**Real Repository Scenarios:**

- **Scenario A: Simple Stack** - Linear dependencies (foundation → feature → tests)
- **Scenario B: Diamond Pattern** - Core splits into parallel features, then integrates
- **Scenario C: Mixed Dependencies** - Explicit dependencies (Depends-on:) + implicit via file overlaps
- **Scenario D: File-Overlap Heavy** - Multiple PRs modifying same codebase with no explicit deps
- **Scenario E: Cross-Module** - Independent PRs in different modules with low overlap

**Edge Cases Covered:**

1. **Cycle Detection** - 3 PRs forming circular dependency
2. **Self-Dependency** - PR declaring dependency on itself
3. **Invalid PR Reference** - Dependency on non-existent PR
4. **Stale PR** - Plan includes closed/merged PR
5. **Large Batch** - Stress test with 100+ PRs
6. **Merge Conflicts** - Predicted conflicts from file analysis
7. **Empty Repository** - No open PRs scenario
8. **Single PR** - Single orphan PR handling

**Test Infrastructure:**

- **Fixtures**: `tests/fixtures/planner/*.json` - 11 realistic PR scenarios
- **Helpers**: `tests/helpers/plannerTestHelpers.ts` - Mock creation, fixture loading, assertions
- **Performance Benchmarks**: 10 PRs <1s, 100 PRs <10s
- **Determinism Tests**: Verify identical outputs for same inputs
- **Regression Tests**: Track historical bugs and ensure fixes remain stable

**Test Fixtures:**

- `simple-stack.json` - Linear 3-PR dependency chain
- `diamond-pattern.json` - 4-PR diamond (fan-out/fan-in)
- `mixed-deps.json` - Explicit + implicit dependencies
- `file-overlap-heavy.json` - 5 PRs with file conflicts
- `cross-module.json` - 4 independent module PRs
- `cycle-error.json` - Circular dependency (3 PRs)
- `self-dependency.json` - PR depending on itself
- `invalid-pr.json` - Invalid dependency reference
- `stale-pr.json` - Closed/merged PR in plan
- `empty-repo.json` - No PRs scenario
- `single-pr.json` - Single orphan PR
- `merge-conflicts.json` - High-severity conflict prediction

**Running the tests:**

```bash
# Run all planner E2E tests
npm test -- e2e/planner.spec.ts

# Run specific scenario
npm test -- e2e/planner.spec.ts -t "Simple Stack"
npm test -- e2e/planner.spec.ts -t "Diamond Pattern"
npm test -- e2e/planner.spec.ts -t "Cycle Detection"

# Run performance benchmarks only
npm test -- e2e/planner.spec.ts -t "Performance Benchmarks"

# Run determinism tests only
npm test -- e2e/planner.spec.ts -t "Determinism"
```

**Key Testing Approach:**

- Tests use existing `dependencyParser` and `FileAnalyzer` modules
- Mock GitHub API via `createMockGitHub` helper
- Fixtures contain realistic PR data including file changes
- All tests validate deterministic behavior (same inputs → same outputs)
- File analysis tests verify conflict prediction and dependency suggestions
- Performance tests ensure scalability (100 PRs in <10s)
