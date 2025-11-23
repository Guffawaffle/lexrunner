# WSL2 Safety Guidelines

## Critical Anti-Patterns That Crash VSCode Remote

This document catalogs code patterns that have **repeatedly crashed** the VSCode Remote - WSL server in the lex-pr-runner codebase. These are **not configuration issues** — they are code bugs that must be prevented through explicit guards.

### Historical Context

The lex-pr-runner project has experienced **4+ VSCode Remote crashes** on WSL2, all caused by unbounded filesystem or git operations. Each crash:
- Kills the remote Node.js process
- Requires restarting the VSCode window
- Loses all uncommitted work and terminal state
- Interrupts test execution mid-run

### Root Cause Pattern

WSL2's file system bridge (`/mnt/c` access to Windows drives) has **low tolerance for high-volume operations**. Code that works fine on native Linux or macOS can crash spectacularly on WSL2 when:

1. **Unbounded enumeration** of files/branches/directories
2. **Recursive operations** without depth limits
3. **Process-global handlers** that interfere with VSCode's own file watching
4. **Long-running builds** combined with intensive file watching (vitest, TypeScript compiler)

---

## Forbidden Patterns (WSL2 Crashers)

### ❌ Pattern 1: Unbounded Branch Listing

**Historical Occurrence:** Fixed in commit [TBD] (2025-11-23)

**What Crashed:**
```typescript
// NEVER DO THIS ON WSL2
async cleanup(): Promise<void> {
    const branches = await this.git.branch(['-l']);  // Lists ALL branches globally
    const weaveBranches = branches.all.filter(b => b.startsWith('weave/'));
    // ... iterate and delete
}
```

**Why It Crashed:**
- `git.branch(['-l'])` returns **all branches** in the repo (can be hundreds or thousands)
- On WSL2 with `/mnt/c` repos accessible, this can enumerate cross-drive branches
- The result array `.all` can contain 1000+ entries
- Iterating this array while file watchers are active overwhelms the system
- VSCode Remote Node process runs out of resources and dies

**Correct Pattern:**
```typescript
// ✅ SAFE: Server-side filtering with hard limits
async cleanup(branchPattern: string = 'weave/integration-*'): Promise<void> {
    const MAX_CLEANUP_BRANCHES = 100;  // Hard limit to prevent runaway ops
    
    // Use pattern in git command (server-side filter)
    const result = await this.git.raw(['branch', '--list', branchPattern]);
    const branches = result.trim().split('\n')
        .map(b => b.trim().replace(/^\*\s*/, ''))
        .filter(b => b.length > 0);
    
    // Enforce limit with explicit warning
    if (branches.length > MAX_CLEANUP_BRANCHES) {
        console.warn(`Found ${branches.length} branches, limiting to ${MAX_CLEANUP_BRANCHES}`);
    }
    
    const branchesToDelete = branches.slice(0, MAX_CLEANUP_BRANCHES);
    // ... process only limited set
}
```

**Invariant to Enforce:**
> No git operation shall enumerate more than 100 items without an explicit limit check and user warning.

---

### ❌ Pattern 2: Unbounded Directory Recursion

**Historical Occurrence:** [Not yet occurred in this repo, but known risk]

**What Will Crash:**
```typescript
// NEVER DO THIS ON WSL2
async function findAllPythonFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        if (entry.isDirectory()) {
            files.push(...await findAllPythonFiles(path.join(dir, entry.name)));  // No depth limit
        } else if (entry.name.endsWith('.py')) {
            files.push(path.join(dir, entry.name));
        }
    }
    
    return files;
}
```

**Why It Will Crash:**
- No depth limit means it could traverse `/mnt/c` indefinitely
- Windows system directories can have tens of thousands of files
- Recursive calls without bounds can exhaust stack/memory

**Correct Pattern:**
```typescript
// ✅ SAFE: Bounded depth with workspace scoping
async function findPythonFiles(dir: string, maxDepth: number = 3): Promise<string[]> {
    const MAX_FILES = 1000;  // Safety limit
    const files: string[] = [];
    
    async function search(currentDir: string, depth: number): Promise<void> {
        if (depth > maxDepth || files.length >= MAX_FILES) {
            return;  // Hit limit, stop recursion
        }
        
        // WSL2 Guard: Ensure we're within workspace
        if (!currentDir.startsWith(workspaceRoot)) {
            console.warn(`Skipping ${currentDir}: outside workspace`);
            return;
        }
        
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (files.length >= MAX_FILES) break;
            
            const fullPath = path.join(currentDir, entry.name);
            
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                await search(fullPath, depth + 1);
            } else if (entry.name.endsWith('.py')) {
                files.push(fullPath);
            }
        }
    }
    
    await search(dir, 0);
    return files;
}
```

---

### ❌ Pattern 3: Process-Global File Watchers

**Historical Occurrence:** [Not in this repo, but documented risk]

**What Will Crash:**
```typescript
// NEVER DO THIS (conflicts with VSCode's own watchers)
import chokidar from 'chokidar';

const watcher = chokidar.watch('**/*', {
    persistent: true,
    ignoreInitial: false
});

watcher.on('all', (event, path) => {
    // ... do something
});
```

**Why It Will Crash:**
- VSCode Remote already has extensive file watchers
- Adding another layer of global watchers doubles the load
- WSL2's file system bridge can't handle the throughput
- Leads to cascading failures and process death

**Correct Pattern:**
```typescript
// ✅ SAFE: Scoped, non-persistent watchers with cleanup
import chokidar from 'chokidar';

export async function watchConfigFile(
    filePath: string, 
    callback: () => void
): Promise<() => void> {
    // Only watch specific file, not globs
    const watcher = chokidar.watch(filePath, {
        persistent: false,  // Don't keep process alive
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });
    
    watcher.on('change', callback);
    
    // Return cleanup function
    return () => watcher.close();
}
```

---

## Safe Patterns Checklist

Before committing code that touches files/git/processes, verify:

- [ ] **Explicit bounds** on all loops/recursion (max iterations, max depth)
- [ ] **Workspace scoping** - never traverse outside project root
- [ ] **Server-side filtering** in git commands (use patterns, not client-side `.filter()`)
- [ ] **Hard limits** with warnings (e.g., `MAX_BRANCHES = 100`)
- [ ] **No process-global handlers** (no top-level watchers, no uncaughtException)
- [ ] **Cleanup functions** for any resources (watchers, streams, child processes)

---

## Testing WSL2 Safety

### Regression Test Pattern

```typescript
describe('WSL2 Safety', () => {
    it('should not perform unbounded operations', async () => {
        // Validate explicit limits exist
        const MAX_ALLOWED = 100;
        
        // Mock/simulate large data scenario
        const mockData = Array.from({ length: 500 }, (_, i) => `item-${i}`);
        
        // Operation should self-limit
        const result = await boundedOperation(mockData);
        
        expect(result.length).toBeLessThanOrEqual(MAX_ALLOWED);
    });
    
    it('should warn on excessive data', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        
        // Trigger warning condition
        boundedOperationWithWarning(Array(200).fill('item'));
        
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('limiting to')
        );
    });
});
```

---

## Detection: Am I Running on WSL2?

Use this helper when you need runtime detection:

```typescript
export function isWSL2(): boolean {
    try {
        // Check for WSL-specific markers
        const procVersion = fs.readFileSync('/proc/version', 'utf8');
        return procVersion.toLowerCase().includes('microsoft') || 
               procVersion.toLowerCase().includes('wsl2');
    } catch {
        return false;
    }
}

export function getWorkspaceRoot(): string {
    // Ensure we never operate outside workspace
    const cwd = process.cwd();
    
    // WSL2 Guard: If on /mnt/c, prefer workspace path
    if (cwd.startsWith('/mnt/')) {
        // Use git to find repo root as safer anchor
        const gitRoot = execSync('git rev-parse --show-toplevel', { 
            encoding: 'utf8' 
        }).trim();
        return gitRoot;
    }
    
    return cwd;
}
```

---

## CI/CD Considerations

WSL2 crashes are **local development issues only**. CI runners (GitHub Actions, GitLab CI) use native Linux containers and don't have these constraints.

However, **code that crashes on WSL2 is still bad code** because:
- Unbounded operations are inefficient everywhere
- Lack of limits indicates missing error handling
- Patterns that crash WSL2 will just be slower/riskier on other platforms

**Golden Rule:** If it can crash VSCode on WSL2, it needs bounds and guards.

---

## Monitoring and Alerts

When an operation hits a safety limit, log it clearly:

```typescript
if (items.length > MAX_ITEMS) {
    console.warn(
        `[WSL2-GUARD] Operation attempted to process ${items.length} items ` +
        `(limit: ${MAX_ITEMS}). This would crash on WSL2. ` +
        `Processing first ${MAX_ITEMS} only. ` +
        `See docs/WSL2_SAFETY.md for details.`
    );
}
```

This helps identify:
- When users hit real-world limits
- If limits need adjustment
- Patterns that need optimization

---

## Summary

**The Four Commandments of WSL2-Safe Code:**

1. **NEVER enumerate unbounded collections** (branches, files, directories)
2. **ALWAYS use explicit limits** (MAX_BRANCHES = 100, maxDepth = 3)
3. **ALWAYS scope to workspace root** (no /mnt/c traversal)
4. **ALWAYS warn when limits are hit** (user visibility into guards)

**When in doubt:** Add a limit. Add a warning. Add a test. Add a comment explaining the WSL2 guard.

---

## References

- **Original crash:** `cleanup()` method in `src/git/operations.ts` (fixed 2025-11-23)
- **Regression tests:** `tests/git-operations.test.ts` → "WSL2 Safety - Branch Cleanup"
- **Related:** `.github/copilot-instructions.md` → File Editing Rules section
- **Related:** `AGENTS.md` → Operational Rules section
