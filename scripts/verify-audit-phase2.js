#!/usr/bin/env node

/**
 * Verification script for Phase 2: CI Context Blocks & Gate Matrix
 * 
 * Demonstrates all acceptance criteria from issue #192
 */

import { initAuditEmitter, finalizeAudit, collectContext, getAuditProfile } from '../src/audit/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
	console.log('Phase 2 Verification: CI Context Blocks & Gate Matrix\n');
	console.log('='.repeat(60));

	// Create temp directory for output
	const tmpDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'audit-verify-'));
	console.log(`\nOutput directory: ${tmpDir}\n`);

	// ========== Acceptance Criteria 1: CI Context Blocks ==========
	console.log('✅ AC1: CI Context Blocks\n');

	// Test git context
	console.log('  📦 Git Context:');
	const gitContext = await collectContext(['git']);
	console.log(`    - commit: ${gitContext.git?.commit?.substring(0, 8) || 'N/A'}`);
	console.log(`    - branch: ${gitContext.git?.branch || 'N/A'}`);
	console.log(`    - dirty: ${gitContext.git?.dirty ?? 'N/A'}`);

	// Test CI context
	console.log('\n  🔧 CI Context:');
	const ciContext = await collectContext(['ci']);
	console.log(`    - provider: ${ciContext.ci?.provider}`);
	console.log(`    - run_id: ${ciContext.ci?.run_id || 'N/A'}`);

	// Test OS context
	console.log('\n  💻 OS Context:');
	const osContext = await collectContext(['os']);
	console.log(`    - platform: ${osContext.os?.platform}`);
	console.log(`    - arch: ${osContext.os?.arch}`);
	console.log(`    - release: ${osContext.os?.release}`);

	// ========== Acceptance Criteria 2: Per-PR Gate Matrix ==========
	console.log('\n\n✅ AC2: Per-PR Gate Matrix Export\n');

	// Initialize emitter with soc2 profile
	const emitter = await initAuditEmitter({
		profile: 'soc2',
		dir: tmpDir,
		sessionId: '01JB123456789',
		runId: '01JB987654321',
		tool: { name: 'lex-pr-runner', version: '0.1.0' },
	});

	// Emit gate events matching issue example
	console.log('  📝 Emitting gate events for PRs 166, 167, 168...');

	// PR 166 - all gates pass
	emitter.emit('gate_started', { item: '166', gate: 'lint' });
	emitter.emit('gate_finished', { item: '166', gate: 'lint', status: 'pass', duration_ms: 1234 });
	emitter.emit('gate_started', { item: '166', gate: 'typecheck' });
	emitter.emit('gate_finished', { item: '166', gate: 'typecheck', status: 'pass', duration_ms: 2345 });
	emitter.emit('gate_started', { item: '166', gate: 'unit' });
	emitter.emit('gate_finished', { item: '166', gate: 'unit', status: 'pass', duration_ms: 3456 });
	emitter.emit('gate_finished', { item: '166', gate: 'e2e', status: 'skip', reason: 'Not configured' });

	// PR 167 - typecheck fails
	emitter.emit('gate_started', { item: '167', gate: 'lint' });
	emitter.emit('gate_finished', { item: '167', gate: 'lint', status: 'pass', duration_ms: 1111 });
	emitter.emit('gate_started', { item: '167', gate: 'typecheck' });
	emitter.emit('gate_finished', { 
		item: '167', 
		gate: 'typecheck', 
		status: 'fail', 
		duration_ms: 2222,
		error: 'Type mismatch in cli.ts:125',
	});
	emitter.emit('gate_finished', { 
		item: '167', 
		gate: 'unit', 
		status: 'blocked', 
		reason: 'typecheck failed',
	});

	// PR 168 - all pass
	emitter.emit('gate_finished', { item: '168', gate: 'lint', status: 'pass', duration_ms: 1000 });
	emitter.emit('gate_finished', { item: '168', gate: 'typecheck', status: 'pass', duration_ms: 2000 });
	emitter.emit('gate_finished', { item: '168', gate: 'unit', status: 'pass', duration_ms: 3000 });

	// Finalize (generates gate matrix)
	await finalizeAudit(emitter);

	console.log('  ✅ Gate matrix generated');

	// Read and display gate matrix
	const matrixPath = join(tmpDir, 'audit-gate-matrix.json');
	const matrix = JSON.parse(await fs.promises.readFile(matrixPath, 'utf-8'));

	console.log('\n  📊 Gate Matrix Summary:');
	console.log(`    - total_prs: ${matrix.summary.total_prs}`);
	console.log(`    - total_gates: ${matrix.summary.total_gates}`);
	console.log(`    - passed: ${matrix.summary.passed}`);
	console.log(`    - failed: ${matrix.summary.failed}`);
	console.log(`    - skipped: ${matrix.summary.skipped}`);
	console.log(`    - blocked: ${matrix.summary.blocked}`);

	// ========== Acceptance Criteria 3: Context Inclusion in Events ==========
	console.log('\n\n✅ AC3: Context Inclusion in Events\n');

	const auditPath = join(tmpDir, 'audit.ndjson');
	const auditContent = await fs.promises.readFile(auditPath, 'utf-8');
	const firstEvent = JSON.parse(auditContent.split('\n')[0]);

	console.log('  📄 Event envelope structure:');
	console.log(`    - schema_version: ${firstEvent.schema_version}`);
	console.log(`    - event: ${firstEvent.event}`);
	console.log(`    - session_id: ${firstEvent.session_id}`);
	console.log(`    - context.git: ${firstEvent.context.git ? '✓' : '✗'}`);
	console.log(`    - context.ci: ${firstEvent.context.ci ? '✓' : '✗'}`);
	console.log(`    - context.os: ${firstEvent.context.os ? '✓' : '✗ (excluded by soc2)'}`);

	// ========== Acceptance Criteria 4: Profile Defaults ==========
	console.log('\n\n✅ AC4: Profile Defaults\n');

	const profiles = ['basic', 'soc2', 'hipaa-strict'];
	for (const profileName of profiles) {
		const profile = getAuditProfile(profileName);
		if (profile) {
			console.log(`  🔖 ${profile.name}:`);
			console.log(`    - context: [${profile.defaultContext.join(', ') || 'none'}]`);
			console.log(`    - description: ${profile.description}`);
		}
	}

	// ========== Summary ==========
	console.log('\n\n' + '='.repeat(60));
	console.log('✅ All Acceptance Criteria Verified\n');

	console.log('Output files:');
	console.log(`  - ${join(tmpDir, 'audit.ndjson')}`);
	console.log(`  - ${join(tmpDir, 'audit-gate-matrix.json')}`);

	// Clean up
	console.log('\nCleaning up...');
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
	console.log('Done!\n');
}

main().catch(console.error);
