/**
 * Autopilot module - automation level management for merge-weave execution
 */

// Foundation exports (Agent 1)
export * from "./types.js";

// Artifact and level exports (Agent 3)
export { AutopilotBase, AutopilotLevel0 } from "./base.js";
export { AutopilotLevel1 } from "./level1.js";
export { AutopilotLevel2 } from "./level2.js";
export { AutopilotLevel3 } from "./level3.js";
export { ArtifactWriter } from "./artifacts.js";
export { DeliverablesManager } from "./deliverables.js";
export type {
        AutopilotContext,
        AutopilotResult
} from "./base.js";
export type {
        AnalysisData,
        GatePrediction,
        ConflictPrediction,
        ArtifactMetadata
} from "./artifacts.js";
export type {
        DeliverablesManifest,
        ArtifactEntry,
        ExecutionContext,
        RetentionPolicy,
        CleanupResult
} from "./deliverables.js";