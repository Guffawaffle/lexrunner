# Verification Instructions for Copilot Summarization Observation

**Attestation Date:** 2025-12-01  
**Document:** `copilot_summarization_behavior_observation_2025-12-01.md`  
**Evidence:** `copilot_summarization_screenshot_2025-12-01.png`

---

## File Hashes (SHA-256)

```
f6776c3e95a06aed30cb197bacafefda83b964fbb54137aa1fd2f93d887b148f  copilot_summarization_behavior_observation_2025-12-01.md
deb5beb8b751734e95ebc0ed1b24667ed28574ef79d36ba2b45517be552955b4  copilot_summarization_screenshot_2025-12-01.png
```

**Combined hash** (cat md + png | sha256sum):
```
629200ab2029a23c41adfcf7269ef3795079d9c378c950676771c80b752cf052
```

---

## 1. RFC 3161 Timestamp (FreeTSA)

**File:** `timestamp_response.tsr`  
**Authority:** FreeTSA (https://freetsa.org)  
**Timestamp:** Dec 1 10:49:56 2025 GMT  

### Verification

```bash
# Recreate hash file
cat copilot_summarization_behavior_observation_2025-12-01.md \
    copilot_summarization_screenshot_2025-12-01.png | sha256sum | \
    awk '{print $1}' | xxd -r -p > /tmp/hash.bin

# Verify (should print "Verification: OK")
openssl ts -verify -in timestamp_response.tsr -data /tmp/hash.bin \
  -CAfile freetsa_cacert.pem -untrusted freetsa_tsa.crt

# View timestamp details
openssl ts -reply -in timestamp_response.tsr -text
```

---

## 2. Bitcoin Blockchain Timestamp (OpenTimestamps)

**File:** `copilot_summarization_2025-12-01.ots`  
**Calendars:** OpenTimestamps (alice, bob), Catallaxy, EternityWall  
**Status:** Pending Bitcoin block confirmation (typically 1-24 hours)

### Verification

```bash
# Install ots client
pipx install opentimestamps-client

# Verify (will show pending until Bitcoin block confirms)
ots verify copilot_summarization_2025-12-01.ots

# Upgrade proof once confirmed (fetches Bitcoin attestation)
ots upgrade copilot_summarization_2025-12-01.ots

# View timestamp info
ots info copilot_summarization_2025-12-01.ots
```

### What This Proves

Once the Bitcoin block is mined, this timestamp proves the combined hash existed **before** the block timestamp. Bitcoin blocks are immutable public records.

---

## 3. GPG-Signed Git Commit

The original commit `9db7a78` (and subsequent commits) are GPG-signed with Guff's key, providing:
- Cryptographic author verification
- Commit timestamp
- Tamper evidence (any edit changes the hash)

### Verification

```bash
git log --show-signature 9db7a78
```

---

## Summary of Trust Anchors

| Method | Authority | Timestamp | Immutability |
|--------|-----------|-----------|--------------|
| GPG Commit | Guff's key | Dec 1, 2025 | Git history |
| RFC 3161 | FreeTSA (DE) | Dec 1, 10:49:56 UTC | TSA signature |
| Bitcoin | Bitcoin network | Pending block | Blockchain |

All three methods independently prove these files existed on December 1, 2025.
