#!/usr/bin/env tsx
/**
 * Benchmark CI script
 * Runs benchmarks and compares against baseline, failing if regressions detected
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BenchmarkResult, BaselineResult } from '../tests/benchmarks/utils/reporter.js';
import {
  compareResults,
  generateMarkdownReport,
  generateJSONReport,
  hasRegressions
} from '../tests/benchmarks/utils/reporter.js';

const BASELINE_PATH = path.join(process.cwd(), 'tests/benchmarks/baselines/baseline.json');
const RESULTS_DIR = path.join(process.cwd(), 'tests/benchmarks/results');
const MARKDOWN_PATH = path.join(RESULTS_DIR, 'latest.md');
const JSON_PATH = path.join(RESULTS_DIR, 'latest.json');

async function main() {
  console.log('📊 Running performance benchmarks...\n');

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Run benchmarks
  try {
    execSync('npm run benchmark -- --reporter=json --outputFile=/tmp/bench-results.json', {
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('❌ Benchmark execution failed');
    process.exit(1);
  }

  // Load baseline
  if (!fs.existsSync(BASELINE_PATH)) {
    console.warn('⚠️ No baseline found. Run `npm run benchmark:baseline` to create one.');
    console.log('✅ Benchmarks completed (no comparison available)');
    process.exit(0);
  }

  const baseline: BaselineResult[] = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));

  // Load current results
  if (!fs.existsSync('/tmp/bench-results.json')) {
    console.error('❌ Benchmark results not found');
    process.exit(1);
  }

  const currentRaw = JSON.parse(fs.readFileSync('/tmp/bench-results.json', 'utf-8'));

  // Parse Vitest benchmark results format
  const current: BenchmarkResult[] = parseBenchmarkResults(currentRaw);

  if (current.length === 0) {
    console.warn('⚠️ No benchmark results to compare');
    process.exit(0);
  }

  // Compare results
  const comparisons = compareResults(current, baseline);

  // Generate reports
  const metadata = {
    baselineVersion: 'v0.5.0',
    currentVersion: 'current',
    baselineDate: '2025-12-13',
    timestamp: new Date().toISOString()
  };

  const markdownReport = generateMarkdownReport(comparisons, metadata);
  const jsonReport = generateJSONReport(comparisons, metadata);

  // Write reports
  fs.writeFileSync(MARKDOWN_PATH, markdownReport);
  fs.writeFileSync(JSON_PATH, jsonReport);

  console.log('\n📊 Benchmark Results\n');
  console.log(markdownReport);

  // Check for regressions
  if (hasRegressions(comparisons)) {
    console.error('\n❌ Performance regressions detected! See report above.');
    console.error(`\nReports saved to:`);
    console.error(`  - ${MARKDOWN_PATH}`);
    console.error(`  - ${JSON_PATH}`);
    process.exit(1);
  } else {
    console.log('\n✅ No performance regressions detected');
    console.log(`\nReports saved to:`);
    console.log(`  - ${MARKDOWN_PATH}`);
    console.log(`  - ${JSON_PATH}`);
    process.exit(0);
  }
}

/**
 * Parse Vitest benchmark results into our format
 */
function parseBenchmarkResults(raw: any): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  // Vitest benchmark format varies, this is a basic parser
  // Adjust based on actual Vitest output format
  if (raw.testResults) {
    for (const testFile of raw.testResults) {
      for (const assertionResult of testFile.assertionResults || []) {
        if (assertionResult.duration !== undefined) {
          const fullName = assertionResult.fullName || assertionResult.title || '';
          const parts = fullName.split(' > ');
          const suite = parts.slice(0, -1).join(' > ') || 'Unknown';
          const name = parts[parts.length - 1] || 'Unknown';

          results.push({
            name,
            suite,
            meanTime: assertionResult.duration,
            minTime: assertionResult.duration,
            maxTime: assertionResult.duration,
            stdDev: 0,
            samples: 1
          });
        }
      }
    }
  }

  // Fallback: try to parse as array of results
  if (results.length === 0 && Array.isArray(raw)) {
    return raw;
  }

  return results;
}

main().catch(error => {
  console.error('❌ Benchmark CI script failed:', error);
  process.exit(1);
});
