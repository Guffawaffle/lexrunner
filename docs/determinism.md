# Determinism Framework

## Why Determinism Matters

Determinism is critical for reproducible merge-weave operations. When the same inputs always produce the same outputs, you can:

- **Trust your automation**: Identical toolchain → identical merge results
- **Debug reliably**: Reproduce issues by matching environment exactly
- **Enable safe CI/CD**: Predictable outcomes in production
- **Collaborate effectively**: Team members get consistent results

## Toolchain Pinning

### Pinned Versions

This project pins the following toolchain versions in `.tool-versions` and `.nvmrc`:

| Tool       | Version | Source                      |
| ---------- | ------- | --------------------------- |
| git        | 2.45.2  | `.tool-versions`            |
| Node.js    | 24      | `.nvmrc` + `.tool-versions` |
| npm        | 11.16.0 | `.tool-versions`            |
| TypeScript | 5.6.3   | `package.json`              |
| ESLint     | 9.10.0  | `package.json`              |

**Note**: This project uses `.editorconfig` for formatting (not Prettier).

### Installing Pinned Versions Locally

#### Option 1: asdf (Recommended)

```bash
# Install asdf: https://asdf-vm.com/guide/getting-started.html

# Install plugins
asdf plugin add nodejs
asdf plugin add git

# Install versions from .tool-versions
asdf install

# Set as global or local
asdf local nodejs 24
asdf local git 2.45.2
```

#### Option 2: mise (asdf alternative)

```bash
# Install mise: https://mise.jdx.dev/getting-started.html

# Install from .tool-versions (automatic)
mise install

# Or manually
mise use node@24
mise use git@2.45.2
```

#### Option 3: nvm (Node.js only)

```bash
# Install nvm: https://github.com/nvm-sh/nvm

# Install Node.js from .nvmrc
nvm install
nvm use

# Install npm separately
npm install -g npm@11.16.0
```

#### Option 4: volta (Node.js only)

```bash
# Install volta: https://volta.sh/

# Pin Node.js version
volta pin node@24
volta pin npm@11.16.0
```

### Verifying Your Toolchain

Check if your local toolchain matches pinned versions:

```bash
lex-pr orchestrate:pin-toolchain --verify
```

Expected output when everything matches:

```
🔧 Toolchain Version Verification

✅ git          2.45.2       (pinned: 2.45.2)
✅ node         24.18.0      (pinned: 24)
✅ npm          11.16.0      (pinned: 11.16.0)
✅ typescript   5.6.3        (pinned: 5.6.3)
✅ eslint       9.10.0       (pinned: 9.10.0)

✅ All toolchain versions match pinned versions
```

Exit codes:

- `0`: All versions match
- `1`: Version mismatch detected

## Environment Variables

Set these environment variables for consistent behavior:

| Variable | Value         | Purpose                                 |
| -------- | ------------- | --------------------------------------- |
| `TZ`     | `UTC`         | Consistent timestamps across timezones  |
| `LANG`   | `en_US.UTF-8` | Consistent locale for sorting/collation |
| `LC_ALL` | `en_US.UTF-8` | Override all locale settings            |

### Local Setup

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
export TZ=UTC
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

### CI Setup

Already configured in `.github/workflows/ci.yml`:

```yaml
env:
  TZ: UTC
  LANG: en_US.UTF-8
  LC_ALL: en_US.UTF-8
```

## Toolchain Manifest

Every merge-weave run records a **toolchain manifest** for audit trails:

```json
{
  "recordedAt": "2025-10-13T02:00:00Z",
  "environment": {
    "TZ": "UTC",
    "LANG": "en_US.UTF-8",
    "NODE_ENV": "production"
  },
  "tools": {
    "git": "2.45.2",
    "node": "24.18.0",
    "npm": "11.16.0",
    "typescript": "5.6.3",
    "eslint": "9.10.0"
  },
  "os": {
    "platform": "linux",
    "release": "6.8.0-49-generic",
    "arch": "x64"
  }
}
```

This manifest is automatically included in deliverables at:
`.smartergpt.local/deliverables/<batch>/toolchain-manifest.json`

## Determinism Gates

The CI pipeline enforces determinism with these checks:

### 1. Build + Format Stability

```bash
npm run build
npm run format
git diff --exit-code  # Must be clean
```

If this fails, it means:

- Generated files (schemas, types) aren't checked in
- Formatting isn't consistent
- Build output varies

**Fix**: Run `npm run build && npm run format` locally and commit changes.

### 2. Plan Generation Determinism

```bash
lex-pr plan --out .artifactsA
lex-pr plan --out .artifactsB
diff -u .artifactsA/plan.json .artifactsB/plan.json  # Must match
```

If this fails, plan generation has non-deterministic behavior (timestamps, UUIDs, randomness).

### 3. Toolchain Version Check

```bash
lex-pr orchestrate:pin-toolchain --verify
# Exit code 0 required
```

If this fails, CI toolchain doesn't match `.tool-versions` or `.nvmrc`.

## Pre-Merge Checklist

Before running a merge-weave:

- [ ] Verify toolchain: `lex-pr orchestrate:pin-toolchain --verify`
- [ ] Check environment variables: `echo $TZ $LANG $LC_ALL`
- [ ] Confirm clean state: `git status` (no uncommitted changes)
- [ ] Run determinism gate: `npm run build && npm run format && git diff --exit-code`

## Reproducibility Test

To verify that the same toolchain produces the same merge:

```bash
# Run 1
lex-pr execute plan.json --dry-run > run1.log

# Run 2 (same environment)
lex-pr execute plan.json --dry-run > run2.log

# Compare
diff -u run1.log run2.log  # Should be identical
```

## Troubleshooting

### Mismatch: Node.js version

```
❌ node         22.22.1      (pinned: 24) [MISMATCH]
```

**Fix**: Install pinned version via nvm/asdf/mise, or update `.nvmrc` if intentional.

### Mismatch: npm version

```
❌ npm          10.9.0       (pinned: 11.16.0) [MISMATCH]
```

**Fix**: `npm install -g npm@11.16.0`

### Mismatch: git version

```
❌ git          2.51.0       (pinned: 2.45.2) [MISMATCH]
```

**Fix**: Install via asdf/mise, or use Docker container with pinned git version.

### TypeScript/ESLint/Prettier mismatch

These are managed by `package.json`. If versions mismatch:

1. Check `package-lock.json` is committed
2. Run `npm ci` (not `npm install`)
3. Verify `package.json` versions match `.tool-versions` comments

## Future Enhancements (Deferred to Phase 2)

### Custom Merge Drivers

Potential `.gitattributes` strategies for deterministic merges:

```gitattributes
# Sort package.json keys alphabetically
package.json merge=package-json-merge

# Union merge for tsconfig.json
tsconfig.json merge=union
```

**Status**: Strategy documented, implementation deferred to future PR.

## Related Documentation

- [Weave Contract](weave-contract.md) - Mechanical weave rules and gates
- [AGENTS.md](../AGENTS.md) - Agent operating principles (Section 5: Gates)
- CI: `.github/workflows/ci.yml` - Determinism gates in action

## Summary

**Reproducibility = Pinned Toolchain + Stable Environment**

1. Install pinned versions: `asdf install` or `mise install`
2. Verify: `lex-pr orchestrate:pin-toolchain --verify`
3. Set environment: `export TZ=UTC LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`
4. Run gates: `npm run build && npm run format && git diff --exit-code`

With this foundation, merge-weave operations are 100% reproducible across machines and time.
