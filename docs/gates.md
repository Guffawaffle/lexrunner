# Gates

Gates are quality checks that must pass before code can be merged. This document describes gate execution, validation, and best practices.

## Overview

Gates in lexrunner execute commands to verify code quality, run tests, perform security scans, and more. Each gate can have:

- A command to execute (`run`)
- Environment variables (`env`)
- Input validation schema (`input`)
- Runtime configuration (local, container, or CI service)
- Artifact collection paths

## Gate Input Validation

Starting in v0.1.0, gates support runtime input validation using JSON schemas. This ensures that gate inputs are validated before execution, providing fast feedback when inputs are malformed.

### How It Works

When a gate has an `input` field, it will be validated against a schema in `schemas/gates/{gate-name}.schema.json` before execution:

```json
{
  "name": "lint",
  "run": "npm run lint",
  "input": {
    "files": ["src/**/*.ts"],
    "linter": "eslint",
    "fix": true
  }
}
```

If validation fails, the gate immediately returns a failure status with a clear error message, avoiding wasted execution time.

### Built-in Gate Schemas

The following gates have predefined input schemas:

#### Lint Gate (`lint.schema.json`)

Validates linting operations:

```json
{
  "files": ["src/**/*.ts"], // Required: array of file paths or patterns (min 1 item)
  "linter": "eslint", // Required: eslint, tslint, pylint, or ruff
  "fix": true, // Optional: auto-fix violations
  "config": ".eslintrc.json" // Optional: path to config file
}
```

#### Test Gate (`test.schema.json`)

Validates test execution:

```json
{
  "framework": "vitest", // Required: vitest, jest, mocha, pytest, or junit
  "files": ["tests/**/*.spec.ts"], // Required: array of test file patterns (min 1 item)
  "coverage": true, // Optional: enable coverage collection
  "timeout": 30000 // Optional: test timeout in ms
}
```

#### Build Gate (`build.schema.json`)

Validates build operations:

```json
{
  "command": "npm run build", // Required: build command
  "outputDir": "dist", // Optional: output directory
  "clean": true, // Optional: clean before build
  "targets": ["main", "worker"] // Optional: build targets
}
```

#### Security Scan Gate (`security-scan.schema.json`)

Validates security scanning:

```json
{
  "scanner": "npm-audit", // Required: npm-audit, snyk, trivy, or codeql
  "severity": "high", // Optional: critical, high, medium, or low
  "failOn": "critical", // Optional: severity to fail on (default: high)
  "outputFormat": "sarif" // Optional: sarif, json, or text (default: sarif)
}
```

#### Coverage Gate (`coverage.schema.json`)

Validates coverage collection:

```json
{
  "tool": "vitest", // Required: istanbul, nyc, jest, vitest, or pytest-cov
  "threshold": 80, // Required: coverage percentage (0-100)
  "files": ["src/**/*.ts"], // Optional: files to include
  "exclude": ["**/*.test.ts"], // Optional: files to exclude
  "reportFormat": "lcov" // Optional: lcov, html, text, or cobertura (default: lcov)
}
```

### Backward Compatibility

Gates without the `input` field work exactly as before - no validation is performed. This ensures backward compatibility with existing plans.

### Skipping Validation

In rare cases where you need to bypass validation (e.g., testing edge cases), use the `--skip-input-validation` flag:

```bash
lex-pr execute plan.json --skip-input-validation
```

⚠️ **Warning**: Skipping validation can lead to cryptic failures during gate execution. Use only when absolutely necessary.

## Error Messages

When validation fails, you'll see clear, actionable error messages:

```
❌ Gate execution failed

Invalid input for gate "lint":
  - input/files must NOT have fewer than 1 items
  - input/linter must be equal to one of the allowed values

Suggestion: Check the gate input schema documentation for the correct format
```

## Creating Custom Gate Schemas

To add validation for custom gates:

1. Create a schema file: `schemas/gates/{gate-name}.schema.json`
2. Define the input structure using JSON Schema draft-07
3. Add the `input` field to your gate configuration

Example custom gate schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/Guffawaffle/LexRunner/schemas/gates/custom-check.schema.json",
  "title": "Custom Check Gate Input Schema",
  "description": "Input contract for custom check gate",
  "type": "object",
  "required": ["target"],
  "properties": {
    "target": {
      "type": "string",
      "minLength": 1,
      "description": "Target to check"
    },
    "strict": {
      "type": "boolean",
      "default": false,
      "description": "Enable strict mode"
    }
  },
  "additionalProperties": false
}
```

## Best Practices

1. **Always validate inputs**: Use the `input` field with schemas for complex gates
2. **Fail fast**: Validation happens before execution, saving time on invalid inputs
3. **Clear error messages**: Schema validation provides specific error details
4. **Test your schemas**: Write tests to verify your gate schemas work correctly
5. **Document your schemas**: Add descriptions to all schema properties

## CLI Reference

### Execute with Validation

```bash
# Execute with validation (default)
lex-pr execute plan.json

# Skip validation (not recommended)
lex-pr execute plan.json --skip-input-validation
```

### Help

```bash
lex-pr execute --help
```

## Related Documentation

- [Gate Report Examples](./gate-report-examples.md) - Output formats and examples
- [Schema Documentation](./schemas.md) - Overall schema architecture
- [CLI Reference](./cli.md) - Complete CLI documentation
- [Error Handling](./errors.md) - Error taxonomy and recovery
