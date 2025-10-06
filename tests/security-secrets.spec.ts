import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecretsManager, EnvironmentSecretProvider } from '../src/security/secrets';

describe('Security - Secrets Management', () => {
	let secretsManager: SecretsManager;
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		secretsManager = new SecretsManager();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('Environment Secret Provider', () => {
		it('should get secret from environment', async () => {
			process.env.LEX_PR_TEST_SECRET = 'secret-value';
			
			const provider = new EnvironmentSecretProvider();
			const secret = await provider.getSecret('TEST_SECRET');

			expect(secret).toBeDefined();
			expect(secret?.value).toBe('secret-value');
			expect(secret?.metadata.source).toBe('env');
		});

		it('should return null for missing secret', async () => {
			const provider = new EnvironmentSecretProvider();
			const secret = await provider.getSecret('NONEXISTENT');

			expect(secret).toBeNull();
		});

		it('should list available secrets', async () => {
			process.env.LEX_PR_SECRET1 = 'value1';
			process.env.LEX_PR_SECRET2 = 'value2';
			process.env.OTHER_VAR = 'other';

			const provider = new EnvironmentSecretProvider();
			const secrets = await provider.listSecrets();

			expect(secrets).toContain('SECRET1');
			expect(secrets).toContain('SECRET2');
			expect(secrets).not.toContain('OTHER_VAR');
		});

		it('should check if secret exists', async () => {
			process.env.LEX_PR_EXISTS = 'value';

			const provider = new EnvironmentSecretProvider();
			
			expect(await provider.hasSecret('EXISTS')).toBe(true);
			expect(await provider.hasSecret('NOT_EXISTS')).toBe(false);
		});
	});

	describe('Secrets Manager', () => {
		it('should get secret value', async () => {
			process.env.LEX_PR_API_KEY = 'api-key-value';

			const value = await secretsManager.getSecret('API_KEY');
			expect(value).toBe('api-key-value');
		});

		it('should return null for missing secret', async () => {
			const value = await secretsManager.getSecret('MISSING');
			expect(value).toBeNull();
		});

		it('should require secret and throw if missing', async () => {
			await expect(
				secretsManager.requireSecret('REQUIRED_SECRET')
			).rejects.toThrow(/Required secret.*not found/);
		});

		it('should require secret successfully when exists', async () => {
			process.env.LEX_PR_REQUIRED = 'required-value';

			const value = await secretsManager.requireSecret('REQUIRED');
			expect(value).toBe('required-value');
		});

		it('should validate required secrets', async () => {
			process.env.LEX_PR_SECRET1 = 'value1';
			process.env.LEX_PR_SECRET2 = 'value2';

			const result = await secretsManager.validateSecrets([
				'SECRET1',
				'SECRET2',
				'MISSING'
			]);

			expect(result.valid).toBe(false);
			expect(result.missing).toEqual(['MISSING']);
		});

		it('should validate all secrets present', async () => {
			process.env.LEX_PR_SECRET1 = 'value1';
			process.env.LEX_PR_SECRET2 = 'value2';

			const result = await secretsManager.validateSecrets([
				'SECRET1',
				'SECRET2'
			]);

			expect(result.valid).toBe(true);
			expect(result.missing).toEqual([]);
		});
	});

	describe('GitHub Token Handling', () => {
		it('should get GitHub token from GITHUB_TOKEN', async () => {
			process.env.GITHUB_TOKEN = 'github-token';

			const token = await secretsManager.getGitHubToken();
			expect(token).toBe('github-token');
		});

		it('should get GitHub token from GH_TOKEN', async () => {
			delete process.env.GITHUB_TOKEN;
			process.env.GH_TOKEN = 'gh-token';

			const token = await secretsManager.getGitHubToken();
			expect(token).toBe('gh-token');
		});

		it('should get GitHub token from GITHUB_PAT', async () => {
			delete process.env.GITHUB_TOKEN;
			delete process.env.GH_TOKEN;
			process.env.GITHUB_PAT = 'pat-token';

			const token = await secretsManager.getGitHubToken();
			expect(token).toBe('pat-token');
		});

		it('should prefer GITHUB_TOKEN over others', async () => {
			process.env.GITHUB_TOKEN = 'github-token';
			process.env.GH_TOKEN = 'gh-token';
			process.env.GITHUB_PAT = 'pat-token';

			const token = await secretsManager.getGitHubToken();
			expect(token).toBe('github-token');
		});
	});

	describe('Secret Redaction', () => {
		it('should redact secret from text', () => {
			const text = 'The API key is secret-123 and should be hidden';
			const redacted = secretsManager.redactSecret(text, 'secret-123');

			expect(redacted).toBe('The API key is ***REDACTED*** and should be hidden');
			expect(redacted).not.toContain('secret-123');
		});

		it('should handle multiple occurrences', () => {
			const text = 'secret-123 appears twice: secret-123';
			const redacted = secretsManager.redactSecret(text, 'secret-123');

			expect(redacted).toBe('***REDACTED*** appears twice: ***REDACTED***');
		});

		it('should handle empty secret value', () => {
			const text = 'No secret here';
			const redacted = secretsManager.redactSecret(text, '');

			expect(redacted).toBe('No secret here');
		});
	});

	describe('Cache Management', () => {
		it('should cache secrets', async () => {
			process.env.LEX_PR_CACHED = 'cached-value';

			const value1 = await secretsManager.getSecret('CACHED');
			const value2 = await secretsManager.getSecret('CACHED');

			expect(value1).toBe(value2);
			expect(value1).toBe('cached-value');
		});

		it('should clear cache', async () => {
			process.env.LEX_PR_CACHED = 'value';

			await secretsManager.getSecret('CACHED');
			secretsManager.clearCache();

			// After clearing, should fetch again
			const value = await secretsManager.getSecret('CACHED');
			expect(value).toBe('value');
		});
	});

	describe('Plan Secrets Scanner', () => {
		let scanner: any; // PlanSecretsScanner - using any for dynamic import

		beforeEach(async () => {
			const { PlanSecretsScanner } = await import('../src/security/secrets.js');
			scanner = new PlanSecretsScanner();
		});

		it('should detect GitHub tokens', () => {
			const content = 'Using token ghp_1234567890abcdefghijklmnopqrstuvwxyz in config';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].pattern.name).toBe('github_token');
			expect(detected[0].value).toContain('***');
		});

		it('should detect AWS access keys', () => {
			const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].pattern.name).toBe('aws_access_key');
		});

		it('should detect private keys', () => {
			const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].pattern.name).toBe('private_key');
		});

		it('should detect Slack tokens', () => {
			const content = 'SLACK_TOKEN=xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].pattern.name).toBe('slack_token');
		});

		it('should detect JWT tokens', () => {
			const content = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].pattern.name).toBe('jwt_token');
		});

		it('should provide line and column information', () => {
			const content = 'line 1\nline 2 ghp_1234567890abcdefghijklmnopqrstuvwxyz\nline 3';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(1);
			expect(detected[0].line).toBe(2);
			expect(detected[0].column).toBeGreaterThan(0);
		});

		it('should redact detected secrets', () => {
			const content = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
			const detected = scanner.scanText(content);

			expect(detected[0].value).not.toContain('1234567890abcdefghijklmnopqrstuvwxyz');
			expect(detected[0].value).toContain('***');
		});

		it('should scan JSON objects', () => {
			const obj = {
				config: {
					token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
					api_key: 'AKIAIOSFODNN7EXAMPLE'
				}
			};

			const detected = scanner.scanObject(obj);

			expect(detected.length).toBeGreaterThanOrEqual(2);
		});

		it('should handle clean content with no secrets', () => {
			const content = 'This is clean content with no secrets';
			const detected = scanner.scanText(content);

			expect(detected).toHaveLength(0);
		});

		it('should generate report for detected secrets', () => {
			const content = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
			const detected = scanner.scanText(content);
			const report = scanner.generateReport(detected);

			expect(report).toContain('Found 1 potential secret');
			expect(report).toContain('github_token');
			expect(report).toContain('GitHub Personal Access Token');
		});

		it('should generate clean report when no secrets', () => {
			const detected: any[] = [];
			const report = scanner.generateReport(detected);

			expect(report).toContain('✅ No secrets detected');
		});

		it('should detect multiple different secret types', () => {
			const content = `
				token: ghp_1234567890abcdefghijklmnopqrstuvwxyz
				aws_key: AKIAIOSFODNN7EXAMPLE
				slack: xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx
			`;
			const detected = scanner.scanText(content);

			expect(detected.length).toBeGreaterThanOrEqual(3);
			const types = detected.map(d => d.pattern.name);
			expect(types).toContain('github_token');
			expect(types).toContain('aws_access_key');
			expect(types).toContain('slack_token');
		});

		it('should provide context for detected secrets', () => {
			const content = 'config.token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";';
			const detected = scanner.scanText(content);

			expect(detected[0].context).toBeDefined();
			expect(detected[0].context).toContain('***');
		});
	});
});
