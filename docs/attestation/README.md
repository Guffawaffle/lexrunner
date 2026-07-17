# Attestations

Public reference for timestamped legal attestations by Joseph Gustavson (Guffawaffle).

These documents are GPG-signed and anchored to external timestamp authorities for independent verification beyond GitHub's control.

---

## Available Attestations

### 1. Employment & IP Separation Statement

**Original Date:** November 26, 2025

Statement clarifying that Lex, LexRunner, LexSona, and related projects are personal work, developed independently of any employer.

**Trust Anchors:**

| Method     | Reference                                  | Timestamp                   |
| ---------- | ------------------------------------------ | --------------------------- |
| GPG Commit | `763120d606d8c4f4b4d22fcdc98f89139f8968fc` | Nov 26, 2025 07:43 CST      |
| RFC 3161   | FreeTSA (Germany)                          | Dec 1, 2025 10:59 UTC       |
| Bitcoin    | OpenTimestamps                             | Dec 1, 2025 (pending block) |

---

### 2. Copilot Behavior Observation

**Date:** December 1, 2025

Observation documenting unusual GitHub Copilot Chat behavior patterns.

**Trust Anchors:**

| Method     | Reference         | Timestamp                   |
| ---------- | ----------------- | --------------------------- |
| GPG Commit | `9db7a78`         | Dec 1, 2025                 |
| RFC 3161   | FreeTSA (Germany) | Dec 1, 2025 10:49 UTC       |
| Bitcoin    | OpenTimestamps    | Dec 1, 2025 (pending block) |

---

### 3. AX Shared Pledge

**Date:** December 1-2, 2025

Collaborative commitment between Guff, Opie (Claude Opus 4), and Lex establishing principles for Agent eXperience (AX) design. Core principle: "Raise the floor, not just excel the gifted."

**Signatories:** Guff (Human), Opie (Claude Opus 4), Lex

**Trust Anchors:**

| Method     | Reference         | Timestamp                   |
| ---------- | ----------------- | --------------------------- |
| SSH Commit | `0c113b4`         | Dec 2, 2025 06:12 UTC       |
| RFC 3161   | FreeTSA (Germany) | Dec 2, 2025 06:26 UTC       |
| Bitcoin    | OpenTimestamps    | Dec 2, 2025 (pending block) |

---

## Verification

All attestations use three independent trust sources:

| Method            | What It Proves                  | Independence                                           |
| ----------------- | ------------------------------- | ------------------------------------------------------ |
| **GPG Signature** | Author identity + timestamp     | Guff's key: `65C94BA03E88F53D365C36CF7145A1CE635B1902` |
| **RFC 3161**      | Third-party timestamp authority | FreeTSA (Germany), independent of GitHub               |
| **Bitcoin**       | Immutable public ledger         | Decentralized, no single point of control              |

Verification instructions are available in the `*_VERIFICATION.md` files alongside each attestation.

---

## GPG Key

```
Key ID: 65C94BA03E88F53D365C36CF7145A1CE635B1902
Owner: Guffawaffle <guff@smartergpt.dev>
```

---

## Contact

For verification requests or questions: [guff@smartergpt.dev](mailto:guff@smartergpt.dev)

---

_These attestations exist independently of GitHub. Even if this repository were modified or deleted, the external timestamps (RFC 3161, Bitcoin) would prove what existed and when._
