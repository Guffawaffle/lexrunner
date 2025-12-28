# Verification Instructions for Employment Separation Attestation

**Original Attestation Date:** 2025-11-26
**Timestamp Anchoring Date:** 2025-12-01
**Document:** `lex_employment_separation_2025-11-26.md`

---

## Document History

This document was created and GPG-signed on **November 26, 2025**.

On **December 1, 2025**, external timestamp proofs were added to anchor the document to independent authorities, preserving both:

1. The original Git/GPG timestamp (Nov 26, 2025)
2. New RFC 3161 and Bitcoin timestamps (Dec 1, 2025)

---

## File Hash (SHA-256)

**After addendum (timestamped version):**

```
b4f5b227f0185cc07a6bd04c46ab319a8b2996c29a481eec25013e93221cb6cd
```

**Original (before addendum):**

```
564ee084775ad503cd9d7e16aaa6ceea4df66310c00aae27a953f63a5326e064
```

---

## 1. Original GPG-Signed Git Commit (Nov 26, 2025)

**Commit:** `763120d606d8c4f4b4d22fcdc98f89139f8968fc`
**Date:** Wed Nov 26 07:43:33 2025 CST
**GPG Key:** `65C94BA03E88F53D365C36CF7145A1CE635B1902`
**Signer:** Guffawaffle <guff@smartergpt.dev>

### Verification

```bash
# Verify the original commit signature
git log --show-signature -1 763120d

# View the original file content at that commit
git show 763120d:docs/attestation/lex_employment_separation_2025-11-26.md
```

---

## 2. RFC 3161 Timestamp (FreeTSA) - Dec 1, 2025

**File:** `employment_timestamp_response.tsr`
**Authority:** FreeTSA (https://freetsa.org)
**Timestamp:** Dec 1, 10:59:42 2025 UTC

### Verification

```bash
cd docs/attestation

# Recreate the hash
HASH=$(sha256sum lex_employment_separation_2025-11-26.md | awk '{print $1}')
echo -n "$HASH" | xxd -r -p > /tmp/verify_hash.bin

# Verify (should print "Verification: OK")
openssl ts -verify -in employment_timestamp_response.tsr -data /tmp/verify_hash.bin \
  -CAfile freetsa_cacert.pem -untrusted freetsa_tsa.crt

# View timestamp details
openssl ts -reply -in employment_timestamp_response.tsr -text
```

---

## 3. Bitcoin Blockchain Timestamp (OpenTimestamps) - Dec 1, 2025

**File:** `employment_separation_2025-11-26.ots`
**Calendars:** OpenTimestamps (alice, bob), Catallaxy, EternityWall
**Status:** Pending Bitcoin block confirmation (typically 1-24 hours)

### Verification

```bash
# Install ots client if needed
pipx install opentimestamps-client

# Verify (will show pending until Bitcoin block confirms)
ots verify employment_separation_2025-11-26.ots

# Upgrade proof once confirmed (fetches Bitcoin attestation)
ots upgrade employment_separation_2025-11-26.ots

# View timestamp info
ots info employment_separation_2025-11-26.ots
```

---

## Summary of Trust Anchors

| Method     | Authority       | Timestamp              | What It Proves                 |
| ---------- | --------------- | ---------------------- | ------------------------------ |
| GPG Commit | Guff's key      | Nov 26, 2025 07:43 CST | Original document creation     |
| RFC 3161   | FreeTSA (DE)    | Dec 1, 2025 10:59 UTC  | Document existed at this time  |
| Bitcoin    | Bitcoin network | Pending block          | Immutable public ledger anchor |

---

## Attestation Chain

1. **Nov 26, 2025:** Original attestation created and GPG-signed in commit `763120d`
2. **Dec 1, 2025:** Addendum added documenting the original timestamp
3. **Dec 1, 2025:** RFC 3161 timestamp obtained from FreeTSA
4. **Dec 1, 2025:** Bitcoin timestamp submitted to OpenTimestamps calendars
5. **Pending:** Bitcoin block confirmation (immutable anchor)

This creates a verifiable chain showing:

- The document was **originally created** on Nov 26, 2025 (GPG commit)
- The author **re-attested** the original date on Dec 1, 2025
- Independent authorities **confirm** the Dec 1 re-attestation timestamp
