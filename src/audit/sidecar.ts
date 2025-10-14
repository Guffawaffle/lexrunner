/**
 * Sidecar file ingestion for gate-emitted events
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEnvelope } from './events.js';

export interface SidecarEvent {
	event: string;
	ts?: string;
	gate?: string;
	item?: string | number;
	payload?: any;
	[key: string]: any;
}

/**
 * Discover sidecar files in drop directory
 */
export function discoverSidecarFiles(dropDir: string): string[] {
	if (!fs.existsSync(dropDir)) {
		return [];
	}

	const entries = fs.readdirSync(dropDir, { withFileTypes: true });
	return entries
		.filter(e => e.isFile() && e.name.endsWith('.ndjson') && !e.name.endsWith('.done'))
		.map(e => path.join(dropDir, e.name));
}

/**
 * Read and parse sidecar file
 */
export function readSidecarFile(filePath: string): SidecarEvent[] {
	const content = fs.readFileSync(filePath, 'utf-8');
	const lines = content.split('\n').filter(line => line.trim());
	
	const events: SidecarEvent[] = [];
	for (const line of lines) {
		try {
			const event = JSON.parse(line);
			events.push(event);
		} catch (error) {
			console.warn(`Failed to parse sidecar event: ${line}`, error);
		}
	}
	
	return events;
}

/**
 * Mark sidecar file as processed
 */
export function markSidecarProcessed(filePath: string): void {
	const donePath = filePath + '.done';
	fs.renameSync(filePath, donePath);
}

/**
 * Enrich sidecar event with envelope
 */
export function enrichSidecarEvent(
	sidecarEvent: SidecarEvent,
	envelope: Partial<EventEnvelope>
): EventEnvelope {
	return {
		schema_version: envelope.schema_version || '0.1.0',
		event: sidecarEvent.event,
		ts: sidecarEvent.ts || new Date().toISOString(),
		level: (sidecarEvent.level as 'info' | 'warn' | 'error') || 'info',
		session_id: envelope.session_id || '',
		run_id: envelope.run_id || '',
		tool: envelope.tool || { name: 'unknown', version: 'unknown' },
		actor: envelope.actor || { type: 'cli' },
		repo: envelope.repo || {},
		context: envelope.context,
		payload: {
			...sidecarEvent.payload,
			gate: sidecarEvent.gate,
			item: sidecarEvent.item
		}
	};
}

/**
 * Ingest all sidecar files from drop directory
 */
export async function ingestSidecarFiles(
	dropDir: string,
	envelope: Partial<EventEnvelope>,
	onEvent: (event: EventEnvelope) => Promise<void>
): Promise<number> {
	const files = discoverSidecarFiles(dropDir);
	let count = 0;

	for (const file of files) {
		const events = readSidecarFile(file);
		
		for (const sidecarEvent of events) {
			const enrichedEvent = enrichSidecarEvent(sidecarEvent, envelope);
			await onEvent(enrichedEvent);
			count++;
		}
		
		// Mark as processed
		markSidecarProcessed(file);
	}

	return count;
}
