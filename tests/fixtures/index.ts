/**
 * Main fixture library exports
 *
 * This is the primary entry point for using test fixtures.
 * Import from here to access all fixture types:
 *
 * @example
 * import { fixtures } from '../fixtures';
 *
 * const plan = fixtures.plans.simple();
 * const pr = fixtures.prs.basic({ number: 100, title: 'Test PR' });
 */

// Plan fixtures
import * as simple from "./plans/simple.js";
import * as linear from "./plans/linear.js";
import * as diamond from "./plans/diamond.js";
import * as complex from "./plans/complex.js";

// Invalid plan fixtures
import * as invalidPlans from "./invalid/plans.js";

// PR fixtures
import * as basicPR from "./prs/basic.js";
import * as withDeps from "./prs/withDeps.js";

// Gate fixtures
import * as gateConfigs from "./gates/configs.js";
import * as gateResults from "./gates/results.js";

// Utility fixtures
import * as tempDir from "./utils/tempDir.js";
import * as mockGitHub from "./utils/mockGitHub.js";
import * as cleanup from "./utils/cleanup.js";

// Scenario fixtures
import * as scenarios from "./scenarios/mergeWorkflows.js";
import * as syntheticWeave from "./scenarios/syntheticWeave.js";

/**
 * Organized fixture exports
 */
export const fixtures = {
  /**
   * Plan fixtures with various dependency patterns
   */
  plans: {
    /** Simple plan with 2-3 independent PRs */
    simple: simple.simple,
    /** Simple plan with gates configured */
    simpleWithGates: simple.simpleWithGates,

    /** Linear dependency chain A → B → C → D */
    linear: linear.linear,
    /** Linear chain with gates */
    linearWithGates: linear.linearWithGates,

    /** Diamond dependency pattern */
    diamond: diamond.diamond,
    /** Extended diamond with additional layer */
    diamondExtended: diamond.diamondExtended,
    /** Double diamond (pyramid) pattern */
    doubleDiamond: diamond.doubleDiamond,

    /** Complex realistic plan with 16 PRs */
    complex: complex.complex,
    /** Wide parallel plan (10 independent PRs) */
    wideParallel: complex.wideParallel,
    /** Deep chain (15 sequential PRs) */
    deepChain: complex.deepChain,
  },

  /**
   * Invalid plan fixtures for error testing
   */
  invalid: {
    /** Circular dependency */
    cycle: invalidPlans.cycle,
    /** Complex circular dependency */
    complexCycle: invalidPlans.complexCycle,
    /** Unknown dependency reference */
    unknownDependency: invalidPlans.unknownDependency,
    /** Orphaned items */
    orphans: invalidPlans.orphans,
    /** Duplicate item names */
    duplicateNames: invalidPlans.duplicateNames,
    /** Missing required gates */
    missingRequiredGates: invalidPlans.missingRequiredGates,
    /** Empty plan */
    empty: invalidPlans.empty,
  },

  /**
   * PR fixtures
   */
  prs: {
    /** Create a basic mock PR */
    basic: basicPR.basic,
    /** Create a batch of basic PRs */
    batch: basicPR.batch,
    /** Create PR with specific files */
    withFiles: basicPR.withFiles,
    /** Create PR with labels */
    withLabels: basicPR.withLabels,
    /** Create closed/merged PR */
    closed: basicPR.closed,
    /** Create PR with large changeset */
    largeChangeset: basicPR.largeChangeset,

    /** Create PR with dependencies */
    withDeps: withDeps.withDeps,
    /** Create blocking PR */
    blocking: withDeps.blocking,
    /** Create chain of dependent PRs */
    chain: withDeps.chain,
    /** Create diamond pattern of PRs */
    diamond: withDeps.diamond,
    /** Create complex dependency graph */
    complex: withDeps.complex,
    /** Create PRs with mixed dependency formats */
    mixedDependencyFormats: withDeps.mixedDependencyFormats,
  },

  /**
   * Gate fixtures
   */
  gates: {
    /** Gate configuration factories */
    configs: {
      lint: gateConfigs.lint,
      test: gateConfigs.test,
      e2e: gateConfigs.e2e,
      security: gateConfigs.security,
      build: gateConfigs.build,
      flaky: gateConfigs.flaky,
      containerized: gateConfigs.containerized,
      withArtifacts: gateConfigs.withArtifacts,
      slow: gateConfigs.slow,
      standard: gateConfigs.standard,
      full: gateConfigs.full,
      failing: gateConfigs.failing,
      passing: gateConfigs.passing,
    },

    /** Gate result factories */
    results: {
      pass: gateResults.pass,
      fail: gateResults.fail,
      blocked: gateResults.blocked,
      skipped: gateResults.skipped,
      retrying: gateResults.retrying,
      allPass: gateResults.allPass,
      allFail: gateResults.allFail,
      someFail: gateResults.someFail,
      withRetries: gateResults.withRetries,
      withArtifacts: gateResults.withArtifacts,
      slowPass: gateResults.slowPass,
      testSuite: gateResults.testSuite,
      lintResult: gateResults.lintResult,
    },
  },

  /**
   * Test utility helpers
   */
  utils: {
    /** Temporary directory utilities */
    tempDir: {
      create: tempDir.create,
      createWithFiles: tempDir.createWithFiles,
      cleanup: tempDir.cleanup,
      readFile: tempDir.readFile,
      writeFile: tempDir.writeFile,
      exists: tempDir.exists,
      listFiles: tempDir.listFiles,
    },

    /** Mock GitHub API utilities */
    mockGitHub: {
      createMockGitHub: mockGitHub.createMockGitHub,
      createErrorMock: mockGitHub.createErrorMock,
      createRateLimitedMock: mockGitHub.createRateLimitedMock,
      createSlowMock: mockGitHub.createSlowMock,
    },

    /** Cleanup utilities */
    cleanup: {
      createCleanupManager: cleanup.createCleanupManager,
      withCleanup: cleanup.withCleanup,
    },
  },

  /**
   * Complete end-to-end scenarios
   */
  scenarios: {
    simpleSuccess: scenarios.simpleSuccess,
    linearChain: scenarios.linearChain,
    diamondMerge: scenarios.diamondMerge,
    complexMerge: scenarios.complexMerge,
    withGateFailures: scenarios.withGateFailures,
    withRetries: scenarios.withRetries,
    withBlockedPRs: scenarios.withBlockedPRs,
    empty: scenarios.empty,
    syntheticSixPRWeave: syntheticWeave.syntheticSixPRWeave,
    getFileChangesForPR: syntheticWeave.getFileChangesForPR,
  },
};

// Re-export types for convenience
export type { MockPR } from "./prs/basic.js";
export type { MockOctokit } from "./utils/mockGitHub.js";
export type { Scenario } from "./scenarios/mergeWorkflows.js";
export type { SyntheticWeaveScenario } from "./scenarios/syntheticWeave.js";

/**
 * Default export for convenience
 */
export default fixtures;
