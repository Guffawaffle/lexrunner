/**
 * Audit Context Collection
 *
 * Collects environment metadata for audit events:
 * - Git context (commit, branch, author, etc.)
 * - CI context (provider, run info, etc.)
 * - OS context (platform, architecture, etc.)
 */

import { execa } from "execa";
import * as os from "os";

/**
 * Git context information
 */
export interface GitContext {
  commit: string;
  branch: string;
  remote?: string;
  author?: string;
  committer?: string;
  message?: string;
  dirty: boolean;
  tags?: string[];
}

/**
 * CI context information
 */
export interface CIContext {
  provider: string;
  run_id?: string;
  run_number?: string;
  workflow?: string;
  job?: string;
  actor?: string;
  event_name?: string;
  ref?: string;
  sha?: string;
}

/**
 * OS context information
 */
export interface OSContext {
  platform: string;
  release: string;
  arch: string;
  hostname?: string;
  user?: string;
  uptime?: number;
  loadavg?: number[];
}

/**
 * Combined audit context
 */
export interface AuditContext {
  git?: GitContext;
  ci?: CIContext;
  os?: OSContext;
}

/**
 * Collect requested context blocks
 */
export async function collectContext(contextTypes: ("git" | "ci" | "os")[]): Promise<AuditContext> {
  const context: AuditContext = {};

  for (const type of contextTypes) {
    switch (type) {
      case "git":
        context.git = await collectGitContext();
        break;
      case "ci":
        context.ci = await collectCIContext();
        break;
      case "os":
        context.os = collectOSContext();
        break;
    }
  }

  return context;
}

/**
 * Collect git context from repository
 */
async function collectGitContext(): Promise<GitContext> {
  try {
    // Get commit hash
    const { stdout: commit } = await execa("git", ["rev-parse", "HEAD"]);

    // Get branch name
    const { stdout: branch } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

    // Get remote URL (try origin first)
    let remote: string | undefined;
    try {
      const { stdout } = await execa("git", ["remote", "get-url", "origin"]);
      remote = stdout;
    } catch {
      // Remote might not exist
    }

    // Get author email from latest commit
    let author: string | undefined;
    try {
      const { stdout } = await execa("git", ["log", "-1", "--format=%ae"]);
      author = stdout;
    } catch {
      // Might fail in empty repo
    }

    // Get committer email from latest commit
    let committer: string | undefined;
    try {
      const { stdout } = await execa("git", ["log", "-1", "--format=%ce"]);
      committer = stdout;
    } catch {
      // Might fail in empty repo
    }

    // Get commit message
    let message: string | undefined;
    try {
      const { stdout } = await execa("git", ["log", "-1", "--format=%s"]);
      message = stdout;
    } catch {
      // Might fail in empty repo
    }

    // Check if repo is dirty
    const { stdout: statusOutput } = await execa("git", ["status", "--porcelain"]);
    const dirty = statusOutput.trim().length > 0;

    // Get tags pointing to current commit
    let tags: string[] | undefined;
    try {
      const { stdout } = await execa("git", ["tag", "--points-at", "HEAD"]);
      const tagList = stdout
        .trim()
        .split("\n")
        .filter((t) => t.length > 0);
      if (tagList.length > 0) {
        tags = tagList;
      }
    } catch {
      // Tags might not exist
    }

    return {
      commit,
      branch,
      remote,
      author,
      committer,
      message,
      dirty,
      tags,
    };
  } catch (error) {
    // If git fails, return minimal context
    return {
      commit: "unknown",
      branch: "unknown",
      dirty: false,
    };
  }
}

/**
 * Collect CI context from environment variables
 */
async function collectCIContext(): Promise<CIContext> {
  // GitHub Actions
  if (process.env.GITHUB_ACTIONS === "true") {
    return {
      provider: "github-actions",
      run_id: process.env.GITHUB_RUN_ID,
      run_number: process.env.GITHUB_RUN_NUMBER,
      workflow: process.env.GITHUB_WORKFLOW,
      job: process.env.GITHUB_JOB,
      actor: process.env.GITHUB_ACTOR,
      event_name: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
    };
  }

  // GitLab CI
  if (process.env.GITLAB_CI === "true") {
    return {
      provider: "gitlab-ci",
      run_id: process.env.CI_PIPELINE_ID,
      run_number: process.env.CI_PIPELINE_IID,
      workflow: process.env.CI_PIPELINE_SOURCE,
      job: process.env.CI_JOB_NAME,
      actor: process.env.GITLAB_USER_LOGIN,
      event_name: process.env.CI_PIPELINE_SOURCE,
      ref: process.env.CI_COMMIT_REF_NAME,
      sha: process.env.CI_COMMIT_SHA,
    };
  }

  // CircleCI
  if (process.env.CIRCLECI === "true") {
    return {
      provider: "circleci",
      run_id: process.env.CIRCLE_WORKFLOW_ID,
      run_number: process.env.CIRCLE_BUILD_NUM,
      workflow: process.env.CIRCLE_JOB,
      job: process.env.CIRCLE_JOB,
      actor: process.env.CIRCLE_USERNAME,
      ref: process.env.CIRCLE_BRANCH,
      sha: process.env.CIRCLE_SHA1,
    };
  }

  // Jenkins
  if (process.env.JENKINS_URL) {
    return {
      provider: "jenkins",
      run_id: process.env.BUILD_ID,
      run_number: process.env.BUILD_NUMBER,
      workflow: process.env.JOB_NAME,
      job: process.env.JOB_NAME,
      ref: process.env.GIT_BRANCH,
      sha: process.env.GIT_COMMIT,
    };
  }

  // Generic CI detection
  if (process.env.CI === "true") {
    return {
      provider: "generic-ci",
      run_number: process.env.BUILD_NUMBER,
    };
  }

  // Not in CI
  return {
    provider: "local",
  };
}

/**
 * Collect OS context from system
 */
function collectOSContext(): OSContext {
  const context: OSContext = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
  };

  // Add optional fields
  try {
    context.hostname = os.hostname();
  } catch {
    // Hostname might not be available
  }

  try {
    context.user = os.userInfo().username;
  } catch {
    // User info might not be available
  }

  try {
    context.uptime = os.uptime();
  } catch {
    // Uptime might not be available
  }

  try {
    context.loadavg = os.loadavg();
  } catch {
    // Load average might not be available on all platforms
  }

  return context;
}
