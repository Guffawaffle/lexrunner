#!/usr/bin/env bash
#
# bootstrap-lexrunner.sh
# Scaffolds a new repo for the Lex-PR Runner (CLI + MCP adapter) with .smartergpt layout.
# Safe writer, idempotent-ish, SSH-first remotes, and tabs in editors by default.
#
# Usage:
#   bash bootstrap-lexrunner.sh --dir lexrunner [--remote git@github.com:you/lexrunner.git] [--no-gh]
#   bash bootstrap-lexrunner.sh --help
#
set -Eeuo pipefail

# ---- tiny logger ----
c_bold="$(tput bold 2>/dev/null || true)"; c_dim="$(tput dim 2>/dev/null || true)"; c_reset="$(tput sgr0 2>/dev/null || true)"
log() { printf "%s%s%s\n" "${c_bold}" "$*" "${c_reset}"; }
note() { printf "%s•%s %s\n" "${c_dim}" "${c_reset}" "$*"; }
die() { printf "✖ %s\n" "$*" >&2; exit 1; }

# ---- defaults ----
DIR="lexrunner"
NAME="lexrunner"
REMOTE=""
USE_GH=1           # 1 = try to create remote via gh if REMOTE empty; 0 = do not
PRIVATE=1          # default private if gh creates
PKG_MGR=""         # auto-detect: pnpm > npm
INSTALL_DEPS=1     # run install step
INIT_COMMIT=1      # make initial commit
BRANCH="main"

# ---- args ----
print_help() {
cat <<EOF
Bootstrap a new Lex-PR Runner repository.

Options:
  --dir DIR             Target directory (default: ${DIR})
  --name NAME           Package/repo name (default: ${NAME})
  --remote SSH_URL      Set git remote 'origin' to this SSH URL (default: none)
  --no-gh               Do not call 'gh repo create' (default: will attempt if no --remote)
  --public              If 'gh' creates, make the repo public (default: private)
  --pkg pnpm|npm        Force package manager (default: auto-detect pnpm > npm)
  --no-install          Skip dependency installation
  --no-commit           Skip initial commit
  --branch NAME         Default branch name (default: ${BRANCH})
  -h|--help             Show this help
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --remote) REMOTE="$2"; shift 2;;
    --no-gh) USE_GH=0; shift;;
    --public) PRIVATE=0; shift;;
    --pkg) PKG_MGR="$2"; shift 2;;
    --no-install) INSTALL_DEPS=0; shift;;
    --no-commit) INIT_COMMIT=0; shift;;
    --branch) BRANCH="$2"; shift 2;;
    -h|--help) print_help; exit 0;;
    *) die "Unknown arg: $1";;
  esac
done

# ---- prereqs & env ----
have() { command -v "$1" >/dev/null 2>&1; }
[[ -z "${PKG_MGR}" ]] && { if have pnpm; then PKG_MGR="pnpm"; elif have npm; then PKG_MGR="npm"; else PKG_MGR=""; fi; }

log "Scaffolding ${NAME} in ${DIR}"
note "Package manager: ${PKG_MGR:-'(none found — will not install)'}"

# ---- safe write helper ----
# write_file <path> <<'EOF' ... EOF
write_file() {
  local dest="$1"; shift || true
  local dir; dir="$(dirname "$dest")"
  mkdir -p "$dir"
  umask 022
  local tmp; tmp="$(mktemp "${dest}.XXXXXX.tmp")"
  # shellcheck disable=SC2094
  cat > "$tmp"
  mv -f "$tmp" "$dest"
}

# ---- create base dirs ----
mkdir -p "${DIR}"
cd "${DIR}"

# ---- git init ----
if [[ ! -d .git ]]; then
  git init -b "${BRANCH}" >/dev/null
  note "Initialized git repo (branch: ${BRANCH})"
else
  note ".git exists; leaving as-is"
fi

# ---- .gitignore ----
write_file ".gitignore" <<'EOF'
node_modules/
dist/
coverage/
.env
.smartergpt/cache/
.smartergpt/runner/logs/
.smartergpt/runner/results/
.smartergpt/runner/stage/
.DS_Store
*.log
EOF

# ---- .editorconfig (tabs, no trailing spaces) ----
write_file ".editorconfig" <<'EOF'
root = true

[*]
indent_style = tab
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
EOF

# ---- LICENSE (MIT) ----
year="$(date +%Y)"
user_name="$(git config user.name || echo 'Your Name')"
write_file "LICENSE" <<EOF
MIT License

Copyright (c) ${year} ${user_name}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

# ---- README ----
write_file "README.md" <<EOF
# ${NAME}

**Lex-PR Runner** — fan-out PRs, compute a merge pyramid, run local gates, and **weave** merges cleanly.
- CLI: \`lex-pr plan|run|merge|doctor|format|ci-replay\`
- MCP server: exposes tools (\`plan.create\`, \`gates.run\`, \`merge.apply\`) and resources under \`.smartergpt/runner/\`.

## Quick start
\`\`\`bash
# dev
${PKG_MGR:-npm} run dev

# run CLI (ts)
${PKG_MGR:-npm} run cli -- schema validate plan.json
${PKG_MGR:-npm} run cli -- merge-order plan.json
${PKG_MGR:-npm} run cli -- gate plan.json
${PKG_MGR:-npm} run cli -- merge plan.json --dry-run
\`\`\`

## Project layout
- \`src/core\`: planner, gates runner, weave strategies
- \`src/cli.ts\`: human CLI (Commander)
- \`src/mcp/server.ts\`: MCP tool/resource surface (adapter)
- \`.smartergpt/\`: canonical inputs + runner artifacts
EOF

# ---- package.json ----
write_file "package.json" <<EOF
{
	"name": "${NAME}",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"bin": {
		"lex-pr": "dist/cli.js"
	},
	"scripts": {
		"dev": "tsx watch src/cli.ts",
		"cli": "tsx src/cli.ts",
		"mcp": "tsx src/mcp/server.ts",
		"build": "tsup src/cli.ts --format esm,cjs --dts --out-dir dist && tsup src/mcp/server.ts --format esm,cjs --dts --out-dir dist",
		"lint": "eslint . --ext .ts",
		"typecheck": "tsc -p tsconfig.json"
	},
	"dependencies": {
		"chalk": "^5.3.0",
		"commander": "^12.0.0",
		"execa": "^9.2.0",
		"fs-extra": "^11.2.0",
		"simple-git": "^3.24.0",
		"yaml": "^2.6.0",
		"zod": "^3.23.8"
	},
	"devDependencies": {
		"@types/node": "^20.12.12",
		"eslint": "^9.10.0",
		"tsx": "^4.19.0",
		"tsup": "^8.1.0",
		"typescript": "^5.6.3"
	}
}
EOF

# ---- tsconfig.json ----
write_file "tsconfig.json" <<'EOF'
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ES2022",
		"moduleResolution": "Bundler",
		"outDir": "dist",
		"rootDir": "src",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"noEmit": true
	},
	"include": ["src"]
}
EOF

# ---- src stubs ----
write_file "src/core/plan.ts" <<'EOF'
import { z } from "zod";

export const PlanItem = z.object({
	id: z.number(),
	branch: z.string(),
	sha: z.string().optional(),
	needs: z.number().array().default([]),
	strategy: z.enum(["rebase-weave", "merge-weave", "squash-weave"]).default("rebase-weave")
});
export type PlanItem = z.infer<typeof PlanItem>;

export const Plan = z.object({
	target: z.string().default("main"),
	items: z.array(PlanItem)
});
export type Plan = z.infer<typeof Plan>;

export async function createPlan(): Promise<Plan> {
	// TODO: read .smartergpt/stack.yml if present; otherwise combine scope.yml + deps.yml + PR metadata.
	// For now, return a minimal placeholder plan.
	return {
		target: "main",
		items: []
	};
}
EOF

write_file "src/cli.ts" <<'EOF'
#!/usr/bin/env node
import { Command } from "commander";
import { createPlan } from "./core/plan.js";
import * as fs from "fs";
import * as path from "path";

const program = new Command();
program.name("lex-pr").description("Lex-PR Runner CLI").version("0.1.0");

program
	.command("plan")
	.description("Compute merge pyramid and freeze plan artifacts")
	.option("--out <dir>", "Artifacts output dir", ".smartergpt/runner")
	.action(async (opts) => {
		const plan = await createPlan();
		const outDir = opts.out as string;
		fs.mkdirSync(outDir, { recursive: true });
		const planPath = path.join(outDir, "plan.json");
		fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
		console.log(`Wrote ${planPath}`);
	});

program
	.command("doctor")
	.description("Environment and config sanity checks")
	.action(async () => {
		console.log("doctor: TODO — check git, node, package manager, and .smartergpt/*");
	});

program.parseAsync(process.argv);
EOF

write_file "src/mcp/server.ts" <<'EOF'
/**
 * MCP server adapter (skeleton).
 * Expose tools:
 *  - plan.create
 *  - gates.run
 *  - merge.apply
 * Expose resources:
 *  - .smartergpt/runner/** (plan.json, results, logs, snapshot.md)
 *
 * TODO: Implement using your chosen MCP SDK.
 */
console.log("MCP server stub — implement with your preferred MCP SDK.");
EOF

# ---- .smartergpt canonical inputs ----
mkdir -p ".smartergpt/runner" ".smartergpt/cache"

write_file ".smartergpt/intent.md" <<'EOF'
Ship initial Lex-PR Runner scaffold: plan skeleton, CLI, MCP stub, canonical files, and weave philosophy.
EOF

write_file ".smartergpt/scope.yml" <<'EOF'
version: 1
target: main
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: ["stack:*"]
  exclude_labels: ["WIP", "do-not-merge"]
defaults:
  strategy: rebase-weave
  base: main
pin_commits: false
EOF

write_file ".smartergpt/deps.yml" <<'EOF'
version: 1
depends_on: []
strategies: {}
EOF

write_file ".smartergpt/stack.yml" <<'EOF'
version: 1
target: main
prs: []
EOF

write_file ".smartergpt/gates.yml" <<'EOF'
version: 1
levels:
  default:
    - name: lint
      run: "npm run lint"
    - name: typecheck
      run: "npm run typecheck"
    - name: unit
      run: "npm test"
EOF

# ---- install deps ----
if [[ ${INSTALL_DEPS} -eq 1 ]]; then
  if [[ -n "${PKG_MGR}" ]]; then
    log "Installing dependencies (${PKG_MGR})"
    if [[ "${PKG_MGR}" == "pnpm" ]]; then
      pnpm install
    else
      npm install
    fi
  else
    note "No package manager detected; skipping install."
  fi
fi

# ---- git add/commit ----
git add -A
if [[ ${INIT_COMMIT} -eq 1 ]]; then
  if git diff --cached --quiet; then
    note "Nothing to commit."
  else
    git commit -m "Init lexrunner scaffold" >/dev/null || true
    note "Committed initial scaffold."
  fi
fi

# ---- remote setup ----
if [[ -n "${REMOTE}" ]]; then
  git remote remove origin >/dev/null 2>&1 || true
  git remote add origin "${REMOTE}"
  note "Set origin to ${REMOTE}"
elif [[ ${USE_GH} -eq 1 ]]; then
  if have gh; then
    vis="private"
    [[ ${PRIVATE} -eq 0 ]] && vis="public"
    gh repo create "${NAME}" --${vis} --source=. --remote=origin --push >/dev/null || note "gh repo create skipped or failed."
    note "Created repo via gh (${vis})."
  else
    note "gh not found; skipping remote creation."
  fi
fi

log "Done. Try:"
echo "  cd ${DIR} && ${PKG_MGR:-npm} run cli -- plan"
