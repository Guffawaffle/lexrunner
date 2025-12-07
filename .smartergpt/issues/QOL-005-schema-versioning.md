# QOL-005: Add Schema Versioning to Governance Logs

**Status**: Open
**Priority**: Low
**Effort**: 1-2 hours
**Category**: Future-proofing

## Context

Following the `plan.json` pattern, governance logs should include explicit schema versions for safe evolution.

## Acceptance Criteria

- [ ] Add `schemaVersion` field to `GovernanceComparisonLog` type
- [ ] Set initial version to `"1.0.0"`
- [ ] Update `createGovernanceComparisonLog()` to include version
- [ ] Add validation in log reader to reject unknown major versions
- [ ] Update existing test fixtures with schema version
- [ ] Document versioning policy in `src/lexsona/types.ts`

## Schema Version Policy

Follow SemVer for governance log schema:
- **Patch (1.0.x)**: Additive optional fields, docs only
- **Minor (1.x.0)**: Additive required fields with safe defaults
- **Major (x.0.0)**: Breaking changes to structure

## Example Log (Updated)

```json
{
  "schemaVersion": "1.0.0",
  "id": "gov-01KBVZN705AQ4PWW024JCDV57C",
  "timestamp": "2025-12-07T08:43:07.654Z",
  "context": { ... },
  "lexsona": { ... },
  "runner": { ... },
  "mode": "shadow"
}
```

## Non-Goals

- Migration scripts for old logs (acceptable to skip)
- Multiple schema support in readers (just validate and fail fast)
