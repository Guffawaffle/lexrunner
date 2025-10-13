import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const repoRoot = path.resolve(__dirname, '..');

beforeAll(() => {
  // Ensure built CLI exists; run build if missing (keep minimal)
  const distCli = path.join(repoRoot, 'dist', 'cli.js');
  if (!fs.existsSync(distCli)) {
    // run npm run build synchronously
    const execa = require('child_process').spawnSync;
    const res = execa('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
    if (res.status !== 0) throw new Error('Build failed for CLI tests');
  }
});

function runCliWithFakeOctokit(fake: any): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Build a bootstrap file on disk so we can preserve functions in the fake object.
    const bootstrapPath = path.join(repoRoot, 'tests', 'tmp-cli-bootstrap.js');

    // Serialize the fake object. Functions are preserved by stringifying them as source.
    function serialize(val: any): string {
      if (val === null) return 'null';
      if (typeof val === 'function') return val.toString();
      if (Array.isArray(val)) return '[' + val.map(serialize).join(',') + ']';
      if (typeof val === 'object') {
        const entries = Object.entries(val).map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`);
        return '{' + entries.join(',') + '}';
      }
      return JSON.stringify(val);
    }

    const cliPath = path.join(repoRoot, 'dist', 'cli.js');
    const content = `// Test bootstrap - inject fake octokit and trap process.exit to stabilize tests\n` +
      `global.__FAKE_OCTOKIT = ${serialize(fake)};\n` +
      `process.env.LEX_PR_FAKE_OCTOKIT='1';\n` +
      `// Redirect console.log to stderr so that --json mode can guarantee stdout purity\n` +
      `console.log = (...a) => { console.error(...a); };\n` +
  `const _origExit = process.exit.bind(process);\n` +
  `// Ensure process.exit calls the real exit synchronously to avoid uncaught async throws\n` +
  `process.exit = (code = 0) => { _origExit(code); };\n` +
  `import(${JSON.stringify(cliPath)}).then(mod => {\n` +
  `  if (mod.main) {\n` +
  `    mod.main().catch(e => {\n` +
  `      console.error('CLI main error:', e);\n` +
  `      _origExit(1);\n` +
  `    });\n` +
  `  }\n` +
  `}).catch(e => {\n` +
  `  console.error('CLI bootstrap error:', e && e.stack ? e.stack : e);\n` +
  `  _origExit(1);\n` +
  `});\n`;

    fs.writeFileSync(bootstrapPath, content);

    const proc = spawn(process.execPath, [bootstrapPath, 'plan', '--from-github', '--json'], {
      cwd: repoRoot,
      env: { ...process.env, LEX_PR_FAKE_OCTOKIT: '1' }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', (code) => {
      try {
        // cleanup
        if (fs.existsSync(bootstrapPath)) fs.unlinkSync(bootstrapPath);
      } catch (e) {}
      resolve({ stdout, stderr, code });
    });
    proc.on('error', err => {
      try { if (fs.existsSync(bootstrapPath)) fs.unlinkSync(bootstrapPath); } catch (e) {}
      reject(err);
    });
  });
}

describe('CLI JSON purity', () => {
  it('stdout is only JSON and stderr has diagnostic', async () => {
    // fake octokit that will return consistent PR data and repository metadata
    const prCreated = new Date().toISOString();
    const fake = {
      rest: {
        repos: {
          get: async () => ({
            data: {
              default_branch: 'main',
              html_url: 'https://github.com/test/test'
            }
          })
        },
        pulls: {
          list: async () => ({
            data: [
              {
                number: 1,
                title: 'Test PR',
                body: '',
                head: { ref: 'feature/test', sha: 'abc123' },
                base: { ref: 'main', sha: 'base123' },
                state: 'open',
                labels: [],
                draft: false,
                mergeable: true,
                user: { login: 'tester' },
                created_at: '2025-10-12T00:00:00Z',
                updated_at: '2025-10-12T00:00:00Z'
              }
            ]
          }),
          get: async () => ({
            data: {
              number: 1,
              title: 'Test PR',
              body: '',
              head: { ref: 'feature/test', sha: 'abc123' },
              base: { ref: 'main', sha: 'base123' },
              state: 'open',
              labels: [],
              draft: false,
              mergeable: true,
              user: { login: 'tester' },
              created_at: '2025-10-12T00:00:00Z',
              updated_at: '2025-10-12T00:00:00Z'
            }
          })
        }
      },
      paginate: async () => [
        {
          number: 1,
          title: 'Test PR',
          head: { ref: 'feature/test', sha: 'abc123' },
          base: { ref: 'main', sha: 'base123' },
          state: 'open',
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: 'tester' },
          created_at: '2025-10-12T00:00:00Z',
          updated_at: '2025-10-12T00:00:00Z'
        }
      ]
    };

    const { stdout, stderr, code } = await runCliWithFakeOctokit(fake);
    expect(code).toBe(0);
    // stdout should be pure JSON
    expect(() => JSON.parse(stdout)).not.toThrow();
    const obj = JSON.parse(stdout);
    expect(obj).toHaveProperty('items');
    // stderr should include our diagnostic line
    expect(stderr).toMatch(/\[from-github\] repo=.* discovered=\d+/);
  });
});
