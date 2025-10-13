# Release Process

This document describes the release and distribution pipeline for lex-pr-runner.

## Overview

The release process is designed to be:
- **Deterministic**: Reproducible builds and consistent versioning
- **Auditable**: Signed tags and changelog tracking
- **Semi-automated**: Critical steps require manual review and approval

## Release Types

### 1. Canary Releases (Automated)

Triggered automatically on every merge to `main`:
- Published to npm with `@canary` tag
- Version format: `0.1.0-canary.{commit-sha}`
- Useful for testing upcoming changes
- Not recommended for production use

### 2. Stable Releases (Manual)

Triggered manually when ready for a stable release:
- Follows semantic versioning (SemVer)
- Published to npm with `@latest` tag
- Includes changelog and signed git tag
- Recommended for production use

## Versioning Strategy

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (0.x.0): New features (backwards compatible)
- **PATCH** (0.0.x): Bug fixes (backwards compatible)

Version bumps are determined automatically from [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` → MINOR bump
- `fix:` → PATCH bump
- `feat!:` or `BREAKING CHANGE:` → MAJOR bump
- Other types (`docs:`, `chore:`, etc.) → PATCH bump (if no other changes)

## Manual Release Workflow

### Prerequisites

1. **GPG key configured** for signing tags:
   ```bash
   git config --global user.signingkey YOUR_KEY_ID
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   ```

2. **npm authentication** configured:
   ```bash
   npm login
   ```

3. **Clean working directory**:
   ```bash
   git status  # Should show no uncommitted changes
   ```

### Steps

#### 1. Run Release Preparation Script

```bash
npm run release:prepare
```

This script will:
- Analyze commits since the last tag
- Determine the next version based on conventional commits
- Update `CHANGELOG.md` with grouped changes
- Update `package.json` version
- Display next steps

#### 2. Review Generated Changes

```bash
git diff CHANGELOG.md package.json
```

Verify:
- Version number is correct
- Changelog entries are accurate and complete
- Breaking changes are clearly marked

#### 3. Commit Release Changes

```bash
git add CHANGELOG.md package.json
git commit -m "chore(release): prepare vX.Y.Z"
```

#### 4. Create Signed Tag

```bash
git tag -s vX.Y.Z -m "Release X.Y.Z"
```

The tag should be **signed** (`-s` flag) for security and authenticity.

To verify the tag signature:
```bash
git tag -v vX.Y.Z
```

#### 5. Push Changes and Tag

```bash
git push origin main
git push origin vX.Y.Z
```

#### 6. Verify CI Pipeline

The GitHub Actions release workflow will automatically:
- Build the package
- Run all tests
- Publish to npm (if configured)
- Create GitHub release

Monitor the workflow at: `https://github.com/Guffawaffle/lex-pr-runner/actions`

#### 7. Create GitHub Release (Optional)

Navigate to: `https://github.com/Guffawaffle/lex-pr-runner/releases/new`

1. Select the tag: `vX.Y.Z`
2. Title: `Release X.Y.Z`
3. Copy changelog entry from `CHANGELOG.md`
4. Attach build artifacts (optional)
5. Publish release

## Automated Release Workflow (GitHub Actions)

### Canary Release (On Main Merge)

```yaml
# Triggered automatically on push to main
on:
  push:
    branches: [main]

jobs:
  canary-release:
    - Build and test
    - Publish to npm with @canary tag
    - Version: {current}-canary.{sha}
```

### Stable Release (Manual Trigger)

```yaml
# Triggered manually via workflow_dispatch
on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  release:
    - Verify tag signature
    - Build and test
    - Publish to npm with @latest tag
    - Create GitHub release
```

## Rollback Procedure

If a release has critical issues:

### 1. Unpublish from npm (if published recently)

```bash
npm unpublish lex-pr-runner@X.Y.Z
```

**Note**: npm only allows unpublishing within 72 hours.

### 2. Deprecate the version

```bash
npm deprecate lex-pr-runner@X.Y.Z "Critical bug - use vX.Y.Z-1 instead"
```

### 3. Delete the Git tag

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

### 4. Revert the release commit

```bash
git revert HEAD  # If release commit is at HEAD
git push origin main
```

### 5. Publish a patch release

Follow the manual release workflow to publish a fixed version.

## Changelog Maintenance

The `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format:

- **[Unreleased]**: Accumulates changes during development
- **[X.Y.Z]**: Released versions with date stamps
- Sections: Added, Changed, Fixed, Deprecated, Removed, Security, Internal

### Manual Changelog Updates

If the automated changelog needs adjustments:

1. Edit `CHANGELOG.md` directly
2. Follow the existing format and conventions
3. Keep entries in reverse chronological order
4. Include commit references where helpful

## CI/CD Integration

### Required Secrets

Configure these in GitHub repository settings:

- `NPM_TOKEN`: npm authentication token for publishing
- `GPG_PRIVATE_KEY`: GPG key for signing (if automated)

### Workflow Permissions

The release workflow requires:

```yaml
permissions:
  contents: write  # For creating releases
  packages: write  # For publishing packages
```

## Troubleshooting

### Tag Signing Fails

```bash
# Verify GPG is configured
git config --get user.signingkey

# List GPG keys
gpg --list-secret-keys

# Test signing
echo "test" | gpg --clearsign
```

### npm Publish Fails

```bash
# Verify authentication
npm whoami

# Check package version
npm view lex-pr-runner versions

# Verify package.json
npm publish --dry-run
```

### Version Conflict

If the calculated version already exists:

1. Check if there are unreleased commits:
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```

2. Manually bump version if needed:
   ```bash
   npm version patch --no-git-tag-version
   ```

3. Update CHANGELOG.md manually

## References

- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [npm Publishing Guide](https://docs.npmjs.com/cli/v9/commands/npm-publish)
- [Git Tag Signing](https://git-scm.com/book/en/v2/Git-Tools-Signing-Your-Work)

## Related Issues

- [#132 Release & Distribution Pipeline](https://github.com/Guffawaffle/lex-pr-runner/issues/132)
