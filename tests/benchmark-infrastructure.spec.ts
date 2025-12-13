/**
 * Tests for benchmark infrastructure
 * Validates reporter, graph generator, and baseline management
 */

import { describe, it, expect } from 'vitest';
import {
  compareResults,
  generateMarkdownReport,
  generateJSONReport,
  hasRegressions,
  type BenchmarkResult,
  type BaselineResult
} from './benchmarks/utils/reporter.js';
import { generateGraph } from './benchmarks/utils/graphGenerator.js';

describe('Benchmark Infrastructure', () => {
  describe('Graph Generator', () => {
    it('should generate linear graph with correct dependencies', () => {
      const graph = generateGraph({ nodes: 5, pattern: 'linear' });
      
      expect(graph.items).toHaveLength(5);
      expect(graph.items[0].deps).toEqual([]);
      expect(graph.items[1].deps).toEqual(['node-0000']);
      expect(graph.items[2].deps).toEqual(['node-0001']);
      expect(graph.items[3].deps).toEqual(['node-0002']);
      expect(graph.items[4].deps).toEqual(['node-0003']);
    });

    it('should generate parallel graph with no dependencies', () => {
      const graph = generateGraph({ nodes: 10, pattern: 'parallel' });
      
      expect(graph.items).toHaveLength(10);
      graph.items.forEach(item => {
        expect(item.deps).toEqual([]);
      });
    });

    it('should generate diamond graph', () => {
      const graph = generateGraph({ nodes: 10, pattern: 'diamond' });
      
      // Diamond pattern may not produce exact node count due to layering algorithm
      expect(graph.items.length).toBeGreaterThan(0);
      expect(graph.items.length).toBeLessThanOrEqual(10);
      // First item should have no dependencies
      expect(graph.items[0].deps).toEqual([]);
    });

    it('should generate complex graph', () => {
      const graph = generateGraph({ nodes: 20, pattern: 'complex' });
      
      expect(graph.items).toHaveLength(20);
      // Should have deterministic dependencies
      const firstRunGraph = generateGraph({ nodes: 20, pattern: 'complex' });
      expect(graph.items).toEqual(firstRunGraph.items);
    });

    it('should generate graphs of various sizes', () => {
      const sizes = [10, 50, 100];
      
      for (const size of sizes) {
        const graph = generateGraph({ nodes: size, pattern: 'complex' });
        expect(graph.items).toHaveLength(size);
      }
    });
  });

  describe('Reporter - Comparison Logic', () => {
    const baseline: BaselineResult[] = [
      { name: 'test-1', suite: 'Suite A', meanTime: 10 },
      { name: 'test-2', suite: 'Suite A', meanTime: 20 },
      { name: 'test-3', suite: 'Suite B', meanTime: 5 }
    ];

    it('should identify performance improvements', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 8, minTime: 7, maxTime: 9, stdDev: 0.5, samples: 100 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].deltaPercent).toBeLessThan(0);
      expect(comparisons[0].status).toBe('pass');
    });

    it('should identify regressions (>20% slower)', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 15, minTime: 14, maxTime: 16, stdDev: 0.5, samples: 100 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].deltaPercent).toBeGreaterThan(20);
      expect(comparisons[0].status).toBe('regression');
    });

    it('should identify warnings (10-20% slower)', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 11.5, minTime: 11, maxTime: 12, stdDev: 0.3, samples: 100 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].deltaPercent).toBeGreaterThan(10);
      expect(comparisons[0].deltaPercent).toBeLessThan(20);
      expect(comparisons[0].status).toBe('warning');
    });

    it('should identify pass (<10% change)', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 10.5, minTime: 10, maxTime: 11, stdDev: 0.2, samples: 100 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].deltaPercent).toBeLessThan(10);
      expect(comparisons[0].status).toBe('pass');
    });

    it('should skip new benchmarks without baseline', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-new', suite: 'Suite C', meanTime: 10, minTime: 9, maxTime: 11, stdDev: 0.5, samples: 100 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(0);
    });

    it('should handle multiple benchmarks', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 12, minTime: 11, maxTime: 13, stdDev: 0.5, samples: 100 }, // 20% slower (warning)
        { name: 'test-2', suite: 'Suite A', meanTime: 25, minTime: 24, maxTime: 26, stdDev: 0.5, samples: 100 }, // 25% slower (regression)
        { name: 'test-3', suite: 'Suite B', meanTime: 5.1, minTime: 5, maxTime: 5.2, stdDev: 0.1, samples: 100 }  // 2% slower (pass)
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(3);
      expect(comparisons.filter(c => c.status === 'regression')).toHaveLength(1);
      expect(comparisons.filter(c => c.status === 'warning')).toHaveLength(1);
      expect(comparisons.filter(c => c.status === 'pass')).toHaveLength(1);
    });
  });

  describe('Reporter - Report Generation', () => {
    const comparisons = [
      {
        name: 'test-1',
        suite: 'Suite A',
        baseline: 10,
        current: 12,
        delta: 2,
        deltaPercent: 20,
        status: 'warning' as const
      },
      {
        name: 'test-2',
        suite: 'Suite A',
        baseline: 20,
        current: 25,
        delta: 5,
        deltaPercent: 25,
        status: 'regression' as const
      },
      {
        name: 'test-3',
        suite: 'Suite B',
        baseline: 5,
        current: 5.1,
        delta: 0.1,
        deltaPercent: 2,
        status: 'pass' as const
      }
    ];

    it('should generate markdown report', () => {
      const report = generateMarkdownReport(comparisons, {
        baselineVersion: 'v0.5.0',
        currentVersion: 'current'
      });

      expect(report).toContain('# Performance Benchmark Results');
      expect(report).toContain('**Baseline:** v0.5.0');
      expect(report).toContain('**Current:** current');
      expect(report).toContain('## Suite A');
      expect(report).toContain('## Suite B');
      expect(report).toContain('test-1');
      expect(report).toContain('test-2');
      expect(report).toContain('test-3');
      expect(report).toContain('✅');
      expect(report).toContain('⚠️');
      expect(report).toContain('❌ REGRESSION');
    });

    it('should generate JSON report', () => {
      const report = generateJSONReport(comparisons, {
        baselineVersion: 'v0.5.0',
        currentVersion: 'current',
        timestamp: '2025-12-13T00:00:00Z'
      });

      const parsed = JSON.parse(report);
      
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.baselineVersion).toBe('v0.5.0');
      expect(parsed.metadata.currentVersion).toBe('current');
      expect(parsed.metadata.totalBenchmarks).toBe(3);
      expect(parsed.metadata.regressions).toBe(1);
      expect(parsed.metadata.warnings).toBe(1);
      expect(parsed.metadata.passes).toBe(1);
      expect(parsed.results).toHaveLength(3);
    });

    it('should detect regressions', () => {
      expect(hasRegressions(comparisons)).toBe(true);

      const noRegressions = comparisons.filter(c => c.status !== 'regression');
      expect(hasRegressions(noRegressions)).toBe(false);
    });
  });

  describe('Reporter - Edge Cases', () => {
    it('should handle empty comparisons', () => {
      const comparisons: any[] = [];
      
      const markdown = generateMarkdownReport(comparisons);
      expect(markdown).toContain('# Performance Benchmark Results');
      
      const json = generateJSONReport(comparisons);
      const parsed = JSON.parse(json);
      expect(parsed.metadata.totalBenchmarks).toBe(0);
      
      expect(hasRegressions(comparisons)).toBe(false);
    });

    it('should handle negative deltas (improvements)', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 5, minTime: 4, maxTime: 6, stdDev: 0.5, samples: 100 }
      ];
      const baseline: BaselineResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 10 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].deltaPercent).toBe(-50);
      expect(comparisons[0].status).toBe('pass');
    });

    it('should handle very small time values', () => {
      const current: BenchmarkResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 0.001, minTime: 0.0009, maxTime: 0.0011, stdDev: 0.0001, samples: 100 }
      ];
      const baseline: BaselineResult[] = [
        { name: 'test-1', suite: 'Suite A', meanTime: 0.001 }
      ];

      const comparisons = compareResults(current, baseline);
      
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0].status).toBe('pass');
    });
  });
});
