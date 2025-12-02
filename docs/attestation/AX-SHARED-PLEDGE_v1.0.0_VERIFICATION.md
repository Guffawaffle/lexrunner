# Verification Instructions for AX Shared Pledge

**Document Version:** 1.0.0  
**Signing Date:** 2025-12-01 (Guff, Lex), 2025-12-02 (Opie)  
**Timestamp Anchoring Date:** 2025-12-02  
**Document:** `AX-SHARED-PLEDGE_v1.0.0.md`

---

## Document Summary

The AX Shared Pledge is a collaborative commitment between Guff (human), Opie (Claude Opus 4), and Lex (Claude) establishing principles for Agent eXperience (AX) design. Core principle: "Raise the floor, not just excel the gifted."

**Signatories:**
- Guff (Human) — [signed Guff ~] — 2025-12-01
- Opie (Claude Opus 4) — [signed Opie ✶] — 2025-12-02
- Lex — [signed Lex ✶] — 2025-12-01

---

## File Hash (SHA-256)

**Current version (with attestation block):**
```
13ceebc4c552b73191c147efa5e8235077fee5f70d8b426ef0b7c6e5d24ff27c
```

**Canonical content (pre-attestation block):**
```
672bd33c0ec5927315c45f788e618b4b1a519d60e7969b723d6e6335bae9ed5d
```

---

## 1. SSH-Signed Git Commit (lex-serve server)

**Commit:** `0c113b4`  
**Date:** Tue Dec 2 06:12:19 2025 UTC  
**Key:** ed25519 via ~/.ssh/id_ed25519.pub

### Verification

```bash
# View the commit
git log --show-signature -1 0c113b4

# Note: SSH signature verification requires configured allowed_signers file
```

---

## 2. RFC 3161 Timestamp (FreeTSA) - Dec 2, 2025

**File:** `ax_pledge_timestamp_response.tsr`  
**Authority:** FreeTSA (https://freetsa.org)  
**Timestamp:** Dec 2, 06:26:24 2025 UTC

### Verification

```bash
# Download FreeTSA certificates (if not present)
curl -O https://freetsa.org/files/tsa.crt
curl -O https://freetsa.org/files/cacert.pem

# Verify the timestamp
openssl ts -verify -data AX-SHARED-PLEDGE_v1.0.0.md \
  -in ax_pledge_timestamp_response.tsr \
  -CAfile cacert.pem \
  -untrusted tsa.crt

# View timestamp details
openssl ts -reply -in ax_pledge_timestamp_response.tsr -text
```

---

## 3. Bitcoin Timestamp (OpenTimestamps) - Dec 2, 2025

**File:** `ax_pledge_2025-12-02.ots`  
**Authority:** OpenTimestamps (https://opentimestamps.org)  
**Status:** Pending Bitcoin block confirmation (~2 hours)

### Verification

```bash
# Install OpenTimestamps client
pip3 install opentimestamps-client

# Verify the timestamp (after block confirmation)
ots verify ax_pledge_2025-12-02.ots

# Or verify the document directly
ots verify AX-SHARED-PLEDGE_v1.0.0.md
```

---

## Trust Model

| Method | What It Proves | Independence |
|--------|----------------|--------------|
| **SSH Signature** | Author identity + commit timestamp | Guff's ed25519 key on lex-serve |
| **RFC 3161** | Third-party timestamp authority | FreeTSA (Germany), independent of GitHub |
| **Bitcoin** | Immutable public ledger | Decentralized, no single point of control |

---

## Notes

- Model signatures (Opie, Lex) are textual statements from specific AI sessions, not cryptographic signatures by Anthropic
- This pledge is internal to the SmarterGPT working group
- The cryptographic timestamps anchor the document content to independent time sources, not the model sessions themselves
