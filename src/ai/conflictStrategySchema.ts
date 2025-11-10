/**
 * JSON schemas for AI conflict resolution strategy
 * 
 * Defines input/output contracts for AI-driven conflict resolution
 * with caching, risk scoring, and abstention logic.
 */

import { z } from "zod";

/**
 * Input schema for AI conflict resolution
 * 
 * Contains all context needed for the AI to determine a resolution strategy:
 * - File paths involved in the conflict
 * - Hunk hashes (SHA-256 of conflict hunks)
 * - Symbol information (functions, classes modified)
 * - Hints from static analysis
 */
export const ConflictResolutionInputSchema = z.object({
	/**
	 * Paths of files with conflicts
	 */
	paths: z.array(z.string()).min(1, "At least one file path required"),
	
	/**
	 * SHA-256 hashes of conflict hunks
	 * Used for caching and change detection
	 */
	hunkHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/, "Must be valid SHA-256 hash")),
	
	/**
	 * Symbols affected by the conflict (functions, classes, variables)
	 */
	symbols: z.array(z.object({
		name: z.string(),
		type: z.enum(["function", "class", "variable", "import", "export", "other"]),
		path: z.string()
	})).default([]),
	
	/**
	 * Hints from static analysis or heuristics
	 */
	hints: z.array(z.object({
		type: z.enum(["import-order", "whitespace", "formatting", "semantic", "structural"]),
		message: z.string(),
		confidence: z.number().min(0).max(1)
	})).default([])
});

export type ConflictResolutionInput = z.infer<typeof ConflictResolutionInputSchema>;

/**
 * Resolution operation schema
 * 
 * Defines atomic operations to resolve conflicts
 */
export const ResolutionOperationSchema = z.object({
	/**
	 * Type of resolution operation
	 */
	type: z.enum([
		"accept-ours",      // Accept current branch version
		"accept-theirs",    // Accept incoming branch version
		"accept-base",      // Accept common ancestor version
		"merge-both",       // Merge both changes
		"manual-review"     // Requires manual review
	]),
	
	/**
	 * File path for the operation
	 */
	path: z.string(),
	
	/**
	 * Hunk hash this operation applies to
	 */
	hunkHash: z.string().regex(/^[a-f0-9]{64}$/),
	
	/**
	 * Optional rationale for the operation
	 */
	rationale: z.string().optional()
});

export type ResolutionOperation = z.infer<typeof ResolutionOperationSchema>;

/**
 * Output schema for AI conflict resolution
 * 
 * Contains the resolution strategy and confidence/risk assessment
 */
export const ConflictResolutionOutputSchema = z.object({
	/**
	 * Overall resolution strategy
	 */
	strategy: z.enum([
		"auto-resolve",     // Can be automatically resolved
		"manual-review",    // Requires human review
		"abort"             // Too risky, abort merge
	]),
	
	/**
	 * Array of resolution operations
	 */
	ops: z.array(ResolutionOperationSchema),
	
	/**
	 * Risk score (0-1)
	 * Higher values indicate greater risk of incorrect resolution
	 * Threshold for abstention: 0.35
	 */
	risk: z.number().min(0).max(1),
	
	/**
	 * Optional explanation of the strategy
	 */
	explanation: z.string().optional(),
	
	/**
	 * Whether the AI abstained from providing a strategy
	 */
	abstained: z.boolean().default(false),
	
	/**
	 * Fallback method used if abstained
	 */
	fallbackMethod: z.enum(["heuristic", "manual", "none"]).optional()
});

export type ConflictResolutionOutput = z.infer<typeof ConflictResolutionOutputSchema>;

/**
 * Cached resolution entry schema
 */
export const CachedResolutionSchema = z.object({
	/**
	 * Cache key (SHA-256 of input)
	 */
	cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
	
	/**
	 * Cached resolution output
	 */
	resolution: ConflictResolutionOutputSchema,
	
	/**
	 * Timestamp of cache entry
	 */
	timestamp: z.string().datetime(),
	
	/**
	 * TTL in seconds (optional)
	 */
	ttl: z.number().positive().optional()
});

export type CachedResolution = z.infer<typeof CachedResolutionSchema>;
