/**
 * Dependency Resolution Performance Benchmarks
 * Measures performance of dependency parsing and conflict detection
 */

import { describe, bench } from 'vitest';
import { parsePRDescription } from '../../../src/planner/dependencyParser.js';

describe('Dependency Resolution Performance', () => {
  // Simple dependencies
  describe('Simple dependencies', () => {
    const simplePRBody = `
## Description
This PR implements a new feature.

## Dependencies
- Depends on Guffawaffle/LexRunner#100
- Depends on Guffawaffle/LexRunner#101
- Depends on Guffawaffle/LexRunner#102

## Testing
All tests pass.
`;

    bench('parse simple dependencies', () => {
      parsePRDescription(simplePRBody, 'Guffawaffle/LexRunner#200', {
        repository: 'Guffawaffle/LexRunner'
      });
    });
  });

  // Complex dependencies with metadata
  describe('Complex dependencies', () => {
    const complexPRBody = `
## Description
Large feature with multiple dependencies.

## Dependencies
- Depends on Guffawaffle/LexRunner#100 (foundation)
- Depends on Guffawaffle/LexRunner#101 (database layer)
- Depends on Guffawaffle/LexRunner#102 (API layer)
- Depends on Guffawaffle/LexRunner#103 (UI foundation)
- Depends on Guffawaffle/LexRunner#104 (auth system)
- Requires: Guffawaffle/LexRunner#105
- Depends: Guffawaffle/LexRunner#106

## Gates
Skip: e2e
Required: lint, test, security

## Metadata
Priority: high
Labels: feature, breaking-change
`;

    bench('parse complex dependencies with metadata', () => {
      parsePRDescription(complexPRBody, 'Guffawaffle/LexRunner#200', {
        repository: 'Guffawaffle/LexRunner'
      });
    });
  });

  // Many dependencies
  describe('Many dependencies', () => {
    // Generate PR with 20 dependencies
    const deps = Array.from({ length: 20 }, (_, i) => 
      `- Depends on Guffawaffle/LexRunner#${100 + i}`
    ).join('\n');
    
    const manyDepsPRBody = `
## Description
Integration PR with many dependencies.

## Dependencies
${deps}

## Testing
Integration tests pass.
`;

    bench('parse 20 dependencies', () => {
      parsePRDescription(manyDepsPRBody, 'Guffawaffle/LexRunner#300', {
        repository: 'Guffawaffle/LexRunner'
      });
    });
  });

  // Cross-repository dependencies
  describe('Cross-repository dependencies', () => {
    const crossRepoPRBody = `
## Dependencies
- Depends on Guffawaffle/LexRunner#100
- Depends on Guffawaffle/OtherRepo#50
- Depends on AnotherOrg/ThirdRepo#25
- Depends on Guffawaffle/LexRunner#101
`;

    bench('parse cross-repo dependencies', () => {
      parsePRDescription(crossRepoPRBody, 'Guffawaffle/LexRunner#200', {
        repository: 'Guffawaffle/LexRunner'
      });
    });
  });

  // Mixed formats
  describe('Mixed dependency formats', () => {
    const mixedFormatBody = `
## Dependencies
- Depends on #100 (relative)
- Depends on Guffawaffle/LexRunner#101 (full)
- Requires: Guffawaffle/LexRunner#102
- Depends: Guffawaffle/LexRunner#103
- Blocked by Guffawaffle/LexRunner#104
- Depends-on: Guffawaffle/LexRunner#105

## Gates
Skip: e2e, perf
Required: lint, test
`;

    bench('parse mixed dependency formats', () => {
      parsePRDescription(mixedFormatBody, 'Guffawaffle/LexRunner#200', {
        repository: 'Guffawaffle/LexRunner'
      });
    });
  });
});
