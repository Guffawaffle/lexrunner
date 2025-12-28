# LexSona Shadow Governance: QoL Roadmap

**Generated**: 2025-12-07
**Context**: Post-dogfooding feedback from initial shadow mode integration (Version Contract v0.1)

## Summary

After smoke-testing the LexSona shadow governance integration, we identified 6 quality-of-life improvements to make the tooling production-ready.

## Priority Tiers

### 🔥 High Priority (Do First)

- **QOL-003**: Real-time Console Feedback — Users need immediate visibility into LexSona opinions
  - Effort: 1-2h
  - Impact: Makes shadow mode discoverable during actual runs

### 🟡 Medium Priority (Do Soon)

- **QOL-001**: Analysis Script Filtering & Formatting — Essential for analyzing real logs
  - Effort: 2-3h
  - Impact: Enables useful log exploration

- **QOL-004**: `lex-pr governance:report` CLI — Integrate analysis into main CLI
  - Effort: 3-4h
  - Impact: Makes reports discoverable and professional

### 🟢 Low Priority (Polish)

- **QOL-002**: Log Retention & Cleanup — Prevents unbounded disk growth
  - Effort: 2-4h
  - Impact: Operational hygiene

- **QOL-005**: Schema Versioning — Future-proofs log format
  - Effort: 1-2h
  - Impact: Safe evolution path

- **QOL-006**: Debug Verbose Mode — Troubleshooting support
  - Effort: 2-3h
  - Impact: Easier debugging when things go wrong

## Suggested Execution Order

**Wave 1: Make it visible** (4-5h total)

1. QOL-003: Real-time feedback
2. QOL-001: Filtering & formatting

**Wave 2: Make it professional** (5-6h total) 3. QOL-004: CLI integration 4. QOL-005: Schema versioning

**Wave 3: Make it maintainable** (4-7h total) 5. QOL-006: Debug mode 6. QOL-002: Retention policy

## Total Effort

- **Minimum**: 13 hours (just High + Medium priorities)
- **Complete**: 20 hours (all 6 tickets)

## Next Steps

**Option A: Quick value**

- Implement QOL-003 (console feedback) first
- Run real workflow tests with visible feedback
- Decide on remaining tickets based on actual pain points

**Option B: Complete the foundation**

- Execute Wave 1 → Wave 2 → Wave 3 sequentially
- Results in fully-featured shadow governance system

**Recommendation**: Start with QOL-003 (1-2h) and dogfood it on a real merge-weave run. The immediate feedback will inform whether the other tickets are actually needed.
