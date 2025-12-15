# Error Taxonomy

This document defines the standardized error codes, exit codes, and error handling patterns for lexrunner CLI and MCP server.

## CLI Exit Code Policy

The CLI follows standard Unix conventions for automation and CI integration:

- **`0`**: Success - operation completed without errors
- **`1`**: Unexpected errors - system failures, network issues, crashes  
- **`2`**: Validation errors - invalid configuration, unknown dependencies, schema violations

### Exit Code Examples

```bash
# Success
npm run cli -- plan --json
echo $? # Returns 0

# Validation error (user fixable)
npm run cli -- schema validate invalid-plan.json  
echo $? # Returns 2

# System error (infrastructure issue)
npm run cli -- plan --out /read-only-directory
echo $? # Returns 1
```

## Standard Error Codes

### Schema and Validation Errors

| Error Code | Description | Exit Code | Example |
|------------|-------------|-----------|---------|
| `SCHEMA_VALIDATION` | Plan fails Zod schema validation | 2 | Missing required fields, invalid types |
| `SCHEMA_VERSION` | Unsupported or incompatible schema version | 2 | Schema version 2.x.y when only 1.x.y supported |
| `JSON_PARSE` | Invalid JSON syntax in plan file | 2 | Malformed JSON, trailing commas |

### Dependency and Planning Errors

| Error Code | Description | Exit Code | Example |
|------------|-------------|-----------|---------|
| `PLAN_CYCLE` | Circular dependency detected in plan | 2 | Item A depends on B, B depends on A |
| `UNKNOWN_DEPENDENCY` | Reference to non-existent item | 2 | Item depends on "nonexistent-item" |
| `EMPTY_PLAN` | Plan contains no items | 2 | Valid plan.json with empty items array |

### Gate Execution Errors

| Error Code | Description | Exit Code | Example |
|------------|-------------|-----------|---------|
| `GATE_TIMEOUT` | Gate execution exceeded timeout | 1 | Long-running test takes >30min |
| `GATE_FAILURE` | Gate command returned non-zero exit | 2 | Test suite fails, linter errors |
| `GATE_MISSING` | Referenced gate not found in item | 2 | Policy requires gate "test" but item has no such gate |

### System and Infrastructure Errors

| Error Code | Description | Exit Code | Example |
|------------|-------------|-----------|---------|
| `FILE_NOT_FOUND` | Required configuration file missing | 2 | plan.json not found |
| `PERMISSION_DENIED` | Insufficient filesystem permissions | 1 | Cannot write to output directory |
| `NETWORK_ERROR` | Network connectivity issues | 1 | Cannot reach Git remote, container registry |
| `CONTAINER_ERROR` | Container runtime failures | 1 | Docker daemon not running, image pull failed |

## Error Response Formats

### CLI Error Output

#### Human-Readable Format (default)

```
✗ plan.json validation failed:
  items.0.name: Required
  items.1.deps.0: Unknown dependency 'nonexistent'
```

#### JSON Format (`--json` flag)

```json
{
  "valid": false,
  "errors": [
    {
      "path": "items.0.name",
      "message": "Required", 
      "code": "invalid_type"
    },
    {
      "path": "items.1.deps.0",
      "message": "Unknown dependency 'nonexistent'",
      "code": "UNKNOWN_DEPENDENCY"
    }
  ]
}
```

### MCP Error Responses

MCP tools return errors using the ModelContextProtocol error format:

```typescript
// Success response
{
  content: [
    {
      type: "text",
      text: JSON.stringify({ valid: true, plan: {...} })
    }
  ]
}

// Error response  
throw new McpError(
  ErrorCode.InvalidRequest,
  "Schema validation failed: items.0.name is required"
);
```

#### MCP Error Code Mappings

| Internal Error | MCP ErrorCode | Description |
|----------------|---------------|-------------|
| `SCHEMA_VALIDATION` | `InvalidRequest` | Client provided invalid input |
| `PLAN_CYCLE` | `InvalidRequest` | Client provided cyclic dependencies |
| `FILE_NOT_FOUND` | `InternalError` | Server cannot access required files |
| `GATE_TIMEOUT` | `InternalError` | Server-side execution timeout |
| `NETWORK_ERROR` | `InternalError` | Server connectivity issues |

## Error Class Hierarchy

### Core Error Classes

```typescript
// Base validation error with structured details
export class SchemaValidationError extends Error {
  public readonly issues: z.ZodIssue[];
  public readonly errors: ValidationError[];
  
  toJSON(): { valid: false; errors: ValidationError[] }
}

// Dependency graph errors
export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
  }
}

export class UnknownDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownDependencyError"; 
  }
}
```

### Error Context and Recovery

Each error should provide:

1. **Context**: What operation was being performed
2. **Cause**: Root cause of the failure  
3. **Recovery**: Suggested fix or mitigation
4. **Code**: Structured error code for automation

Example structured error:

```typescript
{
  code: "UNKNOWN_DEPENDENCY",
  message: "Unknown dependency 'nonexistent-item' for item 'item-a'",
  context: {
    operation: "plan_validation",
    item: "item-a", 
    dependency: "nonexistent-item"
  },
  recovery: "Add item 'nonexistent-item' to plan or remove from dependencies"
}
```

## Error Handling Patterns

### CLI Error Handling

```typescript
function exitWith(e: unknown, schemaCode = "ESCHEMA") {
  const err: any = e;
  
  // Structured validation errors
  if (e instanceof SchemaValidationError || 
      e instanceof CycleError || 
      e instanceof UnknownDependencyError) {
    console.error(String(err?.message ?? e));
    process.exit(2); // User-fixable validation errors
  }
  
  // System/infrastructure errors
  console.error(String(err?.message ?? e));
  process.exit(1); // Unexpected failures
}
```

### MCP Error Handling

```typescript
try {
  const result = await handlePlanCreate(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
} catch (error) {
  if (error instanceof SchemaValidationError) {
    throw new McpError(ErrorCode.InvalidRequest, error.message);
  }
  
  // Log internal errors, return generic message
  console.error("Internal error:", error);
  throw new McpError(ErrorCode.InternalError, "Plan creation failed");
}
```

## Deterministic Error Handling

Error outputs must be deterministic for reliable CI/CD:

- **Stable ordering**: Sort validation errors by path
- **Consistent messages**: Use same wording for same error types
- **No timestamps**: Avoid runtime timestamps in error output
- **Canonical JSON**: Use `canonicalJSONStringify()` for JSON errors

## Integration Examples

### CI/CD Validation

```bash
#!/bin/bash
# Validate plan in CI pipeline
if ! npm run cli -- schema validate plan.json --json > validation.json; then
  exit_code=$?
  if [ $exit_code -eq 2 ]; then
    echo "❌ Plan validation failed (user error):"
    cat validation.json | jq -r '.errors[].message'
  else
    echo "💥 System error during validation"  
  fi
  exit $exit_code
fi
echo "✅ Plan validation passed"
```

### MCP Error Recovery

```typescript
// MCP client error handling
try {
  const result = await client.callTool("plan.create", { json: true });
  return JSON.parse(result.content[0].text);
} catch (error) {
  if (error.code === ErrorCode.InvalidRequest) {
    // User can fix this - show validation errors
    throw new Error(`Plan validation failed: ${error.message}`);
  } else {
    // System error - retry or escalate
    throw new Error(`Server error during plan creation: ${error.message}`);
  }
}
```

## Testing Error Conditions

Error handling should be tested systematically:

```typescript
// Test schema validation errors
test('should return SCHEMA_VALIDATION for invalid plan', () => {
  const invalidPlan = { target: "main", items: [{ deps: ["missing"] }] };
  expect(() => validatePlan(invalidPlan))
    .toThrow(SchemaValidationError);
});

// Test CLI exit codes
test('should exit with code 2 for validation errors', () => {
  const result = execSync('npm run cli -- schema validate invalid.json', { 
    encoding: 'utf8',
    stdio: 'pipe'
  });
  expect(result.status).toBe(2);
});
```