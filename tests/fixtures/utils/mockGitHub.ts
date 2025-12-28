/**
 * Mock GitHub API responses for testing
 */

import type { MockPR } from "../prs/basic.js";

export interface MockOctokit {
  rest: {
    pulls: {
      list: (params?: { state?: string }) => Promise<{ data: MockPR[] }>;
      get: (params: { pull_number: number }) => Promise<{ data: MockPR }>;
      listFiles: (params: { pull_number: number }) => Promise<{
        data: MockPR["files"];
      }>;
    };
    issues: {
      listLabelsOnIssue: (params: { issue_number: number }) => Promise<{
        data: Array<{ name: string }>;
      }>;
      addLabels?: (params: { issue_number: number; labels: string[] }) => Promise<void>;
    };
  };
}

/**
 * Create a mock GitHub/Octokit client with fixture PRs
 */
export function createMockGitHub(prs: MockPR[]): MockOctokit {
  const prMap = new Map(prs.map((pr) => [pr.number, pr]));

  return {
    rest: {
      pulls: {
        list: async (params?: { state?: string }) => {
          const state = params?.state ?? "open";
          const filtered = state === "all" ? prs : prs.filter((pr) => pr.state === state);

          return { data: filtered };
        },
        get: async ({ pull_number }: { pull_number: number }) => {
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr };
        },
        listFiles: async ({ pull_number }: { pull_number: number }) => {
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr.files };
        },
      },
      issues: {
        listLabelsOnIssue: async ({ issue_number }: { issue_number: number }) => {
          const pr = prMap.get(issue_number);
          if (!pr) {
            throw new Error(`Issue #${issue_number} not found`);
          }
          return {
            data: pr.labels?.map((l) => ({ name: l.name })) ?? [],
          };
        },
        addLabels: async () => {
          // Mock implementation - no-op
        },
      },
    },
  };
}

/**
 * Create a mock that throws errors (for error handling tests)
 */
export function createErrorMock(errorMessage: string = "API Error"): MockOctokit {
  const error = async () => {
    throw new Error(errorMessage);
  };

  return {
    rest: {
      pulls: {
        list: error,
        get: error,
        listFiles: error,
      },
      issues: {
        listLabelsOnIssue: error,
      },
    },
  };
}

/**
 * Create a mock that simulates rate limiting
 */
export function createRateLimitedMock(
  prs: MockPR[],
  options: {
    limit?: number;
    resetAfterCalls?: number;
  } = {}
): MockOctokit {
  const limit = options.limit ?? 5;
  const resetAfter = options.resetAfterCalls ?? 10;
  let callCount = 0;

  const checkRateLimit = () => {
    callCount++;
    if (callCount % resetAfter < limit) {
      return;
    }
    const error = new Error("API rate limit exceeded") as APIError;
    error.status = 403;
    throw error;
  };

  const prMap = new Map(prs.map((pr) => [pr.number, pr]));

  return {
    rest: {
      pulls: {
        list: async (params?: { state?: string }) => {
          checkRateLimit();
          const state = params?.state ?? "open";
          return {
            data: prs.filter((pr) => pr.state === state),
          };
        },
        get: async ({ pull_number }: { pull_number: number }) => {
          checkRateLimit();
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr };
        },
        listFiles: async ({ pull_number }: { pull_number: number }) => {
          checkRateLimit();
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr.files };
        },
      },
      issues: {
        listLabelsOnIssue: async ({ issue_number }: { issue_number: number }) => {
          checkRateLimit();
          const pr = prMap.get(issue_number);
          if (!pr) {
            throw new Error(`Issue #${issue_number} not found`);
          }
          return {
            data: pr.labels?.map((l) => ({ name: l.name })) ?? [],
          };
        },
      },
    },
  };
}

/**
 * Create a mock with delayed responses (for timeout testing)
 */
export function createSlowMock(prs: MockPR[], delayMs: number = 1000): MockOctokit {
  const delay = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const prMap = new Map(prs.map((pr) => [pr.number, pr]));

  return {
    rest: {
      pulls: {
        list: async (params?: { state?: string }) => {
          await delay();
          const state = params?.state ?? "open";
          return {
            data: prs.filter((pr) => pr.state === state),
          };
        },
        get: async ({ pull_number }: { pull_number: number }) => {
          await delay();
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr };
        },
        listFiles: async ({ pull_number }: { pull_number: number }) => {
          await delay();
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr.files };
        },
      },
      issues: {
        listLabelsOnIssue: async ({ issue_number }: { issue_number: number }) => {
          await delay();
          const pr = prMap.get(issue_number);
          if (!pr) {
            throw new Error(`Issue #${issue_number} not found`);
          }
          return {
            data: pr.labels?.map((l) => ({ name: l.name })) ?? [],
          };
        },
      },
    },
  };
}

/**
 * Extended error type with status code
 */
interface APIError extends Error {
  status: number;
}
