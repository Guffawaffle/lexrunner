/**
 * Complete Security Integration Example
 * 
 * Demonstrates full enterprise security workflow including:
 * - Secret validation and rotation checks
 * - Plan secrets scanning
 * - Permission preflight checks
 * - Audit logging with retention
 * - Vulnerability scanning
 * - Compliance reporting
 */

import {
	AuthenticationManager,
	AuthorizationService,
	EnterpriseAuditService,
	SecretsManager,
	PlanSecretsScanner,
	SecurityScanningService,
	Permission,
} from '../src/security';

/**
 * Example 1: Complete pre-execution security checks
 */
async function preExecutionSecurityChecks(): Promise<boolean> {
	console.log('🔒 Running pre-execution security checks...\n');

	// 1. Validate required secrets
	console.log('1️⃣ Validating required secrets...');
	const secretsManager = new SecretsManager();
	const secretValidation = await secretsManager.validateSecrets([
		'GITHUB_TOKEN',
		'AUDIT_SIGNING_KEY'
	]);

	if (!secretValidation.valid) {
		console.error(`❌ Missing secrets: ${secretValidation.missing.join(', ')}`);
		return false;
	}
	console.log('✅ All required secrets present\n');

	// 2. Check secret rotation
	console.log('2️⃣ Checking secret rotation status...');
	const needsRotation = await secretsManager.checkRotationNeeded('GITHUB_TOKEN', 90);
	if (needsRotation) {
		console.warn('⚠️  GITHUB_TOKEN needs rotation (>90 days old)');
	} else {
		console.log('✅ Token within rotation policy\n');
	}

	// 3. Scan plan for exposed secrets
	console.log('3️⃣ Scanning plan for exposed secrets...');
	const secretScanner = new PlanSecretsScanner();
	const detectedSecrets = await secretScanner.scanPlanFile('./plan.json');
	
	if (detectedSecrets.length > 0) {
		console.error(`❌ Found ${detectedSecrets.length} exposed secret(s) in plan`);
		console.error(secretScanner.generateReport(detectedSecrets));
		return false;
	}
	console.log('✅ No secrets detected in plan\n');

	// 4. Authenticate and authorize
	console.log('4️⃣ Authenticating and checking permissions...');
	const authManager = new AuthenticationManager();
	const authContext = await authManager.initialize();
	
	const authService = new AuthorizationService();
	const preflightResult = authService.preflightCheck(authContext, [
		Permission.READ,
		Permission.CREATE_PR,
		Permission.MERGE
	]);

	if (!preflightResult.allowed) {
		console.error(`❌ Missing permissions: ${preflightResult.missingPermissions.join(', ')}`);
		if (preflightResult.recommendations) {
			console.error(`💡 ${preflightResult.recommendations}`);
		}
		return false;
	}
	console.log('✅ User has all required permissions\n');

	// 5. Run vulnerability scan
	console.log('5️⃣ Scanning for vulnerabilities...');
	const scanService = new SecurityScanningService({
		blockCritical: true,
		blockHigh: true,
		maxMedium: 5,
		maxLow: 10
	});

	try {
		const scanResults = await scanService.scanAll('.');
		for (const result of scanResults) {
			const evaluation = scanService.evaluatePolicy(result);
			if (!evaluation.passed) {
				console.error('❌ Security policy violations:');
				evaluation.violations.forEach(v => console.error(`  - ${v}`));
				return false;
			}
		}
		console.log('✅ No critical vulnerabilities found\n');
	} catch (error) {
		console.warn('⚠️  Vulnerability scan unavailable (npm audit not run)');
	}

	console.log('✅ All security checks passed!\n');
	return true;
}

/**
 * Example 2: Execute operation with full audit trail
 */
async function executeWithAudit(): Promise<void> {
	console.log('📝 Executing operation with audit trail...\n');

	const authManager = new AuthenticationManager();
	const authContext = await authManager.initialize();

	const signingKey = process.env.AUDIT_SIGNING_KEY || 'default-key';
	const auditService = new EnterpriseAuditService(signingKey);

	// Log operation
	const entry = auditService.logSecure(
		'merge_operation',
		'approved',
		{
			prNumbers: [101, 102, 103],
			targetBranch: 'main',
			mergeStrategy: 'squash',
			gateResults: { lint: 'passed', test: 'passed', security: 'passed' },
			reason: 'All gates passed, ready for merge'
		},
		authContext
	);

	// Verify entry integrity
	const isValid = auditService.verifyEntry(entry);
	console.log(`Entry signature valid: ${isValid ? '✅' : '❌'}`);

	// Apply retention policy
	console.log('\n📅 Applying retention policy...');
	const retentionResult = auditService.applyRetentionPolicy('SOC2');
	console.log(`Applied ${retentionResult.retentionDays} day retention`);
	console.log(`Pruned ${retentionResult.prunedCount} old entries\n`);

	// Generate compliance report
	console.log('📊 Generating compliance report...');
	const report = auditService.generateComplianceReport('SOC2' as any);
	console.log(`Report format: ${report.format}`);
	console.log(`Total entries: ${report.totalEntries}`);
	console.log(`Report signed: ${report.signature ? '✅' : '❌'}\n`);
}

/**
 * Example 3: Permission report for debugging
 */
async function generatePermissionReport(): Promise<void> {
	console.log('👤 Generating user permission report...\n');

	const authManager = new AuthenticationManager();
	const authContext = await authManager.initialize();

	const authService = new AuthorizationService();
	const report = authService.generatePermissionReport(authContext);

	console.log(report);
	console.log('');
}

/**
 * Example 4: Batch operation validation
 */
async function validateBatchOperations(): Promise<void> {
	console.log('🔍 Validating batch operations...\n');

	const authManager = new AuthenticationManager();
	const authContext = await authManager.initialize();

	const authService = new AuthorizationService();
	
	const operations = [
		{ name: 'Read plan', permissions: [Permission.READ] },
		{ name: 'Generate artifacts', permissions: [Permission.ARTIFACTS] },
		{ name: 'Annotate PR', permissions: [Permission.ANNOTATE] },
		{ name: 'Create PR', permissions: [Permission.CREATE_PR] },
		{ name: 'Merge PR', permissions: [Permission.MERGE] }
	];

	const results = authService.batchPreflightCheck(authContext, operations);

	console.log('Operation Permission Check:');
	for (const result of results) {
		const status = result.allowed ? '✅' : '❌';
		console.log(`  ${status} ${result.operation}`);
		if (!result.allowed) {
			console.log(`     Missing: ${result.missingPermissions.join(', ')}`);
		}
	}
	console.log('');
}

/**
 * Main execution
 */
async function main() {
	console.log('🔐 Complete Enterprise Security Workflow\n');
	console.log('='.repeat(60));
	console.log('');

	try {
		// Step 1: Pre-execution checks
		const checksPass = await preExecutionSecurityChecks();
		if (!checksPass) {
			console.error('\n❌ Security checks failed, aborting operation');
			process.exit(1);
		}

		// Step 2: Generate permission report
		await generatePermissionReport();

		// Step 3: Validate batch operations
		await validateBatchOperations();

		// Step 4: Execute with audit
		await executeWithAudit();

		console.log('✅ Complete security workflow executed successfully!');
		console.log('\n' + '='.repeat(60));
		
	} catch (error) {
		console.error('\n❌ Security workflow failed:', error);
		process.exit(1);
	}
}

// Run example if executed directly
if (require.main === module) {
	main().catch(console.error);
}

export {
	preExecutionSecurityChecks,
	executeWithAudit,
	generatePermissionReport,
	validateBatchOperations,
};
