# ADR-008: Lex Packaging Strategy

**Status:** Accepted
**Date:** 2026-01-01
**Authors:** LexRunner Team

---

## Context

LexRunner depends on Lex (MIT-licensed core) for memory, policy, atlas, and error handling functionality. The question is how to package and distribute this dependency to ensure:

1. **Stable versioning** — Predictable updates and rollback capability
2. **Security** — Supply chain integrity and provenance
3. **Developer experience** — Simple installation and updates
4. **Licensing clarity** — MIT (Lex) vs. Proprietary (LexRunner) boundaries

Options considered:

1. **npm registry publish** — Publish Lex to public npm registry
2. **Git submodule** — Track Lex as a Git submodule in LexRunner repo
3. **Vendoring** — Copy Lex source into `vendor/lex/` directory

---

## Decision

We adopt **npm registry publish** as the packaging strategy for Lex.

### Implementation

Lex is published to the public npm registry as:

- **Package name:** `@smartergpt/lex`
- **Current version:** `2.1.1` (used by LexRunner)
- **License:** MIT
- **Registry:** https://registry.npmjs.org

LexRunner consumes Lex via standard npm dependency mechanism:

```json
{
  "dependencies": {
    "@smartergpt/lex": "^2.1.1"
  }
}
```

### Export Paths

Lex provides modular exports for selective imports:

- `@smartergpt/lex` — Core exports
- `@smartergpt/lex/types` — Frame types and schemas
- `@smartergpt/lex/errors` — AXError types and utilities
- `@smartergpt/lex/policy` — Policy validation
- `@smartergpt/lex/atlas` — Code atlas and dependency analysis
- `@smartergpt/lex/aliases` — Module ID resolution
- `@smartergpt/lex/logger` — Structured logging

### Versioning Policy

- **Semantic Versioning:** Lex follows semver strictly
  - **MAJOR** — Breaking API changes
  - **MINOR** — New features, backward compatible
  - **PATCH** — Bug fixes, backward compatible
- **LexRunner Pinning:** Use caret range (`^2.1.1`) to allow MINOR/PATCH updates
- **Testing:** CI validates LexRunner against pinned Lex version before merge

---

## Rationale

### Why npm Publish?

1. **Industry Standard** — npm is the standard distribution mechanism for TypeScript/Node.js packages
2. **Dependency Management** — npm/package-lock.json ensures reproducible builds
3. **Security Scanning** — npm audit and GitHub Dependabot provide vulnerability detection
4. **Version Control** — Semantic versioning and package.json constraints prevent breaking changes
5. **Distribution** — Public registry enables community adoption of Lex independently
6. **Build Artifacts** — Published package includes only built `dist/` files, not source

### Why Not Git Submodule?

- **Build Complexity** — Requires building Lex from source during LexRunner build
- **Version Pinning** — Git commit hashes are less discoverable than semver
- **Dependency Resolution** — npm handles transitive dependencies; Git submodules don't
- **Breaking Changes** — Harder to prevent breaking changes from upstream

### Why Not Vendoring?

- **Duplication** — Copies Lex source into LexRunner repo
- **License Violations** — Risk of modifying Lex code without proper attribution
- **Sync Burden** — Manual process to pull upstream changes
- **Security** — No automated vulnerability scanning for vendored code
- **Repo Size** — Increases LexRunner repository size unnecessarily

---

## Consequences

### Positive

- **Simple Updates** — `npm update @smartergpt/lex` to get latest compatible version
- **Security Scanning** — GitHub Dependabot alerts on vulnerabilities in Lex
- **Reproducible Builds** — package-lock.json ensures exact version consistency
- **Clear Licensing** — npm package.json declares MIT license for Lex
- **Public Distribution** — Lex can be adopted independently by other projects
- **Build Artifacts Only** — Published package contains pre-built dist/ files

### Negative

- **Registry Dependency** — Requires npm registry availability for installation
- **Supply Chain Risk** — Potential for npm package hijacking (mitigated by package-lock.json)
- **Version Lag** — LexRunner may lag behind latest Lex releases (intentional for stability)

---

## Security Implications

### Supply Chain

- **Package Integrity** — npm uses SHA-512 integrity hashes in package-lock.json
- **Provenance** — GitHub Actions publishes Lex with provenance attestation
- **Audit Trail** — npm registry provides download and publish audit logs
- **Dependabot** — Automated alerts for known vulnerabilities

### Versioning & Updates

1. **Controlled Updates** — Use caret range (`^2.1.1`) to allow PATCH/MINOR, block MAJOR
2. **Testing Gate** — CI must pass before merging Lex updates
3. **Review Process** — PRs with Lex updates require maintainer approval
4. **Rollback** — Revert package.json change if update breaks LexRunner

### Rollback Strategy

If a Lex update breaks LexRunner:

1. **Immediate Rollback** — Revert package.json to previous version
2. **Lock Specific Version** — Change `^2.1.1` to `2.1.1` to prevent auto-updates
3. **Root Cause Analysis** — Identify breaking change in Lex
4. **Upstream Issue** — File issue in Lex repository
5. **Fix Forward** — Once Lex releases patch, update LexRunner

---

## Update Workflow

### Checking for Updates

Use the provided script to check for Lex updates:

```bash
./scripts/package-lex.sh check
```

### Updating Lex

Manual update process:

```bash
# 1. Check for updates
npm outdated @smartergpt/lex

# 2. Update to latest compatible version
npm update @smartergpt/lex

# 3. Or update to specific version
npm install @smartergpt/lex@2.1.1

# 4. Run tests
npm test

# 5. Commit if tests pass
git add package.json package-lock.json
git commit -m "chore: update @smartergpt/lex to 2.1.1"
```

Automated update (via Dependabot):

1. **Dependabot PR** — GitHub creates PR with Lex update
2. **CI Validation** — Automated tests run
3. **Review** — Maintainer reviews changes
4. **Merge** — Merge if tests pass and no breaking changes

---

## Licensing Documentation

### Lex (MIT)

- **Package:** `@smartergpt/lex`
- **License:** MIT (open source)
- **Attribution:** Required (see NOTICE.md)
- **Repository:** https://github.com/Guffawaffle/lex

### LexRunner (Proprietary)

- **Package:** `lexrunner`
- **License:** UNLICENSED (proprietary)
- **Attribution:** Uses Lex (MIT) as dependency
- **Repository:** https://github.com/Guffawaffle/lexrunner

### License Compliance

LexRunner's license compliance is validated via:

- **CI Gate:** `scripts/check-license-compliance.mjs`
- **Verification:** Ensures proper Lex attribution in NOTICE.md
- **Enforcement:** CI fails if compliance checks fail

---

## Alternatives Considered

### 1. Private npm Registry

**Rejected** — Lex is MIT-licensed and intended for public distribution. Private registry adds unnecessary complexity and limits community adoption.

### 2. Monorepo with Lex

**Rejected** — Separating Lex and LexRunner as independent repositories preserves licensing boundaries and allows independent evolution.

### 3. Inline Lex Code

**Rejected** — Violates DRY principle and creates license compliance issues. LexRunner must consume Lex as a dependency, not duplicate source code.

---

## References

- [Lex npm Package](https://www.npmjs.com/package/@smartergpt/lex)
- [Lex Repository](https://github.com/Guffawaffle/lex)
- [Lex Public API](../LEX_PUBLIC_API.md)
- [License Compliance Guide](../LICENSING.md)
- [ADR-000: Product Naming and Branding](./ADR-000-product-naming-and-branding.md)

---

## Sign-Off

Accepted by: LexRunner Team
Date: 2026-01-01
