/**
 * Fanout Templates Module
 *
 * Provides deterministic follow-up issue creation based on PR diff patterns.
 *
 * @module
 */

// Schema and types
export {
	parseFanoutTemplates,
	safeParseFanoutTemplates,
	validateTemplateIds,
} from "./schema.js";
export type {
	FanoutTemplate,
	FanoutTemplates,
	GeneratedIssue,
	IssueTemplate,
	PatternTrigger,
	TriggerConfig,
	TriggerMatch,
} from "./schema.js";

// Loader
export {
	DEFAULT_FANOUT_TEMPLATES_FILENAME,
	DEFAULT_FANOUT_TEMPLATES_PATHS,
	discoverFanoutTemplates,
	FanoutTemplatesLoadError,
	loadFanoutTemplates,
	loadFanoutTemplatesOrNull,
	validateFanoutTemplatesContent,
} from "./loader.js";

// Matcher
export {
	deduplicateMatches,
	matchesFilePatterns,
	matchTemplateAgainstFile,
	matchTemplatesAgainstDiff,
	parseDiffLines,
} from "./matcher.js";
export type { PRDiffFile } from "./matcher.js";

// Generator
export {
	buildSubstitutionContext,
	formatIssuePreview,
	formatIssuesPreview,
	generateIssue,
	generateIssues,
	substituteTemplate,
} from "./generator.js";
export type { SubstitutionContext } from "./generator.js";
