/**
 * Query and filtering utilities for audit events (Phase 3A SDK)
 */

import type { AuditEvent, EventType, EventLevel, AuditProfile, GateStatus } from '../audit/schema/events.js';

/**
 * Filter options for audit events
 */
export interface EventFilter {
	/** Filter by event type */
	eventType?: EventType | EventType[];
	/** Filter by event level */
	level?: EventLevel | EventLevel[];
	/** Filter by session ID */
	sessionId?: string;
	/** Filter by run ID */
	runId?: string;
	/** Filter by audit profile */
	profile?: AuditProfile;
	/** Filter by item (for gate/merge events) */
	item?: string | number;
	/** Filter by gate name (for gate events) */
	gate?: string;
	/** Filter by gate status (for gate_finished events) */
	gateStatus?: GateStatus | GateStatus[];
	/** Filter by timestamp range (ISO 8601 strings) */
	timeRange?: {
		start?: string;
		end?: string;
	};
}

/**
 * Filter audit events by criteria
 *
 * @param events - Array of audit events to filter
 * @param filter - Filter criteria
 * @returns Filtered array of audit events
 *
 * @example
 * ```typescript
 * const failedGates = filterEvents(events, {
 *   eventType: 'gate_finished',
 *   gateStatus: 'fail'
 * });
 * ```
 */
export function filterEvents(events: AuditEvent[], filter: EventFilter): AuditEvent[] {
	return events.filter(event => {
		// Filter by event type
		if (filter.eventType) {
			const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
			if (!types.includes(event.event)) {
				return false;
			}
		}

		// Filter by level
		if (filter.level) {
			const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
			if (!levels.includes(event.level)) {
				return false;
			}
		}

		// Filter by session ID
		if (filter.sessionId && event.session_id !== filter.sessionId) {
			return false;
		}

		// Filter by run ID
		if (filter.runId && event.run_id !== filter.runId) {
			return false;
		}

		// Filter by item (for gate/merge events)
		if (filter.item !== undefined && 'item' in event.payload) {
			if (event.payload.item !== filter.item) {
				return false;
			}
		}

		// Filter by gate name
		if (filter.gate && 'gate' in event.payload) {
			if (event.payload.gate !== filter.gate) {
				return false;
			}
		}

		// Filter by gate status
		if (filter.gateStatus !== undefined) {
			// Only gate_finished events have status
			if (event.event !== 'gate_finished') {
				return false;
			}
			const statuses = Array.isArray(filter.gateStatus) ? filter.gateStatus : [filter.gateStatus];
			if (!statuses.includes(event.payload.status)) {
				return false;
			}
		}

		// Filter by time range
		if (filter.timeRange) {
			const eventTime = new Date(event.ts).getTime();
			if (filter.timeRange.start) {
				const startTime = new Date(filter.timeRange.start).getTime();
				if (eventTime < startTime) {
					return false;
				}
			}
			if (filter.timeRange.end) {
				const endTime = new Date(filter.timeRange.end).getTime();
				if (eventTime > endTime) {
					return false;
				}
			}
		}

		return true;
	});
}

/**
 * Query builder for fluent filtering
 *
 * @example
 * ```typescript
 * const failedGates = new EventQuery(events)
 *   .byEventType('gate_finished')
 *   .byGateStatus('fail')
 *   .byLevel('error')
 *   .execute();
 * ```
 */
export class EventQuery {
	private events: AuditEvent[];
	private filter: EventFilter = {};

	constructor(events: AuditEvent[]) {
		this.events = events;
	}

	/**
	 * Filter by event type
	 */
	byEventType(type: EventType | EventType[]): this {
		this.filter.eventType = type;
		return this;
	}

	/**
	 * Filter by event level
	 */
	byLevel(level: EventLevel | EventLevel[]): this {
		this.filter.level = level;
		return this;
	}

	/**
	 * Filter by session ID
	 */
	bySessionId(sessionId: string): this {
		this.filter.sessionId = sessionId;
		return this;
	}

	/**
	 * Filter by run ID
	 */
	byRunId(runId: string): this {
		this.filter.runId = runId;
		return this;
	}

	/**
	 * Filter by item (for gate/merge events)
	 */
	byItem(item: string | number): this {
		this.filter.item = item;
		return this;
	}

	/**
	 * Filter by gate name
	 */
	byGate(gate: string): this {
		this.filter.gate = gate;
		return this;
	}

	/**
	 * Filter by gate status
	 */
	byGateStatus(status: GateStatus | GateStatus[]): this {
		this.filter.gateStatus = status;
		return this;
	}

	/**
	 * Filter by time range
	 */
	byTimeRange(start?: string, end?: string): this {
		this.filter.timeRange = { start, end };
		return this;
	}

	/**
	 * Execute the query and return filtered events
	 */
	execute(): AuditEvent[] {
		return filterEvents(this.events, this.filter);
	}

	/**
	 * Count matching events without returning them
	 */
	count(): number {
		return this.execute().length;
	}

	/**
	 * Get the first matching event (or undefined)
	 */
	first(): AuditEvent | undefined {
		return this.execute()[0];
	}

	/**
	 * Check if any events match the query
	 */
	exists(): boolean {
		return this.count() > 0;
	}
}

/**
 * Compute statistics from audit events
 *
 * @param events - Array of audit events
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * const stats = computeStatistics(events);
 * console.log(`Total events: ${stats.totalEvents}`);
 * console.log(`Failed gates: ${stats.gateStats.failed}`);
 * ```
 */
export function computeStatistics(events: AuditEvent[]) {
	const stats = {
		totalEvents: events.length,
		eventTypes: {} as Record<string, number>,
		levels: {
			info: 0,
			warn: 0,
			error: 0
		},
		gateStats: {
			total: 0,
			passed: 0,
			failed: 0,
			skipped: 0,
			errored: 0
		},
		mergeStats: {
			total: 0,
			success: 0,
			conflict: 0,
			errored: 0
		},
		timeRange: {
			start: '',
			end: ''
		}
	};

	// Count event types
	for (const event of events) {
		stats.eventTypes[event.event] = (stats.eventTypes[event.event] || 0) + 1;
		stats.levels[event.level]++;

		// Gate statistics
		if (event.event === 'gate_finished') {
			stats.gateStats.total++;
			if (event.payload.status === 'pass') stats.gateStats.passed++;
			else if (event.payload.status === 'fail') stats.gateStats.failed++;
			else if (event.payload.status === 'skip') stats.gateStats.skipped++;
			else if (event.payload.status === 'error') stats.gateStats.errored++;
		}

		// Merge statistics
		if (event.event === 'merge_finished') {
			stats.mergeStats.total++;
			if (event.payload.status === 'success') stats.mergeStats.success++;
			else if (event.payload.status === 'conflict') stats.mergeStats.conflict++;
			else if (event.payload.status === 'error') stats.mergeStats.errored++;
		}
	}

	// Time range
	if (events.length > 0) {
		const timestamps = events.map(e => e.ts).sort();
		stats.timeRange.start = timestamps[0];
		stats.timeRange.end = timestamps[timestamps.length - 1];
	}

	return stats;
}
