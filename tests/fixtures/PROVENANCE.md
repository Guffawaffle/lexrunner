# Test Fixtures Provenance

This document tracks the source and capture details for all test fixtures used in LexRunner testing.

## Purpose

- **Auditability**: Know where fixtures came from and when
- **Maintenance**: Update fixtures when test runners change formats
- **Reproducibility**: Re-capture fixtures with documented procedures

## Fixture Catalog

### Vitest Fixtures

Located in: `tests/fixtures/vitest/`

#### all-passing.json

- **Source**: Synthetic test run
- **Captured**: 2026-01-04
- **Method**: Generated from Vitest JSON reporter
- **Test Runner**: Vitest v4.0.x
- **Characteristics**: All tests pass, includes multiple suites
- **Usage**: Validates adapter handles success cases

#### some-failing.json

- **Source**: Synthetic test run
- **Captured**: 2026-01-04
- **Method**: Generated from Vitest JSON reporter with intentional failures
- **Test Runner**: Vitest v4.0.x
- **Characteristics**:
  - 2 failures: AssertionError and TimeoutError
  - Includes stack traces and error locations
  - Multiple test suites
- **Usage**: Validates failure parsing, failureId generation, nextActions

#### complex-nested-suites.json

- **Source**: Synthetic test run
- **Captured**: 2026-01-04
- **Method**: Generated from Vitest with deeply nested describe blocks
- **Test Runner**: Vitest v4.0.x
- **Characteristics**: Complex nesting with ancestorTitles
- **Usage**: Validates suite hierarchy parsing

#### with-coverage.json

- **Source**: Synthetic test run with coverage enabled
- **Captured**: 2026-01-04
- **Method**: Generated from Vitest with coverage reporter
- **Test Runner**: Vitest v4.0.x
- **Characteristics**: Includes coverage percentages
- **Usage**: Validates coverage extraction

### Jest Fixtures

Located in: `tests/fixtures/jest/`

#### all-passing.json

- **Source**: Synthetic Jest test run
- **Captured**: 2026-01-04
- **Method**: Generated from Jest --json output
- **Test Runner**: Jest 29.x
- **Characteristics**: All tests pass
- **Usage**: Validates Jest adapter success cases

#### some-failing.json

- **Source**: Synthetic Jest test run
- **Captured**: 2026-01-04
- **Method**: Generated from Jest --json with failures
- **Test Runner**: Jest 29.x
- **Characteristics**:
  - Assertion failures with expected/actual values
  - Timeout errors
  - Includes failureDetails with matcherResult
- **Usage**: Validates Jest-specific error parsing

#### snapshot-failures.json

- **Source**: Synthetic Jest test run
- **Captured**: 2026-01-04
- **Method**: Generated from Jest with snapshot failures
- **Test Runner**: Jest 29.x
- **Characteristics**: Snapshot mismatch errors
- **Usage**: Validates snapshot-specific nextActions

#### with-location.json

- **Source**: Synthetic Jest test run
- **Captured**: 2026-01-04
- **Method**: Generated from Jest with location data
- **Test Runner**: Jest 29.x
- **Characteristics**: Includes line/column location info
- **Usage**: Validates location extraction

### JUnit XML Fixtures

Located in: `tests/fixtures/junit/`

#### single-suite.xml

- **Source**: Synthetic JUnit XML
- **Captured**: 2026-01-04
- **Method**: Hand-crafted from JUnit spec
- **Format**: JUnit XML (schema used by Maven Surefire, Gradle)
- **Characteristics**: Single test suite with mixed results
- **Usage**: Basic JUnit adapter validation

#### multiple-suites.xml

- **Source**: Synthetic JUnit XML
- **Captured**: 2026-01-04
- **Method**: Hand-crafted from JUnit spec
- **Format**: JUnit XML
- **Characteristics**: Multiple test suites
- **Usage**: Validates multi-suite handling

#### with-errors.xml

- **Source**: Synthetic JUnit XML
- **Captured**: 2026-01-04
- **Method**: Hand-crafted from JUnit spec
- **Format**: JUnit XML
- **Characteristics**: Includes both failures and errors
- **Usage**: Validates error vs failure distinction

#### with-skipped.xml

- **Source**: Synthetic JUnit XML
- **Captured**: 2026-01-04
- **Method**: Hand-crafted from JUnit spec
- **Format**: JUnit XML
- **Characteristics**: Contains skipped tests
- **Usage**: Validates skipped test handling

#### cdata-messages.xml

- **Source**: Synthetic JUnit XML
- **Captured**: 2026-01-04
- **Method**: Hand-crafted with CDATA sections
- **Format**: JUnit XML
- **Characteristics**: Uses CDATA for failure messages
- **Usage**: Validates XML parsing edge cases

## Capturing New Fixtures

### Vitest

```bash
# Run tests with JSON reporter
vitest run --reporter=json > fixture.json

# Or from LexRunner tests
npm test -- --reporter=json > tests/fixtures/vitest/lexrunner-output.json
```

### Jest

```bash
# Run tests with JSON output
jest --json --outputFile=fixture.json
```

### JUnit XML

Most test runners can output JUnit XML:

```bash
# Vitest
vitest run --reporter=junit --outputFile=junit.xml

# Jest
jest --reporters=jest-junit

# Gradle
./gradlew test # outputs to build/test-results/

# Maven
mvn test # outputs to target/surefire-reports/
```

## Updating Fixtures

When test runner formats change:

1. Re-capture using the procedure above
2. Update the "Captured" date in this document
3. Note any format changes in the "Characteristics" section
4. Run the test suite to ensure adapters still work
5. Update adapters if breaking changes occurred

## Golden Outputs

Located in: `tests/fixtures/golden/`

Golden outputs are the expected AXTestResult format after parsing fixtures.
These serve as regression tests for adapter behavior.

See individual golden files for their provenance.

## Related Documentation

- [ADR-009: AX Test Output Adapters](../../docs/adr/ADR-009-ax-test-output-adapters.md)
- [Fixture Library README](README.md)
