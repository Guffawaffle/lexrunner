/**
 * AI prompt template for conflict resolution strategy
 * 
 * Provides the prompt structure for querying an AI model to resolve conflicts.
 * Uses JSON I/O for structured input/output.
 */

import type { ConflictResolutionInput } from "./conflictStrategySchema.js";

/**
 * System prompt for conflict resolution AI
 * 
 * Sets the context and rules for the AI's behavior
 */
export const SYSTEM_PROMPT = `You are a conflict resolution expert for git merge operations.

Your task is to analyze merge conflicts and propose resolution strategies.

Input format (JSON):
{
  "paths": ["file1.ts", "file2.ts"],
  "hunkHashes": ["abc123...", "def456..."],
  "symbols": [{"name": "MyClass", "type": "class", "path": "file1.ts"}],
  "hints": [{"type": "import-order", "message": "...", "confidence": 0.9}]
}

Output format (JSON):
{
  "strategy": "auto-resolve" | "manual-review" | "abort",
  "ops": [
    {
      "type": "accept-ours" | "accept-theirs" | "accept-base" | "merge-both" | "manual-review",
      "path": "file1.ts",
      "hunkHash": "abc123...",
      "rationale": "Explanation of why this operation is safe"
    }
  ],
  "risk": 0.25,  // 0-1 scale
  "explanation": "Overall strategy explanation"
}

Rules:
1. Always output valid JSON
2. Calculate risk conservatively (prefer higher risk scores when uncertain)
3. Only suggest "auto-resolve" for trivial conflicts (imports, whitespace, formatting)
4. Suggest "manual-review" for semantic conflicts
5. Suggest "abort" for high-risk structural conflicts
6. Provide clear rationale for each operation
7. Risk threshold: if risk > 0.35, recommend manual review`;

/**
 * Generate user prompt for specific conflict
 * 
 * @param input - Conflict resolution input
 * @returns Formatted prompt string
 */
export function generateConflictPrompt(input: ConflictResolutionInput): string {
	const inputJson = JSON.stringify(input, null, 2);
	
	return `Analyze the following merge conflict and provide a resolution strategy:

${inputJson}

Provide your response as JSON following the output format specified in the system prompt.`;
}

/**
 * Parse AI response to extract JSON
 * 
 * Handles cases where AI includes markdown formatting or extra text
 * 
 * @param response - Raw AI response
 * @returns Parsed JSON object
 */
export function parseAIResponse(response: string): unknown {
	// Try to extract JSON from markdown code blocks
	const jsonBlockMatch = response.match(/```json\n([\s\S]*?)\n```/);
	if (jsonBlockMatch) {
		return JSON.parse(jsonBlockMatch[1]);
	}
	
	// Try to extract JSON from regular code blocks
	const codeBlockMatch = response.match(/```\n([\s\S]*?)\n```/);
	if (codeBlockMatch) {
		return JSON.parse(codeBlockMatch[1]);
	}
	
	// Try to find JSON object in response
	const jsonMatch = response.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		return JSON.parse(jsonMatch[0]);
	}
	
	// If no JSON found, try parsing the whole response
	return JSON.parse(response);
}

/**
 * Build complete prompt for AI model
 * 
 * @param input - Conflict resolution input
 * @returns Object with system and user prompts
 */
export function buildPrompt(input: ConflictResolutionInput): {
	system: string;
	user: string;
} {
	return {
		system: SYSTEM_PROMPT,
		user: generateConflictPrompt(input)
	};
}

/**
 * Estimate token count for prompt (rough approximation)
 * 
 * Uses ~4 characters per token heuristic
 * 
 * @param input - Conflict resolution input
 * @returns Estimated token count
 */
export function estimateTokenCount(input: ConflictResolutionInput): number {
	const systemTokens = Math.ceil(SYSTEM_PROMPT.length / 4);
	const userPrompt = generateConflictPrompt(input);
	const userTokens = Math.ceil(userPrompt.length / 4);
	
	return systemTokens + userTokens;
}
