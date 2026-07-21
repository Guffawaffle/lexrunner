# Release and private npm publishing

LexRunner is distributed as the restricted npm package `@smartergpt/lexrunner`. The release path
has two distinct outcomes:

1. GitHub Actions validates a candidate and, for a signed stable tag, creates the GitHub release.
2. The publish gate validates that exact candidate and prints the command for an authenticated
   human to execute.

Automated npm publication is deliberately disabled. A successful workflow does **not** mean that
npm contains the candidate. Agents and automation must stop after the gate and hand its command to
the human release owner.

## Release types

- **Canary candidate:** each merge to `main` validates a version shaped like
  `X.Y.Z-canary.<commit>`. Publishing it with the `canary` dist-tag is a separate authenticated
  action.
- **Stable release:** a signed `lexrunner-vX.Y.Z` tag validates the matching package version and
  creates a GitHub release. Publishing it with the `latest` dist-tag is a separate authenticated
  action.

LexRunner follows Semantic Versioning. Breaking changes normally require a major release; an
explicitly governed pre-release or ecosystem release may declare a narrower migration policy in
its release issue. Conventional commits guide the proposed bump, but the release owner reviews the
version and changelog before tagging.

## Human prerequisites

Use Node 24 and npm 11 as pinned by `.nvmrc` and `packageManager`. Configure signed commits/tags,
start from a clean `main`, and authenticate the npm CLI for the SmarterGPT scope:

```bash
npm login --scope=@smartergpt --registry=https://registry.npmjs.org/
npm whoami
npm view @smartergpt/lexrunner versions --json
```

Authentication is intentionally a human step. Do not commit an npm token or a generated `.npmrc`.
Downstream machines also need permission to read the private `@smartergpt` scope.

## Prepare a stable candidate

```bash
git status --short
npm run release:prepare
git diff -- CHANGELOG.md package.json package-lock.json README.md docs/AX.md
npm run docs:surface
npm run build
npm test
```

Review the version, changelog, generated documentation, and package contents. Then commit the
release changes, create a signed tag whose version exactly matches `package.json`, and push both:

```bash
git add CHANGELOG.md package.json package-lock.json README.md docs/AX.md
git commit -S -m "chore(release): prepare X.Y.Z"
git tag -s lexrunner-vX.Y.Z -m "Release X.Y.Z"
git tag -v lexrunner-vX.Y.Z
git push origin main
git push origin lexrunner-vX.Y.Z
```

Wait for the release workflow to finish. It builds, tests, checks determinism, verifies the version,
validates npm's exact dry-run publication behavior, and creates the GitHub release. From a clean
checkout of the signed tag, run the same final gate locally:

```bash
npm run release:publish:check
```

The gate verifies the tarball boundary, rejects npm metadata-normalization warnings, requires the
matching `lexrunner-vX.Y.Z` tag at `HEAD`, performs `npm publish --dry-run`, and prints the exact
command. It never publishes. Only the authenticated human release owner executes the printed
command:

```bash
npm publish --access restricted --tag latest
npm view @smartergpt/lexrunner@X.Y.Z version
```

For pre-tag candidate work, `npm run release:publish:check -- --allow-untagged` runs the package and
dry-run checks but deliberately withholds a publish command.

For an authorized canary, prepare the exact canary version on a clean release checkout and use:

```bash
npm publish --access restricted --tag canary
npm view @smartergpt/lexrunner@canary version
```

The `publishConfig` in `package.json` pins the npm registry and restricted access; the explicit
flags make the operator's intent visible in the receipt. An agent must not type, proxy, or retry the
non-dry-run command for the human, including when npm requests an OTP or browser confirmation.

## Consumer proof

The release is not complete at “npm accepted the package.” Issue #795 owns the final proof:

1. install the scoped package from the private registry in a clean native Windows consumer;
2. verify ESM, CommonJS, CLI version/help, and MCP startup/tool inventory;
3. exercise the bounded read-only smoke path; and
4. record versions, commands, outcomes, and cleanup without recording credentials.

The consumer install shape is:

```bash
npm install @smartergpt/lexrunner@X.Y.Z
```

## LexSona is a separate release

LexSona is versioned, built, and published from the LexSona repository under its own package name
and release gates. The same authenticated SmarterGPT npm identity may be reused, but LexRunner's
scripts, tag, workflow, and changelog must never publish or version LexSona. Coordinate compatible
versions in the ecosystem release receipt rather than coupling the two publish operations.

## Rollback and recovery

Prefer deprecation plus a fixed patch over unpublishing:

```bash
npm deprecate @smartergpt/lexrunner@X.Y.Z "Critical issue; use X.Y.Z+1"
```

If npm policy permits and the release owner explicitly approves unpublishing:

```bash
npm unpublish @smartergpt/lexrunner@X.Y.Z
```

Revert faulty repository changes with a normal signed revert and publish a corrected release. Do
not silently retarget an existing version or rewrite a published tag.

## Automation boundary

The workflow already has the permissions needed to create GitHub releases. Future automated npm
publication would require a separately approved change to this human-only authority boundary as
well as an authentication design and consumer proof. Until then, workflow summaries say
**candidate prepared**, not **package published**.

## Related records

- [Ecosystem release and native Windows proof (#795)](https://github.com/Guffawaffle/lexrunner/issues/795)
- [Node 24 runtime migration (#823)](https://github.com/Guffawaffle/lexrunner/issues/823)
- [npm publish documentation](https://docs.npmjs.com/cli/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)
