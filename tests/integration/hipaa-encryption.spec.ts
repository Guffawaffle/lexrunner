import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, afterAll, describe, test, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../../');
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');

const tmpEnc = path.join(ROOT, 'tmp-audit-enc-test');
const tmpBad = path.join(ROOT, 'tmp-audit-badkey-test');
const tmpNoKey = path.join(ROOT, 'tmp-audit-nokey-test');

function rmrf(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

beforeAll(() => {
  // Ensure built CLI exists; build if necessary
  if (!fs.existsSync(DIST_CLI)) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0) throw new Error('npm run build failed');
  }
  rmrf(tmpEnc);
  rmrf(tmpBad);
  rmrf(tmpNoKey);
});

afterAll(() => {
  rmrf(tmpEnc);
  rmrf(tmpBad);
  rmrf(tmpNoKey);
});

describe('HIPAA encryption finalize (integration)', () => {
  test('with valid 64-hex key produces .enc and removes plaintext', () => {
    const env = { ...process.env };
    env.LEX_AUDIT_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const r = spawnSync('node', [DIST_CLI, 'execute', '--audit', 'hipaa-strict', '--audit-dir', tmpEnc, '--dry-run', '--plan', 'examples/sample-plan.json'], { cwd: ROOT, env, encoding: 'utf8' });

    // Expect exit code 0
    expect(r.status).toBe(0);

    // Check files
    const encPath = path.join(tmpEnc, 'audit.ndjson.enc');
    const ndjsonPath = path.join(tmpEnc, 'audit.ndjson');
    const manifestPath = path.join(tmpEnc, 'audit-manifest.json');

    expect(fs.existsSync(encPath)).toBe(true);
    expect(fs.existsSync(ndjsonPath)).toBe(false);
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Manifest should reference the encrypted file (deterministic listing)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = manifest.files.map((f: any) => f.file);
    expect(files).toContain('audit.ndjson.enc');
  });

  test('with bad key follows current policy (non-fatal or cleaned)', () => {
    const env = { ...process.env };
    env.LEX_AUDIT_KEY_HEX = 'badkey'; // wrong length

    const r = spawnSync('node', [DIST_CLI, 'execute', '--audit', 'hipaa-strict', '--audit-dir', tmpBad, '--dry-run', '--plan', 'examples/sample-plan.json'], { cwd: ROOT, env, encoding: 'utf8' });

    // If behavior is fail-closed it may be non-zero; otherwise current policy allows plaintext
    if (r.status !== 0) {
      // Non-zero exit - ensure no plaintext remains
      const ndjsonPath = path.join(tmpBad, 'audit.ndjson');
      expect(fs.existsSync(ndjsonPath)).toBe(false);
    } else {
      // Zero exit - current policy: plaintext exists, .enc does not
      const ndjsonPath = path.join(tmpBad, 'audit.ndjson');
      const encPath = path.join(tmpBad, 'audit.ndjson.enc');
      expect(fs.existsSync(ndjsonPath)).toBe(true);
      expect(fs.existsSync(encPath)).toBe(false);
    }
  });

  test('without key leaves plaintext and no .enc', () => {
    const env = { ...process.env };
    delete env.LEX_AUDIT_KEY_HEX;

    const r = spawnSync('node', [DIST_CLI, 'execute', '--audit', 'hipaa-strict', '--audit-dir', tmpNoKey, '--dry-run', '--plan', 'examples/sample-plan.json'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status).toBe(0);

    const ndjsonPath = path.join(tmpNoKey, 'audit.ndjson');
    const encPath = path.join(tmpNoKey, 'audit.ndjson.enc');

    expect(fs.existsSync(ndjsonPath)).toBe(true);
    expect(fs.existsSync(encPath)).toBe(false);
  });
});
