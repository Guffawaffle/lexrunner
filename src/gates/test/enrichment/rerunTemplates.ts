/**
 * Test rerun command templates for various test runners
 */

/**
 * Test runner types
 */
export type TestRunner = "vitest" | "jest" | "node" | "pytest" | "go" | "phpunit";

/**
 * Template for rerunning a specific test
 */
interface RerunTemplate {
  /** Command template (use {testName} placeholder) */
  command: string;
  /** Description of the command */
  description: string;
}

/**
 * Rerun command templates by test runner
 */
const RERUN_TEMPLATES: Record<TestRunner, RerunTemplate> = {
  vitest: {
    command: 'npx vitest run -t "{testName}"',
    description: "Run specific test with Vitest",
  },
  jest: {
    command: 'npx jest -t "{testName}"',
    description: "Run specific test with Jest",
  },
  node: {
    command: 'node --test --test-name-pattern="{testName}"',
    description: "Run specific test with Node.js test runner",
  },
  pytest: {
    command: 'pytest -k "{testName}"',
    description: "Run specific test with pytest",
  },
  go: {
    command: 'go test -run "{testName}"',
    description: "Run specific test with Go",
  },
  phpunit: {
    command: 'phpunit --filter "{testName}"',
    description: "Run specific test with PHPUnit",
  },
};

/**
 * Get rerun command for a specific test
 *
 * @param testName - Name of the test to rerun
 * @param runner - Test runner to use
 * @returns Command string to rerun the test
 */
export function getRerunCommand(testName: string, runner: TestRunner): string {
  const template = RERUN_TEMPLATES[runner];
  if (!template) {
    throw new Error(`Unknown test runner: ${runner}`);
  }

  return template.command.replace("{testName}", testName);
}

/**
 * Get all available test runners
 *
 * @returns Array of supported test runner names
 */
export function getAvailableRunners(): TestRunner[] {
  return Object.keys(RERUN_TEMPLATES) as TestRunner[];
}

/**
 * Get template for a specific runner
 *
 * @param runner - Test runner to get template for
 * @returns Template object or undefined
 */
export function getTemplate(runner: TestRunner): RerunTemplate | undefined {
  return RERUN_TEMPLATES[runner];
}

/**
 * Detect test runner from package.json or context
 *
 * @param context - Optional context with test info
 * @returns Detected runner or 'node' as default
 */
export function detectRunner(context?: { framework?: string }): TestRunner {
  const framework = context?.framework?.toLowerCase();

  if (!framework) {
    return "node";
  }

  if (framework.includes("vitest")) return "vitest";
  if (framework.includes("jest")) return "jest";
  if (framework.includes("pytest") || framework.includes("py.test")) return "pytest";
  if (framework.includes("go") || framework.includes("golang")) return "go";
  if (framework.includes("phpunit")) return "phpunit";

  return "node";
}
