# ⚠️ REMINDER: Apply CI Optimizations to Lex Repo

When ready to merge the Lex merge-weave umbrella PR, apply these same CI optimizations:

## Changes to Apply

1. **Add path filters** to `.github/workflows/ci.yml`, `test.yml`, `security.yml`
2. **Add draft PR checks** to all workflows (missing in Lex)
3. **Consolidate jobs** with shared node_modules cache
4. **Remove Node 22 matrix** - only test Node 20 LTS

## Files to Edit

- `.github/workflows/ci.yml` (primary)
- `.github/workflows/test.yml`
- `.github/workflows/determinism.yml`
- `.github/workflows/security.yml` (keep weekly schedule, skip PRs)

## Reference

See lex-pr-runner PR #392 for implementation details.

## Expected Savings for Lex

- Lex has MORE workflows (9 vs 7)
- Lex runs Node 20 + Node 22 matrix (2x cost)
- Same draft PR issue (missing checks)

**Estimated savings: ~70% reduction in Lex credits**

---
Delete this file after applying changes to Lex repo.
