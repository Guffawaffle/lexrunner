/**
 * Toolchain manifest generation for reproducibility and auditability
 * Captures tool versions and environment for deterministic execution verification
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface ToolchainManifest {
  schemaVersion: string;
  generated: string;
  tools: ToolVersion[];
  environment: EnvironmentInfo;
}

export interface ToolVersion {
  name: string;
  version: string;
  path?: string;
}

export interface EnvironmentInfo {
  timezone: string;
  locale: string;
  platform: string;
  arch: string;
  nodeVersion: string;
}

/**
 * Get version of a command-line tool
 */
function getToolVersion(command: string, versionFlag = "--version"): string | null {
  try {
    const output = execSync(`${command} ${versionFlag}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();

    // Extract version number from output
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : output.split("\n")[0];
  } catch {
    return null;
  }
}

/**
 * Get path to a command
 */
function getToolPath(command: string): string | undefined {
  try {
    return execSync(`which ${command}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Get version from package.json
 */
function getPackageVersion(packageName: string): string | null {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps[packageName]) {
      // Remove ^ or ~ prefix
      return deps[packageName].replace(/^[\^~]/, "");
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate toolchain manifest with current environment and tool versions
 */
export function generateToolchainManifest(): ToolchainManifest {
  const tools: ToolVersion[] = [];

  // Git version
  const gitVersion = getToolVersion("git");
  if (gitVersion) {
    tools.push({ name: "git", version: gitVersion, path: getToolPath("git") });
  }

  // Node.js version
  const nodeVersion = process.version.replace(/^v/, "");
  tools.push({ name: "Node.js", version: nodeVersion, path: process.execPath });

  // npm version
  const npmVersion = getToolVersion("npm");
  if (npmVersion) {
    tools.push({ name: "npm", version: npmVersion, path: getToolPath("npm") });
  }

  // TypeScript version (from package.json)
  const tsVersion = getPackageVersion("typescript");
  if (tsVersion) {
    tools.push({ name: "TypeScript", version: tsVersion });
  }

  // Prettier version (from package.json)
  const prettierVersion = getPackageVersion("prettier");
  if (prettierVersion) {
    tools.push({ name: "Prettier", version: prettierVersion });
  }

  // ESLint version (from package.json)
  const eslintVersion = getPackageVersion("eslint");
  if (eslintVersion) {
    tools.push({ name: "ESLint", version: eslintVersion });
  }

  // Environment info
  const environment: EnvironmentInfo = {
    timezone: process.env.TZ || "UTC",
    locale: process.env.LANG || "en_US.UTF-8",
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
  };

  return {
    schemaVersion: "1.0.0",
    generated: new Date().toISOString(),
    tools,
    environment,
  };
}

/**
 * Format toolchain manifest as Markdown table
 */
export function formatToolchainAsMarkdown(manifest: ToolchainManifest): string {
  const lines: string[] = [];

  lines.push("## Toolchain");
  lines.push("");
  lines.push("| Tool | Version |");
  lines.push("|------|---------|");

  for (const tool of manifest.tools) {
    lines.push(`| ${tool.name} | ${tool.version} |`);
  }

  lines.push("");
  lines.push(
    `**Environment:** TZ=${manifest.environment.timezone}, LANG=${manifest.environment.locale}`
  );
  lines.push("");
  lines.push("Full manifest: `toolchain-manifest.json`");

  return lines.join("\n");
}
