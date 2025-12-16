/**
 * Placeholder types for Executor infrastructure
 * 
 * These types will be replaced by actual implementations from:
 * - PR #404: Executor Canonicalization
 * - PR #412: Executor Registry & Loader
 * - PR #411: Guardrail Enforcement Runtime
 */

// Executor interface (placeholder)
export interface Executor {
	id: string;
	name: string;
	prep(input: any): Promise<ExecutorContext>;
	stochastic(context: ExecutorContext, modelCall: ModelCallFunction): Promise<ExecutorResult>;
	receipt(result: ExecutorResult): Promise<Receipt>;
	emit(receipt: Receipt): Promise<Artifact[]>;
}

// Executor context (placeholder)
export interface ExecutorContext {
	taskId: string;
	budget: {
		maxTokens: number;
		usedTokens?: number;
	};
	frames: Frame[];
	guardrails?: Guardrail[];
}

// Frame (placeholder)
export interface Frame {
	id: string;
	type: string;
	content: any;
	timestamp: string;
}

// Guardrail (placeholder)
export interface Guardrail {
	id: string;
	type: "budget" | "content" | "rate_limit";
	limit: number;
	current?: number;
}

// Executor result (placeholder)
export interface ExecutorResult {
	success: boolean;
	output: any;
	tokensUsed: number;
	error?: string;
	guardrailViolations?: string[];
}

// Receipt (placeholder)
export interface Receipt {
	executorId: string;
	status: "completed" | "failed" | "partial";
	timestamp: string;
	result: ExecutorResult;
	artifacts?: string[];
}

// Artifact (placeholder)
export interface Artifact {
	type: string;
	path: string;
	content: string;
}

// Model call function type
export type ModelCallFunction = (args: { prompt: string; maxTokens?: number }) => Promise<ModelResponse>;

// Model response (placeholder)
export interface ModelResponse {
	content: string;
	tokensUsed: number;
	finishReason?: string;
}

// Registry interface (placeholder for PR #412)
export interface ExecutorRegistry {
	load(executorId: string): Promise<Executor>;
	register(executor: Executor): void;
	list(): string[];
}

// Lifecycle interface (placeholder for PR #412)
export interface ExecutorLifecycle {
	execute(executor: Executor, input: any): Promise<Receipt>;
}
