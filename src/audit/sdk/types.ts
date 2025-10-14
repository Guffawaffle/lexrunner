/**
 * Type definitions for the Audit SDK
 */

/**
 * Log level for audit events
 */
export type AuditLevel = 'info' | 'warn' | 'error';

/**
 * Severity levels for vulnerabilities
 */
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Test result status
 */
export type TestStatus = 'pass' | 'fail' | 'skip';

/**
 * Vulnerability finding payload
 */
export interface VulnFoundPayload {
	cve: string;
	severity: VulnerabilitySeverity;
	package?: string;
	version?: string;
	fixedIn?: string;
}

/**
 * Test result payload
 */
export interface TestResultPayload {
	name: string;
	status: TestStatus;
	duration_ms?: number;
	error?: string;
}

/**
 * Base audit event structure
 */
export interface AuditEvent {
	event: string;
	ts: string;
	level: AuditLevel;
	gate: string;
	payload: any;
}

/**
 * Audit SDK interface for gates to emit audit events
 */
export interface AuditSDK {
	/**
	 * Emit a custom audit event
	 * @param event - Event name
	 * @param payload - Event payload data
	 * @param level - Log level (default: 'info')
	 */
	emit(event: string, payload: any, level?: AuditLevel): Promise<void>;

	/**
	 * Emit a vulnerability finding event
	 * @param cve - CVE identifier
	 * @param severity - Vulnerability severity
	 * @param details - Additional details
	 */
	emitVuln(cve: string, severity: VulnerabilitySeverity, details?: Partial<VulnFoundPayload>): Promise<void>;

	/**
	 * Emit a test result event
	 * @param name - Test name
	 * @param status - Test status
	 * @param duration_ms - Test duration in milliseconds
	 */
	emitTestResult(name: string, status: TestStatus, duration_ms?: number): Promise<void>;

	/**
	 * Close the audit stream and flush remaining events
	 */
	close(): Promise<void>;
}
