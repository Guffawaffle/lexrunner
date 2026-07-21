# Node 24 Migration for Ecosystem 3.1

Ecosystem 3.1 releases LexRunner 1.2.0 with a Node.js 24 floor. This intentional compatibility
change applies to the `lex-pr` CLI, `lexrunner-mcp`, SDK imports, local contributors, CI, and
downstream consumers. “3.1” is the ecosystem sprint name, not the LexRunner package major/minor.

Node 20 reached end of life on March 24, 2026. Node 24 is an LTS release line supported through
April 2028. GitHub-hosted runners also began forcing Node-20-based JavaScript actions onto Node 24
in June 2026. The canonical evidence is the [Node.js release schedule][node-releases] and
[GitHub's Node 20 Actions deprecation notice][actions-deprecation].

## Runtime contract

- `package.json` declares `node >=24`.
- `.nvmrc` and `.tool-versions` select major `24`; the current verified release is 24.18.0.
- npm 11.16.0 is the checked-in toolchain version bundled with that verified Node release.
- There is deliberately no upper Node bound. Node 24 is the release line validated for 3.1;
  later majors remain installable for forward compatibility testing instead of being rejected
  before evidence exists.
- `lex-pr workspace doctor --json` reports both the workspace pin and package floor.
- `npm run check:node-runtime` rejects drift across package metadata, workflows, release tooling,
  doctor, and current guidance.

## Upgrade a workspace

With nvm on Linux, macOS, or WSL:

```bash
nvm install 24
nvm use 24
npm install -g npm@11.16.0
npm ci
npm run cli:built -- workspace doctor --json
```

On native Windows, install a current Node 24 x64 release using the official installer or your
existing Windows version manager. Open a new PowerShell session, then verify:

```powershell
node --version  # v24.x
npm --version   # 11.16.0
```

## Private package smoke on Windows

Authenticate once as the human npm account that can read the `@smartergpt` organization. Do not
copy an npm token into a repository or chat transcript.

```powershell
npm login --scope=@smartergpt --registry=https://registry.npmjs.org/
$smoke = Join-Path $env:TEMP ("lexrunner-node24-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $smoke | Out-Null
Push-Location $smoke
npm init -y
npm install @smartergpt/lexrunner@1.2.0
npx lex-pr --help
node -e "import('@smartergpt/lexrunner').then(m => { if (typeof m.canonicalJSONStringify !== 'function') process.exit(1) })"
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx lexrunner-mcp
Pop-Location
```

The release owner records the Windows version, Node/npm versions, installed package integrity,
CLI result, MCP `tools/list` result, and timestamp in the release evidence tracked by issue #795.
Before the private 1.2.0 package is published, use `npm run test:package` on Node 24 for the
equivalent packed-tarball import, require, CLI, bounded Attempt status, and MCP smoke.

## GitHub Actions generations

Active workflows use current first-party action generations that declare the Node 24 action
runtime: checkout v7, setup-node v7, cache v6, upload-artifact v7, github-script v9, and
add-to-project v2. The archived `actions/create-release` step is replaced by `gh release create`.

[node-releases]: https://nodejs.org/en/about/previous-releases
[actions-deprecation]: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
