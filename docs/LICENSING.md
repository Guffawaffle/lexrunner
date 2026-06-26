# License Compliance Guide

This document describes LexRunner's licensing approach and compliance requirements.

## LexRunner License

LexRunner is source-available, not open source. See [LICENSE.md](../LICENSE.md) for the full license text.

You may view, fork, modify, and run LexRunner for personal, non-commercial use under the SmarterGPT Source-Available Personal Use License. Commercial use, organizational use, employer/client use, production use, hosted-service use, redistribution, sublicensing, or embedding in another product or platform requires a separate written license from Joseph Guff / Guffawaffle / SmarterGPT.

## Third-Party Dependencies

LexRunner depends on various open-source libraries, each with their own license terms. The most significant dependency is:

### @smartergpt/lex

- **License**: MIT License
- **Version**: 2.0.2
- **Usage**: LexRunner uses Lex as a free, MIT-licensed dependency for memory, policy, and atlas framework functionality
- **Attribution**: See [NOTICE.md](../NOTICE.md) for full attribution and license text

## Compliance Requirements

To ensure LexRunner properly attributes and complies with dependency licenses, the following requirements must be met:

### 1. Package.json Attribution

The `package.json` file must:

- List `@smartergpt/lex` as a dependency with the correct version
- Not claim ownership of Lex code

**Verification**: Automated in CI via `scripts/check-license-compliance.mjs`

### 2. No Source Code Copying

LexRunner must not copy Lex source code into its own codebase. All Lex functionality must be used via:

- Import statements from the `@smartergpt/lex` package
- Standard npm dependency mechanism

**Verification**: Automated in CI via `scripts/check-license-compliance.mjs`

- Scans for unauthorized file copies from Lex
- Allows legitimate imports via `import ... from '@smartergpt/lex'`

### 3. License Headers

All LexRunner source files should include appropriate license headers or comments indicating they are part of LexRunner and covered by the SmarterGPT Source-Available Personal Use License.

**Current Practice**: LexRunner uses JSDoc comments and file headers that describe functionality. No strict license header requirement is enforced, but copyright remains with Guffawaffle as stated in LICENSE.md.

**Verification**: Automated in CI via `scripts/check-license-compliance.mjs`

- Checks that source files don't claim to be part of Lex
- Ensures no conflicting license headers exist

### 4. NOTICE.md File

The [NOTICE.md](../NOTICE.md) file must:

- List all significant third-party dependencies
- Include full license text for @smartergpt/lex
- Provide attribution to dependency authors

**Verification**: Automated in CI via `scripts/check-license-compliance.mjs`

## CI Gate

The license compliance gate runs on every PR and checks:

1. ✅ `package.json` includes `@smartergpt/lex` dependency
2. ✅ No Lex source files copied into LexRunner
3. ✅ No conflicting license claims in LexRunner files
4. ✅ `NOTICE.md` exists and contains required attributions

### Running Locally

```bash
node scripts/check-license-compliance.mjs
```

Exit code 0 indicates compliance; non-zero indicates violations.

### CI Integration

The license compliance check is integrated into the main CI workflow (`.github/workflows/ci.yml`) and runs automatically on:

- Pull requests
- Pushes to main branch
- Manual workflow dispatch

## Troubleshooting

### Common Issues

**Issue**: CI fails with "Lex dependency not found in package.json"

- **Solution**: Ensure `@smartergpt/lex` is listed in the `dependencies` section of `package.json`

**Issue**: CI fails with "Lex source file detected"

- **Solution**: Remove any copied Lex source files. Use imports instead: `import { ... } from '@smartergpt/lex'`

**Issue**: CI fails with "NOTICE.md missing or incomplete"

- **Solution**: Ensure NOTICE.md exists and contains the full Lex attribution

## License Updates

When updating the `@smartergpt/lex` dependency:

1. Update the version in `package.json`
2. Run `npm install` to update `package-lock.json`
3. Update the version number in `NOTICE.md` if changed
4. Run the compliance check: `node scripts/check-license-compliance.mjs`
5. Verify all checks pass before committing

## Questions

For questions about LexRunner's licensing or compliance requirements, please open an issue on GitHub or contact the maintainers.
