# Executor Test Fixtures

This directory contains mock executors and placeholder types for testing executor lifecycle.

## Purpose

These fixtures enable testing of the executor lifecycle pattern while dependencies are being developed:

- PR #404: Executor Canonicalization
- PR #412: Executor Registry & Loader
- PR #411: Guardrail Enforcement Runtime

## Components

### `types.ts`

Placeholder type definitions for executor infrastructure. These will be replaced by actual implementations once the dependency PRs are merged.

### `mock-executor.ts`

A full mock implementation of the Executor interface that can be configured to simulate various scenarios:

- Happy path (successful execution)
- Budget exceeded
- Guardrail violations
- Missing required frames

### `registry.ts`

A simplified mock ExecutorRegistry for testing. Provides basic registration and lookup functionality.

### Usage Example

```typescript
import { ExecutorRegistry } from "./fixtures/executors/registry.js";
import { MockExecutor, mockModelCall } from "./fixtures/executors/mock-executor.js";

// Setup
const registry = new ExecutorRegistry();
const executor = new MockExecutor();
registry.register(executor);

// Execute lifecycle
const loaded = await registry.load("mock-executor");
const context = await loaded.prep({ taskId: "TEST-001" });
const result = await loaded.stochastic(context, mockModelCall);
const receipt = await loaded.receipt(result);
const artifacts = await loaded.emit(receipt);
```

## When to Remove

These fixtures should be removed once:

1. PRs #404, #411, and #412 are merged
2. Real executor infrastructure is available
3. Tests in `tests/executors/lifecycle.spec.ts` are updated to use actual implementations
