# Patent Draft Notarization Verification

**Document:** `2025-12-07-shadow-governance-pct-draft.md`
**Title:** Fail-Forward Shadow Governance Telemetry and Analysis
**Inventor:** Joseph M. Gustavson
**Date:** 2025-12-07
**Purpose:** Provisional patent application draft with OpenTimestamps blockchain notarization

---

## Document Integrity Verification

### SHA256 Hash
```bash
sha256sum 2025-12-07-shadow-governance-pct-draft.md
```

**Computed Hash:**
```
7f7e45d5184057395cea4a3afe52b46281d5c333745a39e404c3617548c4da1c
```

### OpenTimestamps Verification
```bash
ots verify 2025-12-07-shadow-governance-pct-draft.md.ots
```

Expected output (after blockchain confirmation):
```
Success! Bitcoin block 87XXXX attests existence as of YYYY-MM-DD HH:MM:SS UTC
```

### Independent Verification

You can independently verify this timestamp proof using:
- OpenTimestamps client: https://opentimestamps.org/
- Web verification: https://opentimestamps.org/ (upload `.ots` file)

---

## Document Summary

This is a **provisional-quality patent draft** for the fail-forward shadow governance telemetry system implemented in lexrunner.

**Key Inventive Elements:**
1. Schema-versioned governance telemetry with semantic versioning
2. Deterministic fail-forward normalization on read path (not write)
3. Explicit uncertainty provenance with structured warnings
4. Automation-safe CLI delegation contract (stdout hygiene, exit-code fidelity)

**Patent Structure:**
- 15 numbered claims (4 independent, 10 dependent, 1 system, 1 combination)
- 5 named invariants for defensibility
- 2 SVG flow diagrams
- Pseudo-code algorithms for normalization and uncertainty roll-up
- Independent analysis by GitHub Copilot (Claude Opus 4.5)

**Filing Recommendation:**
- Suitable for US Provisional Application filing (35 U.S.C. §111(b))
- Estimated cost: $320 (micro entity)
- Priority date established: 2025-12-07
- Nonprovisional deadline: 2025-12-07 + 12 months

---

## Notarization Details

**Timestamp Method:** OpenTimestamps (Bitcoin blockchain anchoring)
**Calendar Servers:**
- https://a.pool.opentimestamps.org
- https://b.pool.opentimestamps.org
- https://a.pool.eternitywall.com
- https://ots.btc.catallaxy.com

**Blockchain:** Bitcoin mainnet
**Confirmation:** Pending (typically 1-6 hours for first confirmation)

**Why This Matters:**
- Establishes **cryptographic proof of existence** at this timestamp
- Cannot be backdated or tampered with
- Provides independent verification of priority date claim
- Complements (but does not replace) formal USPTO filing

---

## Legal Notice

This notarization provides **evidence of document existence** at the timestamp. It does NOT:
- Constitute a legal patent filing
- Grant patent rights
- Replace formal USPTO provisional application filing
- Provide legal advice

**For patent protection:** File a formal provisional application with the USPTO within a reasonable timeframe. This notarization can serve as supporting evidence of conception date.

---

## Verification Log

| Date | Verifier | Result | Notes |
|------|----------|--------|-------|
| 2025-12-07 | GitHub Copilot (initial) | Pending | Awaiting blockchain confirmation |

---

## Related Files

- `2025-12-07-shadow-governance-pct-draft.md` — Patent draft
- `2025-12-07-shadow-governance-pct-draft.md.ots` — OpenTimestamps proof
- `fig1_write_path.svg` — Write path diagram
- `fig2_read_normalize_rollup.svg` — Read/normalize/rollup path diagram

---

**Attestation Chain:**
- Document hash → OpenTimestamps proof → Bitcoin transaction → Bitcoin block → Immutable ledger

**Privacy:** This notarization is **cryptographically provable** but the document content remains private unless disclosed. The Bitcoin blockchain only stores the hash, not the document.
