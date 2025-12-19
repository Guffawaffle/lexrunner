/**
 * Verification Module Errors
 */

export class SnapshotMismatchError extends Error {
	constructor(
		public readonly expectedHash: string,
		public readonly actualHash: string,
	) {
		super(
			`Snapshot hash mismatch: expected ${expectedHash}, got ${actualHash}`,
		);
		this.name = 'SnapshotMismatchError';
	}
}

export class PatchApplicationError extends Error {
	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = 'PatchApplicationError';
	}
}

export class VerificationTimeoutError extends Error {
	constructor(public readonly timeoutMs: number) {
		super(`Verification command timed out after ${timeoutMs}ms`);
		this.name = 'VerificationTimeoutError';
	}
}
