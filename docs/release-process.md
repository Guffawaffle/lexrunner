# Release and private npm publishing

LexRunner is distributed as the restricted npm package `@smartergpt/lexrunner`. The release path
has two distinct outcomes:

1. GitHub Actions validates a candidate and, for a signed stable tag, creates the GitHub release.
2. An authenticated human publishes that exact candidate to the private npm package.

Automated npm publication is deliberately disabled in `.github/workflows/release.yml` until the
Ecosystem 3.1 release proof in issue #795 is complete. A successful workflow does **not** currently
mean that npm contains the candidate.

## Release types

- **Canary candidate:** each merge to `main` validates a version shaped like
  `X.Y.Z-canary.<commit>`. Publishing it with the `canary` dist-tag is a separate authenticated
  action.
- **Stable release:** a signed `vX.Y.Z` tag validates the matching package version and creates a
  GitHub release. Publishing it with the `latest` dist-tag is a separate authenticated action.

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
git commit -S -m "chore(release): prepare vX.Y.Z"
git tag -s vX.Y.Z -m "Release X.Y.Z"
git tag -v vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Wait for the release workflow to finish. It builds, tests, checks determinism, verifies the version,
and creates the GitHub release. Because npm publication is disabled, inspect the package before the
manual publish:

```bash
npm pack --dry-run
npm publish --dry-run
```

Publish only after the release issue authorizes it:

```bash
npm publish --access restricted --tag latest
npm view @smartergpt/lexrunner@X.Y.Z version
```

For an authorized canary, prepare the exact canary version on a clean release checkout and use:

```bash
npm publish --access restricted --tag canary
npm view @smartergpt/lexrunner@canary version
```

The `publishConfig` in `package.json` pins the npm registry and restricted access; the explicit
flags make the operator's intent visible in the receipt.

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
publication requires an approved npm authentication design (for example trusted publishing or a
scoped automation token), uncommented publish steps, and successful native-consumer proof. Until
then, workflow summaries say **candidate prepared**, not **package published**.

## Related records

- [Ecosystem release and native Windows proof (#795)](https://github.com/Guffawaffle/lexrunner/issues/795)
- [Node 24 runtime migration (#823)](https://github.com/Guffawaffle/lexrunner/issues/823)
- [npm publish documentation](https://docs.npmjs.com/cli/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)
