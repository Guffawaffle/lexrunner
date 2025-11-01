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

    // Fail-closed: expect exit code 2 and audit.error.json present, no plaintext
    expect(r.status).toBe(2);
    const ndjsonPath = path.join(tmpBad, 'audit.ndjson');
    const errPath = path.join(tmpBad, 'audit.error.json');
    expect(fs.existsSync(ndjsonPath)).toBe(false);
    expect(fs.existsSync(errPath)).toBe(true);
  });

  test('without key should fail-closed (exit 2) and write audit.error.json', () => {
    const env = { ...process.env };
    delete env.LEX_AUDIT_KEY_HEX;

    const r = spawnSync('node', [DIST_CLI, 'execute', '--audit', 'hipaa-strict', '--audit-dir', tmpNoKey, '--dry-run', '--plan', 'examples/sample-plan.json'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status).toBe(2);

    const ndjsonPath = path.join(tmpNoKey, 'audit.ndjson');
    const errPath = path.join(tmpNoKey, 'audit.error.json');

    expect(fs.existsSync(ndjsonPath)).toBe(false);
    expect(fs.existsSync(errPath)).toBe(true);
  });
});
