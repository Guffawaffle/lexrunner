/**
 * Risk scoring logic for conflict resolution
 *
 * Calculates risk score (0-1) based on conflict characteristics.
 * Determines whether to abstain from automated resolution.
 */

import type { ConflictResolutionInput } from "./conflictStrategySchema.js";

/**
 * Risk score threshold for abstention
 * If risk > 0.35, fall back to heuristics or manual review
 */
export const RISK_THRESHOLD = 0.35;

/**
 * Risk factors and their weights
 */
const RISK_FACTORS = {
  // Number of files involved
  multipleFiles: 0.15,

  // Number of hunks involved
  multipleHunks: 0.15,

  // Semantic conflicts (not just whitespace/imports)
  semanticConflict: 0.25,

  // Structural changes (classes, functions)
  structuralChange: 0.2,

  // Low confidence hints
  lowConfidenceHints: 0.15,

  // Unknown/other symbol types
  unknownSymbols: 0.1,
};

/**
 * Calculate risk score for conflict resolution
 *
 * Risk score ranges from 0 (safe) to 1 (very risky)
 *
 * Factors considered:
 * - Number of files and hunks
 * - Types of conflicts (semantic vs. trivial)
 * - Symbol complexity
 * - Confidence of hints
 *
 * @param input - Conflict resolution input
 * @returns Risk score (0-1)
 */
export function calculateRiskScore(input: ConflictResolutionInput): number {
  let risk = 0.0;

  // Factor 1: Multiple files increase risk
  if (input.paths.length > 1) {
    const fileRisk = Math.min(input.paths.length / 10, 1.0);
    risk += RISK_FACTORS.multipleFiles * fileRisk;
  }

  // Factor 2: Multiple hunks increase risk
  if (input.hunkHashes.length > 2) {
    const hunkRisk = Math.min(input.hunkHashes.length / 10, 1.0);
    risk += RISK_FACTORS.multipleHunks * hunkRisk;
  }

  // Factor 3: Semantic conflicts are riskier than trivial ones
  const semanticHints = input.hints.filter((h) => h.type === "semantic");
  if (semanticHints.length > 0) {
    const semanticRisk = Math.min(semanticHints.length / 5, 1.0);
    risk += RISK_FACTORS.semanticConflict * semanticRisk;
  }

  // Factor 4: Structural changes (functions, classes) are risky
  const structuralSymbols = input.symbols.filter(
    (s) => s.type === "function" || s.type === "class"
  );
  if (structuralSymbols.length > 0) {
    const structuralRisk = Math.min(structuralSymbols.length / 5, 1.0);
    risk += RISK_FACTORS.structuralChange * structuralRisk;
  }

  // Factor 5: Low confidence hints increase risk
  const lowConfidenceHints = input.hints.filter((h) => h.confidence < 0.5);
  if (lowConfidenceHints.length > 0) {
    const confidenceRisk = lowConfidenceHints.length / Math.max(input.hints.length, 1);
    risk += RISK_FACTORS.lowConfidenceHints * confidenceRisk;
  }

  // Factor 6: Unknown symbol types are risky
  const unknownSymbols = input.symbols.filter((s) => s.type === "other");
  if (unknownSymbols.length > 0) {
    const unknownRisk = unknownSymbols.length / Math.max(input.symbols.length, 1);
    risk += RISK_FACTORS.unknownSymbols * unknownRisk;
  }

  // Clamp to [0, 1]
  return Math.min(Math.max(risk, 0), 1);
}

/**
 * Determine if we should abstain from automated resolution
 *
 * @param riskScore - Risk score (0-1)
 * @returns true if risk > threshold
 */
export function shouldAbstain(riskScore: number): boolean {
  return riskScore > RISK_THRESHOLD;
}

/**
 * Get risk level description
 *
 * @param riskScore - Risk score (0-1)
 * @returns Human-readable risk level
 */
export function getRiskLevel(riskScore: number): "low" | "medium" | "high" | "critical" {
  if (riskScore < 0.25) return "low";
  if (riskScore < 0.5) return "medium";
  if (riskScore < 0.75) return "high";
  return "critical";
}

/**
 * Get risk assessment with explanation
 *
 * @param input - Conflict resolution input
 * @returns Risk assessment object
 */
export function assessRisk(input: ConflictResolutionInput): {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  abstain: boolean;
  factors: string[];
} {
  const score = calculateRiskScore(input);
  const level = getRiskLevel(score);
  const abstain = shouldAbstain(score);
  const factors: string[] = [];

  // Collect triggered factors
  if (input.paths.length > 1) {
    factors.push(`Multiple files (${input.paths.length})`);
  }

  if (input.hunkHashes.length > 2) {
    factors.push(`Multiple hunks (${input.hunkHashes.length})`);
  }

  const semanticHints = input.hints.filter((h) => h.type === "semantic");
  if (semanticHints.length > 0) {
    factors.push(`Semantic conflicts (${semanticHints.length})`);
  }

  const structuralSymbols = input.symbols.filter(
    (s) => s.type === "function" || s.type === "class"
  );
  if (structuralSymbols.length > 0) {
    factors.push(`Structural changes (${structuralSymbols.length})`);
  }

  const lowConfidenceHints = input.hints.filter((h) => h.confidence < 0.5);
  if (lowConfidenceHints.length > 0) {
    factors.push(`Low confidence hints (${lowConfidenceHints.length})`);
  }

  const unknownSymbols = input.symbols.filter((s) => s.type === "other");
  if (unknownSymbols.length > 0) {
    factors.push(`Unknown symbols (${unknownSymbols.length})`);
  }

  return { score, level, abstain, factors };
}
