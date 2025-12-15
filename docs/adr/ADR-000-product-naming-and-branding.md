# ADR-000: Product Naming and Branding (LexRunner + Lex)

**Date:** November 6, 2025
**Status:** Accepted
**Author:** Go-to-Market Initiative

---

## Context

The lexrunner project serves two audiences with distinct personas:

1. **Paid Product (Proprietary):** Enterprise teams using the merge-weave CLI and merge pyramid orchestration.
2. **Open Source Core (MIT):** Community developers building on architectural policy, frames, and episodic memory.

The current naming conflates both, making it unclear which product is which and which license applies to each component.

---

## Decision

### Product Names

| Product | Brand | Repo | License | Notes |
|---------|-------|------|---------|-------|
| **LexRunner** | `LexRunner` | `Guffawaffle/LexRunner` | Proprietary | Paid product; merge-weave orchestration CLI |
| **Lex** | `Lex` | `Guffawaffle/lex` | MIT | OSS core; frames, memory, policy, atlas |

### CLI Name

- **CLI binary/command:** `lex-pr` remains unchanged (backward compatible).
- **Tagline:** `lex-pr` (powered by LexRunner).
- **Package name (npm, future):** `@guffawaffle/lexrunner` (for the paid product).

### Repository Names

- `Guffawaffle/LexRunner` → Renamed from `lexrunner` to align with branding.
- `Guffawaffle/lex` → Stays as-is (MIT badge + README).

### Release Tag Prefix

- **Canonical tag prefix (starting now):** `lexrunner-v*` (e.g., `lexrunner-v0.1.0`, `lexrunner-v1.0.0`).
- **CI/CD:** `.github/workflows/release.yml` triggers on `lexrunner-v*` tags.
- **Note:** Old `v*` tags may exist; new releases use `lexrunner-v*` exclusively.

---

## Rationale

1. **Clarity:** Distinguishes the paid orchestration layer (LexRunner) from the OSS foundations (Lex).
2. **Portability:** Lex can be adopted independently; LexRunner is built on top of Lex.
3. **Legal/Licensing:** Clear separation eases compliance and customer communication.
4. **Brand Consistency:** "LexRunner" projects a premium, purpose-built identity; "Lex" projects open-source accessibility.
5. **Backward Compatibility:** CLI name (`lex-pr`) does not change; existing scripts continue to work.

---

## Implications

### Immediate (Phase 1)

1. Update `lexrunner/README.md` with LexRunner branding.
2. Update `lex/README.md` with Lex (MIT) branding and cross-reference.
3. Add badges: "Proprietary • Paid" (LexRunner), "MIT • OSS" (Lex).
4. Create `.github/workflows/release.yml` trigger on `lexrunner-v*` tags.

### Near-Term (Phase 2)

1. Update issue templates to use LexRunner/Lex where appropriate.
2. Update docs and references across both repos.
3. Plan first release tag: `lexrunner-v0.1.0`.

### Future (Phase 3)

1. npm package `@guffawaffle/lexrunner` (currently undefined; may remain as-is).
2. Branding assets: logos, website, marketing materials.
3. User documentation split (paid vs. OSS guides).

---

## Consequences

- **Pros:**
  - Clear, memorable branding for both products.
  - Easy to communicate ("LexRunner for enterprise orchestration; Lex for policy foundations").
  - Supports future monetization and licensing strategies.

- **Cons:**
  - Documentation needs updating across both repos.
  - Users unfamiliar with the split may initially be confused.
  - Tag migration from `v*` to `lexrunner-v*` is a one-time maintenance task.

---

## Alternatives Considered

1. **Rename the CLI to `lexrunner-pr`:** Rejected; breaks backward compatibility and adds verbosity.
2. **Rename repos to `lexrunner` and `lex-core`:** Rejected; GitHub repos stable; branding works via docs.
3. **Merge Lex into lexrunner:** Rejected; compromises MIT license and OSS adoption story.

---

## References

- `Guffawaffle/LexRunner` (https://github.com/Guffawaffle/LexRunner)
- `Guffawaffle/lex` (https://github.com/Guffawaffle/lex)
- `docs/TERMS.md` (canonical terminology)
- `.smartergpt/intent.md` (workspace profile example)

---

## Sign-Off

Accepted by: Go-to-Market Team
Date: November 6, 2025
