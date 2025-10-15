# Audit compliance profiles (quick reference)

This page explains the audit logging profiles supported by the runner, how HIPAA‑strict encryption and PHI redaction work, and quick examples for running and decrypting audit artifacts.

## Profiles

- `off` — no audit artifacts are produced.
- `basic` — lightweight events (command invocation, high-level plan events). No PHI redaction, no encryption by default.
- `soc2` — richer audit artifacts (gate events, manifest, summary, gate matrix). Intended for SOC2-style retention and review.
- `hipaa-strict` — same artifacts as `soc2` plus PHI redaction enabled by default and optional at-rest encryption when a key is provided.

## Keying and precedence

- The runner accepts an optional AES-256-GCM encryption key as a 64‑hex character string (32 bytes). Example env var:

```bash
export LEX_AUDIT_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

- CLI precedence: explicit CLI options (if/when implemented) will override the environment variable. Currently the runner reads `LEX_AUDIT_KEY_HEX` at emitter init.
- The code accepts exactly 64 hex characters; anything else will skip encryption and log a safe warning. No plaintext key material is ever logged.

## Encryption format

- Algorithm: AES-256-GCM
- Key: 32 bytes (provided as 64 hex chars)
- IV (nonce): 12 bytes, randomly generated per file
- Auth tag: 16 bytes
- File layout (as written by the emitter):

```
[ iv (12 bytes) | auth-tag (16 bytes) | ciphertext (remaining bytes) ]
```

- The manifest (`audit-manifest.json`) records artifact file names and hashes; signatures (`audit.sig`) are generated as a Phase‑2 stub for now but are written alongside the encrypted artifact.

## PHI redaction

- For `hipaa-strict`, PHI redaction is enabled before any payload is written to disk. Redaction uses opt-in regular expressions and structured redaction helpers; when redaction detects content, the event payload will include `_phi_redacted=true` to indicate the redaction occurred.

## Fail-closed semantics (recommended)

- Current behavior: encryption is best-effort when a valid key is present. If encryption fails during finalize, the emitter logs a safe error and (where possible) removes plaintext and writes a summary/manifest. For stricter requirements (mandatory for `hipaa-strict`), you may opt to treat encryption errors as fatal and exit non-zero — we can enable this behavior if desired.

## Decryption helper (node)

Use the following snippet to decrypt an `audit.ndjson.enc` file created by the runner. It expects the file layout described above.

```js
// decrypt-audit.js
import fs from 'fs';
import crypto from 'crypto';

const keyHex = process.env.LEX_AUDIT_KEY_HEX;
if (!keyHex || keyHex.length !== 64) throw new Error('Provide LEX_AUDIT_KEY_HEX (64 hex chars)');
const key = Buffer.from(keyHex, 'hex');

const buf = fs.readFileSync('audit.ndjson.enc');
const iv = buf.slice(0, 12);
const tag = buf.slice(12, 28);
const ciphertext = buf.slice(28);

const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
process.stdout.write(plain.toString('utf8'));
```

Run it with:

```bash
LEX_AUDIT_KEY_HEX=0123... node decrypt-audit.js > audit.ndjson
```

## Quick run examples

Without key (no encryption):

```bash
node dist/cli.js execute --audit hipaa-strict --audit-dir ./tmp-audit-hipaa --dry-run --plan examples/sample-plan.json
ls -1 ./tmp-audit-hipaa
# Expect: audit.ndjson, audit.schema.json, audit-summary.json, audit-manifest.json, audit-gate-matrix.json
```

With key (encrypted artifact):

```bash
export LEX_AUDIT_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
rm -rf ./tmp-audit-hipaa-enc
node dist/cli.js execute --audit hipaa-strict --audit-dir ./tmp-audit-hipaa-enc --dry-run --plan examples/sample-plan.json
ls -1 ./tmp-audit-hipaa-enc
# Expect: audit.ndjson.enc, audit.schema.json, audit-summary.json, audit-manifest.json, audit-gate-matrix.json, audit.sig
```

## Next steps and ops notes

- If you want strict fail‑closed behavior (exit non‑zero on encryption failure and remove plaintext), I can update the finalization logic to enforce that for `hipaa-strict`.
- I can add a small `lex-pr audit decrypt` helper command and/or a Vitest integration that verifies encrypted artifact creation and plaintext cleanup.
