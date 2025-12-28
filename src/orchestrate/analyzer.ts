/**
 * Issue Analyzer - Analyze GitHub issues for parallelization and orchestration
 */

import type { GitHubIssue, GitHubClient } from "../github/client.js";
import type {
  IssueMetadata,
  OverlapScore,
  ParallelWorkGroup,
  IssueAnalysisResult,
} from "./types.js";

export class IssueAnalyzer {
  constructor(private client: GitHubClient) {}

  /**
   * Extract metadata from an issue
   */
  extractMetadata(issue: GitHubIssue): IssueMetadata {
    const body = issue.body || "";

    // Extract affected files/directories from issue body
    const affectedFiles = this.extractAffectedFiles(body);
    const affectedDirectories = this.extractDirectories(affectedFiles);

    // Extract dependencies
    const dependencies = this.extractDependencies(body);

    // Compute complexity
    const complexity = this.computeComplexity(body, affectedFiles);

    // Check for Copilot agent assignment
    const copilotAgent = this.extractCopilotAgent(body, issue.assignees);

    // Estimate duration
    const durationEstimate = this.estimateDuration(complexity, body);

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((l) => l.name).sort(),
      assignees: issue.assignees.map((a) => a.login).sort(),
      author: issue.user.login,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      affectedFiles,
      affectedDirectories,
      dependencies,
      complexity,
      copilotAgent,
      durationEstimate,
    };
  }

  /**
   * Extract file paths from issue body
   */
  private extractAffectedFiles(body: string): string[] {
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
   * Extract directories from file paths
   */
  private extractDirectories(files: string[]): string[] {
    const dirs = new Set<string>();

    for (const file of files) {
      const parts = file.split("/");
      // Add all directory levels
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }

    return Array.from(dirs).sort();
  }

  /**
   * Extract issue dependencies
   */
  private extractDependencies(body: string): string[] {
    const deps = new Set<string>();

    // Match patterns like:
    // Depends-on: #123, #456
    // Depends: #123
    // Requires: #123
    // Blocks: #789
    // Blocked by: #456
    const patterns = [
      /(?:Depends-on|Depends|Requires):\s*#(\d+)/gi,
      /(?:Blocks|Blocked by):\s*#(\d+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = body.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          deps.add(`#${match[1]}`);
        }
      }
    }

    return Array.from(deps).sort();
  }

  /**
   * Compute complexity score
   */
  private computeComplexity(
    body: string,
    affectedFiles: string[]
  ): {
    estimatedFiles: number;
    estimatedLines: number;
    score: number;
  } {
    // Estimate based on affected files
    let estimatedFiles = affectedFiles.length;

    // Look for explicit mentions of file count or scope
    const fileCountMatch = body.match(/(\d+)\s+files?/i);
    if (fileCountMatch) {
      estimatedFiles = Math.max(estimatedFiles, parseInt(fileCountMatch[1]));
    }

    // Estimate lines of code
    let estimatedLines = estimatedFiles * 50; // Base estimate

    const linesMatch = body.match(/(\d+)\s+lines?/i);
    if (linesMatch) {
      estimatedLines = parseInt(linesMatch[1]);
    }

    // Compute complexity score (0-10)
    const fileScore = Math.min(estimatedFiles / 10, 5);
    const lineScore = Math.min(estimatedLines / 500, 5);
    const score = Math.min(fileScore + lineScore, 10);

    return {
      estimatedFiles,
      estimatedLines,
      score: Math.round(score * 10) / 10,
    };
  }

  /**
   * Extract Copilot agent assignment
   */
  private extractCopilotAgent(
    body: string,
    assignees: Array<{ login: string }>
  ): {
    assigned: boolean;
    agent?: string;
  } {
    // Check if @copilot is assigned
    const copilotAssigned = assignees.some((a) => a.login.toLowerCase() === "copilot");

    // Look for agent assignment in body
    const agentMatch = body.match(/Agent:\s*([^\n]+)/i) || body.match(/@copilot\s+([^\s]+)/i);

    if (copilotAssigned || agentMatch) {
      return {
        assigned: true,
        agent: agentMatch?.[1]?.trim(),
      };
    }

    return { assigned: false };
  }

  /**
   * Estimate duration
   */
  private estimateDuration(
    complexity: { score: number },
    body: string
  ): {
    hours: number;
    confidence: "low" | "medium" | "high";
  } {
    // Base estimate from complexity
    let hours = complexity.score * 2; // 2 hours per complexity point
    let confidence: "low" | "medium" | "high" = "low";

    // Look for explicit time estimates
    const timeMatches = [
      body.match(/(\d+)\s*hours?/i),
      body.match(/(\d+)\s*days?/i),
      body.match(/(\d+)\s*weeks?/i),
    ];

    if (timeMatches[0]) {
      hours = parseInt(timeMatches[0][1]);
      confidence = "high";
    } else if (timeMatches[1]) {
      hours = parseInt(timeMatches[1][1]) * 8; // 8 hours per day
      confidence = "high";
    } else if (timeMatches[2]) {
      hours = parseInt(timeMatches[2][1]) * 40; // 40 hours per week
      confidence = "high";
    } else if (complexity.score > 5) {
      confidence = "medium";
    }

    return {
      hours: Math.round(hours * 10) / 10,
      confidence,
    };
  }

  /**
   * Compute overlap score between two issues
   */
  computeOverlap(issue1: IssueMetadata, issue2: IssueMetadata): OverlapScore {
    // File overlap (0-1)
    const fileOverlap = this.jaccardIndex(
      new Set(issue1.affectedFiles),
      new Set(issue2.affectedFiles)
    );

    // Directory overlap (0-1)
    const directoryOverlap = this.jaccardIndex(
      new Set(issue1.affectedDirectories),
      new Set(issue2.affectedDirectories)
    );

    // Label overlap (0-1)
    const labelOverlap = this.jaccardIndex(new Set(issue1.labels), new Set(issue2.labels));

    // Author overlap (0 or 1)
    const authorOverlap = issue1.author === issue2.author ? 1 : 0;

    // Weighted total score
    const score =
      fileOverlap * 0.4 + directoryOverlap * 0.3 + labelOverlap * 0.2 + authorOverlap * 0.1;

    return {
      issue1: issue1.number,
      issue2: issue2.number,
      score: Math.round(score * 1000) / 1000,
      fileOverlap: Math.round(fileOverlap * 1000) / 1000,
      directoryOverlap: Math.round(directoryOverlap * 1000) / 1000,
      labelOverlap: Math.round(labelOverlap * 1000) / 1000,
      authorOverlap,
    };
  }

  /**
   * Jaccard index for set similarity
   */
  private jaccardIndex(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) {
      return 0;
    }

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Build overlap matrix for all issue pairs
   */
  buildOverlapMatrix(metadata: IssueMetadata[]): OverlapScore[] {
    const matrix: OverlapScore[] = [];

    for (let i = 0; i < metadata.length; i++) {
      for (let j = i + 1; j < metadata.length; j++) {
        const overlap = this.computeOverlap(metadata[i], metadata[j]);
        matrix.push(overlap);
      }
    }

    // Sort for deterministic output
    matrix.sort((a, b) => {
      if (a.issue1 !== b.issue1) return a.issue1 - b.issue1;
      return a.issue2 - b.issue2;
    });

    return matrix;
  }

  /**
   * Identify parallel work groups (issues with low overlap)
   */
  identifyParallelGroups(
    metadata: IssueMetadata[],
    overlapMatrix: OverlapScore[],
    threshold: number = 0.3
  ): ParallelWorkGroup[] {
    const groups: ParallelWorkGroup[] = [];
    const processed = new Set<number>();

    // Build adjacency map of low-overlap issues
    const lowOverlapMap = new Map<number, Set<number>>();

    for (const overlap of overlapMatrix) {
      if (overlap.score < threshold) {
        if (!lowOverlapMap.has(overlap.issue1)) {
          lowOverlapMap.set(overlap.issue1, new Set());
        }
        if (!lowOverlapMap.has(overlap.issue2)) {
          lowOverlapMap.set(overlap.issue2, new Set());
        }
        lowOverlapMap.get(overlap.issue1)!.add(overlap.issue2);
        lowOverlapMap.get(overlap.issue2)!.add(overlap.issue1);
      }
    }

    // Find connected components (parallel groups)
    for (const issue of metadata) {
      if (processed.has(issue.number)) continue;

      const group: number[] = [];
      const queue = [issue.number];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (processed.has(current)) continue;

        processed.add(current);
        group.push(current);

        const neighbors = lowOverlapMap.get(current);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!processed.has(neighbor)) {
              queue.push(neighbor);
            }
          }
        }
      }

      if (group.length > 1) {
        // Compute average overlap within group
        const groupOverlaps = overlapMatrix.filter(
          (o) => group.includes(o.issue1) && group.includes(o.issue2)
        );
        const avgOverlap =
          groupOverlaps.length > 0
            ? groupOverlaps.reduce((sum, o) => sum + o.score, 0) / groupOverlaps.length
            : 0;

        groups.push({
          issues: group.sort((a, b) => a - b),
          avgOverlap: Math.round(avgOverlap * 1000) / 1000,
          reason: `Low overlap (avg: ${Math.round(avgOverlap * 100)}%)`,
        });
      }
    }

    // Sort groups by size (larger first)
    groups.sort((a, b) => b.issues.length - a.issues.length);

    return groups;
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(
    metadata: IssueMetadata[],
    overlapMatrix: OverlapScore[],
    parallelGroups: ParallelWorkGroup[]
  ): string[] {
    const recommendations: string[] = [];

    // Recommend parallel groups
    if (parallelGroups.length > 0) {
      const totalIssues = parallelGroups.reduce((sum, g) => sum + g.issues.length, 0);
      recommendations.push(
        `Found ${parallelGroups.length} parallel work groups covering ${totalIssues} issues`
      );

      for (const group of parallelGroups.slice(0, 3)) {
        recommendations.push(
          `Group of ${group.issues.length} issues (${group.issues.map((i) => `#${i}`).join(", ")}) can be worked on in parallel`
        );
      }
    }

    // Identify high-overlap pairs (potential conflicts)
    const highOverlap = overlapMatrix.filter((o) => o.score > 0.7);
    if (highOverlap.length > 0) {
      recommendations.push(
        `Found ${highOverlap.length} issue pairs with high overlap (>70%) - consider sequential execution`
      );
    }

    // Identify dependency chains
    const withDeps = metadata.filter((m) => m.dependencies.length > 0);
    if (withDeps.length > 0) {
      recommendations.push(
        `${withDeps.length} issues have explicit dependencies - review execution order`
      );
    }

    return recommendations;
  }

  /**
   * Perform complete analysis on a set of issues
   */
  async analyzeIssues(issues: GitHubIssue[]): Promise<IssueAnalysisResult> {
    // Extract metadata
    const metadata = issues.map((issue) => this.extractMetadata(issue));

    // Build overlap matrix
    const overlapMatrix = this.buildOverlapMatrix(metadata);

    // Identify parallel groups
    const parallelGroups = this.identifyParallelGroups(metadata, overlapMatrix);

    // Generate recommendations
    const recommendations = this.generateRecommendations(metadata, overlapMatrix, parallelGroups);

    return {
      metadata,
      overlapMatrix,
      parallelGroups,
      recommendations,
    };
  }
}

/**
 * Factory function to create IssueAnalyzer
 */
export function createIssueAnalyzer(client: GitHubClient): IssueAnalyzer {
  return new IssueAnalyzer(client);
}
