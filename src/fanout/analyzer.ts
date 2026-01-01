/**
 * D1 Analyzer — Pure Computation with Evidence IDs
 *
 * Refactored analyzer that takes a HarvestBundle as input and produces
 * an AnalysisPool with explicit evidence IDs for every computed fact.
 *
 * Design principles:
 * - Pure functions: no side effects, no API calls
 * - Deterministic: same input → same output
 * - Evidence IDs: every fact is referenceable
 * - No recommendations: just data (recommendations are D2's job)
 *
 * @module
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { computeBundleDigest } from "./harvest.js";

import type {
  HarvestBundle,
  HarvestedIssue,
  HarvestedPR,
  IssueAnalysis,
  OverlapEvidence,
  DependencyNode,
  HotspotEvidence,
  AnalysisPool,
} from "./types.js";
import { parseAnalysisPool } from "./types.js";

// =============================================================================
// EVIDENCE ID GENERATION
// =============================================================================

let evidenceCounters: Record<string, number> = {};

/**
 * Generate next evidence ID for a category
 * Format: E-{CATEGORY}-{SEQUENCE}
 */
function nextEvidenceId(category: string): string {
  evidenceCounters[category] = (evidenceCounters[category] || 0) + 1;
  return `E-${category}-${String(evidenceCounters[category]).padStart(3, "0")}`;
}

/**
 * Reset evidence counters (for deterministic generation)
 */
function resetEvidenceCounters(): void {
  evidenceCounters = {};
}

// =============================================================================
// TOOL VERSION
// =============================================================================

function getToolVersion(): string {
  // In a real implementation, read from package.json
  // For now, hardcode to avoid sync file read
  return "lexrunner@0.8.0";
}

// =============================================================================
// ISSUE ANALYSIS
// =============================================================================

/**
 * Extract file paths from issue body
 */
function extractAffectedFiles(body: string | null): string[] {
  if (!body) return [];

  const files = new Set<string>();

  // Match file paths (common patterns)
  const patterns = [
    // src/path/to/file.ts
    /(?:^|\s)([a-zA-Z0-9_\-./]+\.[a-z]{1,4})(?:\s|$)/gm,
    // Markdown code blocks with file paths
    /```[a-z]*\s*\n?(?:File|Path):\s*([^\n]+)/gim,
    // - src/file.ts or * src/file.ts
    /^[\s*-]+(?:File|Path)?:?\s*([a-zA-Z0-9_\-./]+\.[a-z]{1,4})/gm,
  ];

  for (const pattern of patterns) {
    const matches = body.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const file = match[1].trim();
        // Filter out URLs and common non-file patterns
        if (!file.includes("http") && !file.includes("://") && file.includes("/")) {
          files.add(file);
        }
      }
    }
  }

  return Array.from(files).sort();
}

/**
 * Extract modules from file paths
 * Simple heuristic: top-level directory under src/
 */
function extractModulesFromFiles(files: string[]): string[] {
  const modules = new Set<string>();

  for (const file of files) {
    const parts = file.split("/");
    // If file is src/module/... extract "module"
    if (parts.length >= 2 && parts[0] === "src") {
      modules.add(parts[1]);
    }
  }

  return Array.from(modules).sort();
}

/**
 * Extract issue dependencies from body
 * Patterns: Depends-on, Blocks, Blocked by, Requires
 */
function extractDependencies(
  body: string | null
): Array<{ type: "depends-on" | "blocks" | "blocked-by"; target: string }> {
  if (!body) return [];

  const deps: Array<{ type: "depends-on" | "blocks" | "blocked-by"; target: string }> = [];

  // Match patterns like:
  // Depends-on: #123, #456
  // Depends: #123
  // Requires: #123
  // Blocks: #789
  // Blocked by: #456
  const dependsPattern = /(?:Depends-on|Depends|Requires):\s*([^\n]+)/gi;
  const blocksPattern = /Blocks:\s*([^\n]+)/gi;
  const blockedByPattern = /Blocked\s+by:\s*([^\n]+)/gi;

  // Helper to extract issue numbers from a line
  const extractIssueRefs = (line: string): string[] => {
    const refs: string[] = [];
    // Match #123 or owner/repo#123
    const issuePattern = /((?:[\w-]+\/[\w-]+)?#\d+)/g;
    for (const match of line.matchAll(issuePattern)) {
      refs.push(match[1]);
    }
    return refs;
  };

  // Extract "depends-on" type
  for (const match of body.matchAll(dependsPattern)) {
    const refs = extractIssueRefs(match[1]);
    for (const ref of refs) {
      deps.push({ type: "depends-on", target: ref });
    }
  }

  // Extract "blocks" type
  for (const match of body.matchAll(blocksPattern)) {
    const refs = extractIssueRefs(match[1]);
    for (const ref of refs) {
      deps.push({ type: "blocks", target: ref });
    }
  }

  // Extract "blocked-by" type
  for (const match of body.matchAll(blockedByPattern)) {
    const refs = extractIssueRefs(match[1]);
    for (const ref of refs) {
      deps.push({ type: "blocked-by", target: ref });
    }
  }

  return deps;
}

/**
 * Detect acceptance criteria in issue body
 * Patterns: ## AC, ## Acceptance, - [ ] checklist
 */
function hasAcceptanceCriteria(body: string | null): boolean {
  if (!body) return false;

  // Check for explicit AC sections
  if (/##\s*(AC|Acceptance\s+Criteria)/i.test(body)) {
    return true;
  }

  // Check for checklist (at least 2 items)
  const checklistMatches = body.match(/^[\s*-]+\[\s*\]/gm);
  return checklistMatches ? checklistMatches.length >= 2 : false;
}

/**
 * Detect definition of done in issue body
 * Patterns: ## DOD, ## Definition of Done
 */
function hasDefinitionOfDone(body: string | null): boolean {
  if (!body) return false;
  return /##\s*(DOD|Definition\s+of\s+Done)/i.test(body);
}

/**
 * Check if Copilot is assigned
 */
function hasCopilotAssignment(assignees: string[]): boolean {
  return assignees.some((a) => a.toLowerCase() === "copilot");
}

/**
 * Compute complexity score
 */
function computeComplexity(
  body: string | null,
  affectedFiles: string[]
): {
  score: number;
  estimatedFiles: number;
  estimatedLines: number;
  confidence: "low" | "medium" | "high";
} {
  // Estimate based on affected files
  let estimatedFiles = affectedFiles.length;

  // Look for explicit mentions of file count or scope
  if (body) {
    const fileCountMatch = body.match(/(\d+)\s+files?/i);
    if (fileCountMatch) {
      estimatedFiles = Math.max(estimatedFiles, parseInt(fileCountMatch[1]));
    }
  }

  // Estimate lines of code
  let estimatedLines = estimatedFiles * 50; // Base estimate

  if (body) {
    const linesMatch = body.match(/(\d+)\s+lines?/i);
    if (linesMatch) {
      estimatedLines = parseInt(linesMatch[1]);
    }
  }

  // Compute complexity score (0-10)
  const fileScore = Math.min(estimatedFiles / 10, 5);
  const lineScore = Math.min(estimatedLines / 500, 5);
  const score = Math.min(fileScore + lineScore, 10);

  // Determine confidence
  let confidence: "low" | "medium" | "high" = "low";
  if (body && (body.includes("files") || body.includes("lines"))) {
    confidence = "medium";
  }
  if (affectedFiles.length > 0) {
    confidence = "medium";
  }
  if (body && body.match(/\d+\s+lines?/i)) {
    confidence = "high";
  }

  return {
    score: Math.round(score * 10) / 10,
    estimatedFiles,
    estimatedLines,
    confidence,
  };
}

/**
 * Determine if judgment is required
 */
function determineJudgmentRequired(
  hasAC: boolean,
  hasDOD: boolean,
  complexity: { score: number },
  affectedFiles: string[]
): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!hasAC) {
    reasons.push("missing AC");
  }

  if (!hasDOD) {
    reasons.push("missing DOD");
  }

  if (complexity.score >= 7) {
    reasons.push("high complexity");
  }

  if (affectedFiles.length === 0) {
    reasons.push("ambiguous scope");
  }

  return {
    required: reasons.length > 0,
    reasons,
  };
}

/**
 * Analyze a single issue
 */
function analyzeIssue(issue: HarvestedIssue): IssueAnalysis {
  const evidenceId = nextEvidenceId("ISSUE");
  const affectedFiles = extractAffectedFiles(issue.body);
  const affectedModules = extractModulesFromFiles(affectedFiles);
  const explicitDependencies = extractDependencies(issue.body);
  const hasAC = hasAcceptanceCriteria(issue.body);
  const hasDOD = hasDefinitionOfDone(issue.body);
  const hasCopilot = hasCopilotAssignment(issue.assignees);
  const complexity = computeComplexity(issue.body, affectedFiles);
  const judgmentRequired = determineJudgmentRequired(hasAC, hasDOD, complexity, affectedFiles);

  return {
    evidenceId,
    issueNumber: issue.number,
    affectedFiles,
    affectedModules,
    explicitDependencies,
    hasAcceptanceCriteria: hasAC,
    hasDefinitionOfDone: hasDOD,
    hasCopilotAssignment: hasCopilot,
    complexity,
    judgmentRequired,
  };
}

// =============================================================================
// OVERLAP COMPUTATION
// =============================================================================

/**
 * Jaccard index for set similarity
 */
function jaccardIndex(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) {
    return 0;
  }

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Compute overlap between two issues
 */
function computeOverlap(issue1: IssueAnalysis, issue2: IssueAnalysis): OverlapEvidence {
  const evidenceId = nextEvidenceId("OVERLAP");

  // File overlap
  const fileOverlap = jaccardIndex(new Set(issue1.affectedFiles), new Set(issue2.affectedFiles));

  // Directory overlap (from files)
  const dirs1 = new Set<string>();
  const dirs2 = new Set<string>();
  for (const file of issue1.affectedFiles) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs1.add(parts.slice(0, i).join("/"));
    }
  }
  for (const file of issue2.affectedFiles) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs2.add(parts.slice(0, i).join("/"));
    }
  }
  const directoryOverlap = jaccardIndex(dirs1, dirs2);

  // Label overlap (not in IssueAnalysis, so set to 0)
  const labelOverlap = 0;

  // Module overlap
  const moduleOverlap = jaccardIndex(
    new Set(issue1.affectedModules),
    new Set(issue2.affectedModules)
  );

  // Weighted score
  const score =
    fileOverlap * 0.4 + directoryOverlap * 0.3 + labelOverlap * 0.0 + moduleOverlap * 0.3;

  // Determine conflict risk
  let conflictRisk: "none" | "low" | "medium" | "high" = "none";
  if (score > 0.7) {
    conflictRisk = "high";
  } else if (score > 0.4) {
    conflictRisk = "medium";
  } else if (score > 0.1) {
    conflictRisk = "low";
  }

  return {
    evidenceId,
    issue1: issue1.issueNumber,
    issue2: issue2.issueNumber,
    score: Math.round(score * 1000) / 1000,
    breakdown: {
      fileOverlap: Math.round(fileOverlap * 1000) / 1000,
      directoryOverlap: Math.round(directoryOverlap * 1000) / 1000,
      labelOverlap: Math.round(labelOverlap * 1000) / 1000,
      moduleOverlap: Math.round(moduleOverlap * 1000) / 1000,
    },
    conflictRisk,
  };
}

/**
 * Compute overlaps for all issue pairs
 */
function computeOverlaps(issues: IssueAnalysis[]): OverlapEvidence[] {
  const overlaps: OverlapEvidence[] = [];

  for (let i = 0; i < issues.length; i++) {
    for (let j = i + 1; j < issues.length; j++) {
      overlaps.push(computeOverlap(issues[i], issues[j]));
    }
  }

  // Sort for deterministic output
  overlaps.sort((a, b) => {
    if (a.issue1 !== b.issue1) return a.issue1 - b.issue1;
    return a.issue2 - b.issue2;
  });

  return overlaps;
}

// =============================================================================
// DEPENDENCY GRAPH
// =============================================================================

/**
 * Parse issue number from dependency target
 * Supports: #123, owner/repo#123
 */
function parseIssueNumber(target: string): number | null {
  // Match #123 or owner/repo#123
  const match = target.match(/#(\d+)$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Build dependency graph
 */
function buildDependencyGraph(issues: IssueAnalysis[]): DependencyNode[] {
  const issueNumbers = new Set(issues.map((i) => i.issueNumber));
  const nodes: DependencyNode[] = [];

  // Initialize nodes
  for (const issue of issues) {
    const dependsOn: number[] = [];
    const blockedBy: number[] = [];

    // Process explicit dependencies
    for (const dep of issue.explicitDependencies) {
      const targetNum = parseIssueNumber(dep.target);
      if (targetNum && issueNumbers.has(targetNum)) {
        if (dep.type === "depends-on") {
          dependsOn.push(targetNum);
        } else if (dep.type === "blocked-by") {
          blockedBy.push(targetNum);
        } else if (dep.type === "blocks") {
          // If A blocks B, then B depends on A
          // This is handled in the reverse direction
        }
      }
    }

    nodes.push({
      issueNumber: issue.issueNumber,
      dependsOn: [...new Set(dependsOn)].sort(),
      blockedBy: [...new Set(blockedBy)].sort(),
      layer: -1, // Will be computed by classifyLayers
    });
  }

  // Handle "blocks" relationships (reverse direction)
  for (const issue of issues) {
    for (const dep of issue.explicitDependencies) {
      if (dep.type === "blocks") {
        const targetNum = parseIssueNumber(dep.target);
        if (targetNum && issueNumbers.has(targetNum)) {
          const targetNode = nodes.find((n) => n.issueNumber === targetNum);
          if (targetNode && !targetNode.dependsOn.includes(issue.issueNumber)) {
            targetNode.dependsOn.push(issue.issueNumber);
            targetNode.dependsOn.sort();
          }
        }
      }
    }
  }

  return nodes;
}

/**
 * Classify issues into topological layers
 * Layer 0 = no dependencies
 * Layer N = all dependencies are in layers 0..N-1
 */
function classifyLayers(graph: DependencyNode[]): Record<string, number[]> {
  const layers: Record<string, number[]> = {};
  const nodeMap = new Map(graph.map((n) => [n.issueNumber, n]));

  // Compute layers using Kahn's algorithm (topological sort)
  const inDegree = new Map<number, number>();
  for (const node of graph) {
    inDegree.set(node.issueNumber, node.dependsOn.length + node.blockedBy.length);
  }

  let currentLayer = 0;
  const processed = new Set<number>();

  while (processed.size < graph.length) {
    const layerIssues: number[] = [];

    // Find all nodes with in-degree 0 that haven't been processed
    for (const node of graph) {
      if (!processed.has(node.issueNumber) && inDegree.get(node.issueNumber) === 0) {
        layerIssues.push(node.issueNumber);
        processed.add(node.issueNumber);
        node.layer = currentLayer;
      }
    }

    // If no progress, there's a cycle or unresolvable dependencies
    if (layerIssues.length === 0 && processed.size < graph.length) {
      // Put remaining in next layer
      for (const node of graph) {
        if (!processed.has(node.issueNumber)) {
          layerIssues.push(node.issueNumber);
          processed.add(node.issueNumber);
          node.layer = currentLayer;
        }
      }
    }

    if (layerIssues.length > 0) {
      layers[String(currentLayer)] = layerIssues.sort();

      // Reduce in-degree for dependent nodes
      for (const issueNum of layerIssues) {
        const node = nodeMap.get(issueNum);
        if (!node) continue;

        // For each node that depends on this one, reduce its in-degree
        for (const otherNode of graph) {
          if (otherNode.dependsOn.includes(issueNum) || otherNode.blockedBy.includes(issueNum)) {
            inDegree.set(otherNode.issueNumber, (inDegree.get(otherNode.issueNumber) || 0) - 1);
          }
        }
      }

      currentLayer++;
    }
  }

  return layers;
}

// =============================================================================
// HOTSPOT COMPUTATION
// =============================================================================

/**
 * Compute hotspots from issues and PRs
 */
function computeHotspots(issues: IssueAnalysis[], prs: HarvestedPR[]): HotspotEvidence[] {
  const fileTouches = new Map<string, Set<number>>();

  // Count how many issues touch each file
  for (const issue of issues) {
    for (const file of issue.affectedFiles) {
      if (!fileTouches.has(file)) {
        fileTouches.set(file, new Set());
      }
      fileTouches.get(file)!.add(issue.issueNumber);
    }
  }

  // Also count from PRs
  for (const pr of prs) {
    for (const file of pr.touchedFiles) {
      if (!fileTouches.has(file)) {
        fileTouches.set(file, new Set());
      }
      // Use negative PR numbers to distinguish from issues
      fileTouches.get(file)!.add(-pr.number);
    }
  }

  const hotspots: HotspotEvidence[] = [];

  // Create hotspot evidence for files touched by multiple issues
  for (const [path, touches] of fileTouches.entries()) {
    // Only include files touched by at least 2 issues
    const issueNumbers = Array.from(touches).filter((n) => n > 0);
    if (issueNumbers.length >= 2) {
      const evidenceId = nextEvidenceId("HOTSPOT");

      // Determine risk level based on touch count
      let riskLevel: "low" | "medium" | "high" = "low";
      if (issueNumbers.length >= 5) {
        riskLevel = "high";
      } else if (issueNumbers.length >= 3) {
        riskLevel = "medium";
      }

      hotspots.push({
        evidenceId,
        path,
        commitCount30d: null, // Not computed (would require git history)
        authorCount30d: null, // Not computed (would require git history)
        touchedByIssues: issueNumbers.sort(),
        riskLevel,
      });
    }
  }

  // Sort by risk level and touch count
  hotspots.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.touchedByIssues.length - a.touchedByIssues.length;
  });

  return hotspots;
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

/**
 * Analyze a HarvestBundle and produce an AnalysisPool
 *
 * This is a pure function: same input → same output
 */
export function analyze(bundle: HarvestBundle): AnalysisPool {
  // Reset evidence counters for determinism
  resetEvidenceCounters();

  const analyzedAt = new Date().toISOString();
  const harvestDigest = computeBundleDigest(bundle);

  // Analyze all issues
  const issues = bundle.issues.map((issue) => analyzeIssue(issue));

  // Compute overlaps
  const overlaps = computeOverlaps(issues);

  // Build dependency graph
  const dependencyGraph = buildDependencyGraph(issues);

  // Classify layers
  const layers = classifyLayers(dependencyGraph);

  // Compute hotspots
  const hotspots = computeHotspots(issues, bundle.pullRequests);

  // Identify ready issues (layer 0, no judgment required)
  const readyIssues = (layers["0"] || []).filter((issueNum) => {
    const issue = issues.find((i) => i.issueNumber === issueNum);
    return issue && !issue.judgmentRequired.required;
  });

  // Compute security posture
  const securityPosture = {
    source: bundle.securitySignals.source,
    fixableVulnerabilities:
      bundle.securitySignals.vulnerabilities?.filter((v) => v.fixAvailable).length ?? null,
    totalVulnerabilities: bundle.securitySignals.vulnerabilities?.length ?? null,
  };

  // Compute summary stats
  const maxLayer = Math.max(...Object.keys(layers).map((k) => parseInt(k)), -1);
  const judgmentRequiredCount = issues.filter((i) => i.judgmentRequired.required).length;
  const highOverlapPairs = overlaps.filter((o) => o.score > 0.5).length;

  return {
    schemaVersion: "1.0.0",
    harvestDigest,
    analyzedAt,
    toolVersion: getToolVersion(),
    issues,
    overlaps,
    dependencyGraph,
    hotspots,
    layers,
    readyIssues,
    securityPosture,
    summary: {
      totalIssues: issues.length,
      totalPRs: bundle.pullRequests.length,
      highOverlapPairs,
      maxLayer,
      judgmentRequiredCount,
    },
  };
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Save an AnalysisPool to a file
 */
export async function saveAnalysisPool(pool: AnalysisPool, filePath: string): Promise<void> {
  const json = canonicalJSONStringify(pool);
  await fs.writeFile(filePath, json, "utf-8");
}

/**
 * Load and validate an AnalysisPool from a file
 */
export async function loadAnalysisPool(filePath: string): Promise<AnalysisPool> {
  const content = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(content);
  return parseAnalysisPool(data);
}
