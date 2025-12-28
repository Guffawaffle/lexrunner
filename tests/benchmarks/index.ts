/**
 * Benchmark suite index
 * Main entry point for running performance benchmarks
 *
 * Usage:
 *   npm run benchmark                    # Run all benchmarks
 *   npm run benchmark -- core/topo       # Run specific benchmark
 *   npm run benchmark:ci                 # Compare against baseline
 */

// Re-export benchmark utilities for convenience
export * from "./utils/reporter.js";
export * from "./utils/graphGenerator.js";

// Re-export all benchmarks for discovery
export * from "./core/topologicalSort.bench.js";
export * from "./core/planParser.bench.js";
export * from "./core/dependencyResolver.bench.js";
export * from "./io/fileOperations.bench.js";
export * from "./io/gitOperations.bench.js";
export * from "./workflows/endToEnd.bench.js";

/**
 * Benchmark suite metadata
 */
export const BENCHMARK_INFO = {
  version: "1.0.0",
  description: "Performance regression test suite for lexrunner",
  categories: [
    "core", // Core algorithms
    "io", // I/O operations
    "workflows", // End-to-end workflows
  ],
  regressionThreshold: 20, // Percent increase that triggers regression
  warningThreshold: 10, // Percent increase that triggers warning
};
