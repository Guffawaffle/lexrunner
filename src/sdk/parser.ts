/**
 * NDJSON parser for audit events (Phase 3A SDK)
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { parseAuditEvent } from '../audit/schema/events.js';
import type { AuditEvent } from '../audit/schema/events.js';

/**
 * Parse a single line of NDJSON into an audit event
 *
 * @param line - NDJSON line to parse
 * @returns Parsed and validated audit event
 * @throws Error if line is invalid JSON or fails validation
 */
export function parseAuditEventLine(line: string): AuditEvent {
	if (!line.trim()) {
		throw new Error('Empty line cannot be parsed as audit event');
	}

	try {
		const data = JSON.parse(line);
		return parseAuditEvent(data);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON in audit event: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Read audit events from an NDJSON file (async iterable)
 *
 * @param filePath - Path to NDJSON file
 * @yields Validated audit events
 *
 * @example
 * ```typescript
 * for await (const event of readAuditNDJSON('./audit.ndjson')) {
 *   if (event.event === 'gate_finished') {
 *     console.log(`Gate: ${event.payload.gate}, Status: ${event.payload.status}`);
 *   }
 * }
 * ```
 */
export async function* readAuditNDJSON(filePath: string): AsyncIterable<AuditEvent> {
	const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	for await (const line of rl) {
		if (line.trim()) {
			yield parseAuditEventLine(line);
		}
	}
}

/**
 * Read all audit events from an NDJSON file into an array
 *
 * @param filePath - Path to NDJSON file
 * @returns Array of validated audit events
 *
 * @example
 * ```typescript
 * const events = await readAuditNDJSONSync('./audit.ndjson');
 * const failedGates = events.filter(e =>
 *   e.event === 'gate_finished' && e.payload.status === 'fail'
 * );
 * ```
 */
export async function readAuditNDJSONSync(filePath: string): Promise<AuditEvent[]> {
	const events: AuditEvent[] = [];
	for await (const event of readAuditNDJSON(filePath)) {
		events.push(event);
	}
	return events;
}

/**
 * Parse audit events from a string containing NDJSON
 *
 * @param content - NDJSON content as string
 * @returns Array of validated audit events
 */
export function parseAuditNDJSONString(content: string): AuditEvent[] {
	const lines = content.split('\n');
	const events: AuditEvent[] = [];

	for (const line of lines) {
		if (line.trim()) {
			events.push(parseAuditEventLine(line));
		}
	}

	return events;
}
