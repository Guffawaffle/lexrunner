# Patent Attestations

This directory contains patent-related documents with blockchain-anchored timestamps for establishing priority dates and proof of conception.

## Files

### Patent Draft
- **`2025-12-07-shadow-governance-pct-draft.md`** — Provisional-quality patent application draft
- **`2025-12-07-shadow-governance-pct-draft.md.ots`** — OpenTimestamps blockchain proof
- **`2025-12-07-shadow-governance-pct-draft_VERIFICATION.md`** — Verification instructions and metadata

### Supporting Diagrams
- **`fig1_write_path.svg`** — System architecture diagram (write path)
- **`fig2_read_normalize_rollup.svg`** — Flow diagram (read/normalize/uncertainty rollup path)

## What This Provides

### Cryptographic Proof of Existence
The OpenTimestamps (`.ots`) file provides **cryptographically verifiable proof** that the patent draft existed at the timestamp recorded in the Bitcoin blockchain. This proof:

- ✅ Cannot be backdated
- ✅ Cannot be tampered with
- ✅ Is independently verifiable by anyone
- ✅ Does not reveal document contents (only the hash is public)

### Priority Date Evidence
While this notarization **does not replace** a formal USPTO patent filing, it provides:
- Supporting evidence of conception date
- Proof of document existence at a specific timestamp
- Independent verification mechanism
- Protection against later claims of prior art

## Verification Instructions

### Quick Verification
```bash
cd /srv/lex-mcp/lexrunner/docs/attestation/patent

# Verify document hash
sha256sum 2025-12-07-shadow-governance-pct-draft.md

# Verify timestamp (after blockchain confirmation, ~1-6 hours)
ots verify 2025-12-07-shadow-governance-pct-draft.md.ots
```

### Web Verification
Upload the `.ots` file to https://opentimestamps.org/ for web-based verification.

## Legal Notice

⚠️ **Important:** This notarization is **NOT** a patent filing. To obtain patent protection:
1. File a formal **US Provisional Application** with the USPTO (35 U.S.C. §111(b))
2. Within 12 months, file a nonprovisional application or PCT application
3. Consult with a registered patent attorney

This notarization serves as **supplementary evidence** only.

## Privacy

The document contents remain **private**. Only the SHA256 hash is recorded in the Bitcoin blockchain. The full document is stored locally and is not publicly accessible unless explicitly disclosed.

---

**Patent Subject:** Fail-Forward Shadow Governance Telemetry and Analysis
**Inventor:** Joseph M. Gustavson
**Priority Date Established:** 2025-12-07 (via OpenTimestamps)
**Status:** Notarized, pending formal USPTO filing
