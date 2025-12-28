/**
 * Determinism Framework - Toolchain Pinning and Environment Reproducibility
 *
 * Ensures merge-weave operations are 100% reproducible across machines and time
 * by pinning toolchain versions and environment variables.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ToolchainManifest {
  recordedAt: string;
  environment: Record<string, string>;
  tools: Record<string, string>;
  os: {
    platform: string;
    release: string;
    arch: string;
  };
}

export interface ToolVersion {
  name: string;
  version: string;
  pinned?: string;
  matches: boolean;
}

/**
 * Get version of a tool by running its version command.
 */
async function getToolVersion(tool: string): Promise<string> {
  try {
    let versionCmd = `${tool} --version`;

    // Special cases for tools with different version flags
    if (tool === "npm") {
      versionCmd = "npm --version";
    } else if (tool === "node") {
      versionCmd = "node --version";
    } else if (tool === "git") {
      versionCmd = "git --version";
    }

    const output = execSync(versionCmd, { encoding: "utf8" }).trim();

    // Parse version from output
    if (tool === "git") {
      // "git version 2.45.2" -> "2.45.2"
      const match = output.match(/git version ([\d.]+)/);
      return match ? match[1] : output;
    } else if (tool === "node") {
      // "v20.18.0" -> "20.18.0"
      return output.replace(/^v/, "");
    } else if (tool === "npm") {
      // "10.8.2" -> "10.8.2"
      return output;
    } else if (tool === "typescript") {
      // "Version 5.6.3" -> "5.6.3"
      const match = output.match(/Version ([\d.]+)/);
      return match ? match[1] : output;
    } else {
      // For other tools, try to extract version number
      const match = output.match(/([\d.]+)/);
      return match ? match[1] : output;
    }
  } catch (error) {
    return "unknown";
  }
}

/**
 * Get version from package.json for Node.js dependencies.
 */
function getPackageJsonVersion(packageName: string): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Check dependencies and devDependencies
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    let version = deps[packageName] || devDeps[packageName];

    if (version) {
      // Remove ^ or ~ prefix
      version = version.replace(/^[\^~]/, "");
      return version;
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Read pinned versions from .tool-versions or .nvmrc.
 */
function readPinnedVersions(): Record<string, string> {
  const pinned: Record<string, string> = {};

  // Read .tool-versions (asdf/mise format)
  const toolVersionsPath = path.resolve(process.cwd(), ".tool-versions");
  if (fs.existsSync(toolVersionsPath)) {
    const content = fs.readFileSync(toolVersionsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

    for (const line of lines) {
      const [tool, version] = line.trim().split(/\s+/);
      if (tool && version) {
        pinned[tool] = version;
      }
    }
  }

  // Read .nvmrc for Node.js version
  const nvmrcPath = path.resolve(process.cwd(), ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const version = fs.readFileSync(nvmrcPath, "utf8").trim();
    pinned.node = version;
  }

  return pinned;
}

/**
 * Generate toolchain manifest for current environment.
 */
export async function generateToolchainManifest(): Promise<ToolchainManifest> {
  const tools: Record<string, string> = {};

  // Detect tool versions
  tools.git = await getToolVersion("git");
  tools.node = await getToolVersion("node");
  tools.npm = await getToolVersion("npm");

  // Get versions from package.json for TypeScript tooling
  tools.typescript = getPackageJsonVersion("typescript");
  tools.eslint = getPackageJsonVersion("eslint");

  // Capture relevant environment variables
  const environment: Record<string, string> = {};
  const envVars = ["TZ", "LANG", "LC_ALL", "NODE_ENV", "CI"];

  for (const envVar of envVars) {
    if (process.env[envVar]) {
      environment[envVar] = process.env[envVar]!;
    }
  }

  // Capture OS information
  const osInfo = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
  };

  return {
    recordedAt: new Date().toISOString(),
    environment,
    tools,
    os: osInfo,
  };
}

/**
 * Verify current toolchain matches pinned versions.
 * @throws {Error} if versions mismatch
 */
export async function verifyToolchainPins(): Promise<ToolVersion[]> {
  const pinnedVersions = readPinnedVersions();
  const results: ToolVersion[] = [];

  // Check git version
  const gitVersion = await getToolVersion("git");
  results.push({
    name: "git",
    version: gitVersion,
    pinned: pinnedVersions.git,
    matches: !pinnedVersions.git || gitVersion === pinnedVersions.git,
  });

  // Check Node.js version
  const nodeVersion = await getToolVersion("node");
  results.push({
    name: "node",
    version: nodeVersion,
    pinned: pinnedVersions.node,
    matches: !pinnedVersions.node || nodeVersion === pinnedVersions.node,
  });

  // Check npm version
  const npmVersion = await getToolVersion("npm");
  results.push({
    name: "npm",
    version: npmVersion,
    pinned: pinnedVersions.npm,
    matches: !pinnedVersions.npm || npmVersion === pinnedVersions.npm,
  });

  // Check TypeScript version
  const tsVersion = getPackageJsonVersion("typescript");
  results.push({
    name: "typescript",
    version: tsVersion,
    pinned: pinnedVersions.typescript,
    matches: !pinnedVersions.typescript || tsVersion === pinnedVersions.typescript,
  });

  // Check ESLint version
  const eslintVersion = getPackageJsonVersion("eslint");
  results.push({
    name: "eslint",
    version: eslintVersion,
    pinned: pinnedVersions.eslint,
    matches: !pinnedVersions.eslint || eslintVersion === pinnedVersions.eslint,
  });

  return results;
}

/**
 * Check if all pinned versions match current versions.
 */
export async function allVersionsMatch(): Promise<boolean> {
  const results = await verifyToolchainPins();
  return results.every((r) => r.matches);
}
