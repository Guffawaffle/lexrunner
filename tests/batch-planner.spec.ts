/**
 * Tests for Batch Planner with Kahn's Algorithm
 * Validates deterministic topological sorting and layer-based batching
 */

import { describe, it, expect } from 'vitest';
import { computeBatches, Node, CycleError, UnknownDependencyError } from '../src/orchestration/batchPlanner.js';

describe('Batch Planner - Kahn\'s Algorithm', () => {
	describe('Basic topological sorting', () => {
		it('should handle single node with no dependencies', () => {
			const nodes: Node[] = [
				{
					id: '1',
					type: 'issue',
					dependencies: [],
					metadata: {
						score: 1.0,
						createdAt: '2025-10-13T00:00:00Z',
						issueNumber: 1
					}
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(1);
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items).toHaveLength(1);
			expect(plan.batches[0].items[0].id).toBe('1');
			expect(plan.algorithm).toBe('kahn_topological_sort');
			expect(plan.deterministic).toBe(true);
			expect(plan.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		});

		it('should handle linear chain (A → B → C)', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['B'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(3);
			
			// Layer 0: A
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['A']);
			
			// Layer 1: B
			expect(plan.batches[1].layer).toBe(1);
			expect(plan.batches[1].items.map(n => n.id)).toEqual(['B']);
			
			// Layer 2: C
			expect(plan.batches[2].layer).toBe(2);
			expect(plan.batches[2].items.map(n => n.id)).toEqual(['C']);
		});

		it('should handle tree structure (A → B, A → C)', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(2);
			
			// Layer 0: A
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['A']);
			
			// Layer 1: B, C (parallel)
			expect(plan.batches[1].layer).toBe(1);
			expect(plan.batches[1].items.map(n => n.id).sort()).toEqual(['B', 'C']);
		});

		it('should handle diamond structure (A → B → D, A → C → D)', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				},
				{
					id: 'D',
					type: 'issue',
					dependencies: ['B', 'C'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:03:00Z', issueNumber: 4 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(3);
			
			// Layer 0: A
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['A']);
			
			// Layer 1: B, C
			expect(plan.batches[1].layer).toBe(1);
			expect(plan.batches[1].items.map(n => n.id).sort()).toEqual(['B', 'C']);
			
			// Layer 2: D
			expect(plan.batches[2].layer).toBe(2);
			expect(plan.batches[2].items.map(n => n.id)).toEqual(['D']);
		});

		it('should handle disconnected components', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(2);
			
			// Layer 0: A, B (both have no dependencies)
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items.map(n => n.id).sort()).toEqual(['A', 'B']);
			
			// Layer 1: C
			expect(plan.batches[1].layer).toBe(1);
			expect(plan.batches[1].items.map(n => n.id)).toEqual(['C']);
		});
	});

	describe('Deterministic ordering', () => {
		it('should use score as primary ordering key (lower score = higher priority)', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 2.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: [],
					metadata: { score: 0.5, createdAt: '2025-10-13T00:00:00Z', issueNumber: 3 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(1);
			// Should be ordered by score: C (0.5), B (1.0), A (2.0)
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['C', 'B', 'A']);
		});

		it('should use createdAt as secondary ordering key', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 3 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(1);
			// Should be ordered by createdAt (older first): B, C, A
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['B', 'C', 'A']);
		});

		it('should use issue/PR number as tertiary ordering key', () => {
			const nodes: Node[] = [
				{
					id: '3',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 3 }
				},
				{
					id: '1',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: '2',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 2 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(1);
			// Should be ordered by number: 1, 2, 3
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['1', '2', '3']);
		});

		it('should produce same output for same input (determinism test)', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 0.5, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 0.8, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			const plan1 = computeBatches(nodes);
			const plan2 = computeBatches(nodes);

			expect(plan1.planHash).toBe(plan2.planHash);
			expect(plan1.batches).toEqual(plan2.batches);
		});
	});

	describe('Error handling', () => {
		it('should detect cycles', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['B'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				}
			];

			expect(() => computeBatches(nodes)).toThrow(CycleError);
			expect(() => computeBatches(nodes)).toThrow(/cycle detected/i);
		});

		it('should detect self-referential cycles', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				}
			];

			expect(() => computeBatches(nodes)).toThrow(CycleError);
		});

		it('should detect three-node cycles', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['C'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['B'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			expect(() => computeBatches(nodes)).toThrow(CycleError);
			// Updated expectation to match AXError format
			expect(() => computeBatches(nodes)).toThrow(/cycle detected/i);
		});

		it('should throw error for unknown dependencies', () => {
			const nodes: Node[] = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['NonExistent'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				}
			];

			expect(() => computeBatches(nodes)).toThrow(UnknownDependencyError);
			// Updated expectation to match AXError format
			expect(() => computeBatches(nodes)).toThrow(/depends on unknown item/i);
		});
	});

	describe('Output format', () => {
		it('should include all required fields in BatchPlan', () => {
			const nodes: Node[] = [
				{
					id: '1',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan).toHaveProperty('planVersion');
			expect(plan).toHaveProperty('algorithm');
			expect(plan).toHaveProperty('deterministic');
			expect(plan).toHaveProperty('planHash');
			expect(plan).toHaveProperty('batches');
			
			expect(plan.planVersion).toBe('1.0.0');
			expect(plan.algorithm).toBe('kahn_topological_sort');
			expect(plan.deterministic).toBe(true);
		});

		it('should include correct batch structure', () => {
			const nodes: Node[] = [
				{
					id: '1',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				}
			];

			const plan = computeBatches(nodes);
			const batch = plan.batches[0];

			expect(batch).toHaveProperty('id');
			expect(batch).toHaveProperty('layer');
			expect(batch).toHaveProperty('items');
			
			expect(batch.id).toMatch(/^batch\d+$/);
			expect(batch.layer).toBe(0);
			expect(Array.isArray(batch.items)).toBe(true);
		});

		it('should preserve node metadata in items', () => {
			const nodes: Node[] = [
				{
					id: '156',
					type: 'issue',
					dependencies: [],
					metadata: { 
						score: 1.2, 
						createdAt: '2025-10-13T00:56:27Z', 
						issueNumber: 156 
					}
				}
			];

			const plan = computeBatches(nodes);
			const item = plan.batches[0].items[0];

			expect(item.id).toBe('156');
			expect(item.type).toBe('issue');
			expect(item.dependencies).toEqual([]);
			expect(item.metadata.score).toBe(1.2);
			expect(item.metadata.createdAt).toBe('2025-10-13T00:56:27Z');
			expect(item.metadata.issueNumber).toBe(156);
		});
	});

	describe('Real-world scenario', () => {
		it('should handle complex issue dependency graph from example', () => {
			const nodes: Node[] = [
				{
					id: '156',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.2, createdAt: '2025-10-13T00:56:27Z', issueNumber: 156 }
				},
				{
					id: '160',
					type: 'issue',
					dependencies: [],
					metadata: { score: 0.8, createdAt: '2025-10-13T00:56:37Z', issueNumber: 160 }
				},
				{
					id: '161',
					type: 'issue',
					dependencies: ['156'],
					metadata: { score: 0.5, createdAt: '2025-10-13T00:56:47Z', issueNumber: 161 }
				}
			];

			const plan = computeBatches(nodes);

			expect(plan.batches).toHaveLength(2);
			
			// Batch 1 (layer 0): 160 (score 0.8), 156 (score 1.2)
			expect(plan.batches[0].layer).toBe(0);
			expect(plan.batches[0].items.map(n => n.id)).toEqual(['160', '156']);
			
			// Batch 2 (layer 1): 161 (depends on 156)
			expect(plan.batches[1].layer).toBe(1);
			expect(plan.batches[1].items.map(n => n.id)).toEqual(['161']);
			expect(plan.batches[1].items[0].dependencies).toEqual(['156']);
		});
	});
});
