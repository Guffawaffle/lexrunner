#!/usr/bin/env python3
# gen_mcp_servers.py — Enhanced multi‑repo MCP servers.json generator for lex‑pr‑runner
# Features:
# - Recursive or shallow repo discovery under one or more roots
# - Include / exclude regex filters on repo basename
# - Per‑repo mutation allow‑list and/or policy‑file overrides
# - .env.mcp overlay parsing (KEY=VALUE), optional override of reserved vars
# - Profile precedence detection: .smartergpt.local → .smartergpt
# - Dist autodetect: prefer built server.js; fallback to tsx runner
# - Deterministic sorting + SHA‑256 guard; dry‑run with exit code 2 if change
# - Workspace read‑only variant generation (all ALLOW_MUTATIONS=false)
# - Prefix support for server registration keys
# - Exit codes: 0 = ok/no change, 2 = would change (dry‑run), 1 = error
#
# Python 3.10+

from __future__ import annotations
import argparse, json, os, re, sys
from pathlib import Path
from typing import Dict, Any, List, Optional
import hashlib

DEFAULT_ROOTS = ["/srv", "/home/guff"]
DEFAULT_PREFIX = "lex-pr-runner-"
# Default built dist artifact and TS fallback for development
DEFAULT_DIST = "/home/guff/lex-pr-runner/dist/mcp/server.js"
DEFAULT_TS = "/home/guff/lex-pr-runner/src/mcp/server.ts"

RESERVED_ENV = {"ALLOW_MUTATIONS", "LEX_PR_PROFILE_DIR"}

def is_repo_root(p: Path) -> bool:
    return (p / ".git").is_dir()

def iter_repos(roots: List[str], recursive: bool) -> List[Path]:
    repos: List[Path] = []
    seen: set[str] = set()
    for root in roots:
        r = Path(root)
        if not r.exists() or not r.is_dir():
            continue
        if recursive:
            for child in r.rglob(".git"):
                repo = child.parent
                key = str(repo.resolve())
                if key not in seen:
                    repos.append(repo)
                    seen.add(key)
        else:
            for child in r.iterdir():
                if child.is_dir() and is_repo_root(child):
                    key = str(child.resolve())
                    if key not in seen:
                        repos.append(child)
                        seen.add(key)
    return repos

def resolve_profile_dir(repo: Path) -> Optional[str]:
    local = repo / ".smartergpt.local"
    portable = repo / ".smartergpt"
    if local.is_dir():
        return str(local)
    if portable.is_dir():
        return str(portable)
    return None

def parse_env_overlay(repo: Path) -> Dict[str, str]:
    overlay = repo / ".env.mcp"
    env: Dict[str, str] = {}
    if not overlay.exists():
        return env
    for line in overlay.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        # basic unquote
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        env[k] = v
    return env

def load_policy(path: Optional[str]) -> Dict[str, Dict[str, Any]]:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"policy file not found: {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("policy file must be a JSON object mapping repoName -> env overrides")
    return data  # { "repoName": {"ALLOW_MUTATIONS": true/false, ...} }

def autodetect_command(dist: str, ts: str) -> tuple[str, list[str]]:
    dist_path = Path(dist)
    if dist_path.exists():
        return ("node", [str(dist_path)])
    ts_path = Path(ts)
    if ts_path.exists():
        # fallback to tsx for dev
        return ("npx", ["-y", "tsx", str(ts_path)])
    # final fallback: node + dist path anyway (client will error out)
    return ("node", [str(dist_path)])

def compute_hash(obj: Any) -> str:
    encoded = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

def main() -> int:
    ap = argparse.ArgumentParser(description="Generate MCP servers.json for lex-pr-runner across multiple repos.")
    ap.add_argument("-r", "--root", action="append", dest="roots", default=None,
                    help="Root(s) to scan for git repos (default: %s)" % DEFAULT_ROOTS)
    ap.add_argument("--recursive", action="store_true", help="Recurse into subdirectories for repos")
    ap.add_argument("--include", default=None, help="Regex to include by repo basename")
    ap.add_argument("--exclude", default=None, help="Regex to exclude by repo basename")
    ap.add_argument("-m", "--mutate", action="append", default=[],
                    help="Repo basenames allowed to mutate (ALLOW_MUTATIONS=true)")
    ap.add_argument("--policy-file", default=None, help="JSON file of per-repo env overrides")
    ap.add_argument("--env-overlay-override", action="store_true",
                    help="Allow .env.mcp to override reserved vars (ALLOW_MUTATIONS, LEX_PR_PROFILE_DIR)")
    ap.add_argument("--prefix", default=DEFAULT_PREFIX, help="Server key prefix (default: %r)" % DEFAULT_PREFIX)
    ap.add_argument("--dist", default=DEFAULT_DIST, help="Path to built MCP server.js")
    ap.add_argument("--ts", default=DEFAULT_TS, help="Path to TypeScript server entry for tsx fallback")
    ap.add_argument("-o", "--out", default="servers.json", help="Output JSON path (default: ./servers.json)")
    ap.add_argument("--workspace-out", default=None, help="Optional workspace variant path (all mutations disabled)")
    ap.add_argument("--existing", default=None, help="Existing JSON to merge/preserve (optional)")
    ap.add_argument("--dry-run", action="store_true", help="Do not write files; exit 2 if would change")
    args = ap.parse_args()

    roots = args.roots or DEFAULT_ROOTS

    include_re = re.compile(args.include) if args.include else None
    exclude_re = re.compile(args.exclude) if args.exclude else None

    policy = load_policy(args.policy_file)

    repos = iter_repos(roots, recursive=args.recursive)
    # Filter
    filt: List[Path] = []
    for repo in repos:
        name = repo.name
        if include_re and not include_re.search(name):
            continue
        if exclude_re and exclude_re.search(name):
            continue
        filt.append(repo)

    # Load existing manifest if provided
    existing: Dict[str, Any] = {"mcpServers": {}}
    if args.existing:
        p = Path(args.existing)
        if p.exists():
            try:
                existing = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                print(f"Warning: could not parse existing JSON at {p}, ignoring.", file=sys.stderr)

    # Merge into new manifest
    out: Dict[str, Any] = {"mcpServers": {}}
    out["mcpServers"].update(existing.get("mcpServers", {}))

    # Build entries
    command, base_args = autodetect_command(args.dist, args.ts)

    for repo in filt:
        name = repo.name
        key = f"{args.prefix}{name}"

        env: Dict[str, str] = {"ALLOW_MUTATIONS": "true" if name in args.mutate else "false"}
        prof = resolve_profile_dir(repo)
        if prof:
            env["LEX_PR_PROFILE_DIR"] = prof

        # Apply policy overrides
        if name in policy and isinstance(policy[name], dict):
            for k, v in policy[name].items():
                if isinstance(v, bool):
                    env[k] = "true" if v else "false"
                else:
                    env[k] = str(v)

        # .env.mcp overlay
        overlay = parse_env_overlay(repo)
        for k, v in overlay.items():
            if (k in RESERVED_ENV) and not args.env_overlay_override:
                # skip reserved unless explicitly allowed
                continue
            env[k] = v

        stanza = {
            "command": command,
            "args": base_args,
            "env": env,
            "workingDirectory": str(repo)
        }
        out["mcpServers"][key] = stanza

    # Deterministic sort
    sorted_servers = dict(sorted(out["mcpServers"].items(), key=lambda kv: kv[0]))
    out["mcpServers"] = sorted_servers

    # Compare hashes
    desired_hash = compute_hash(out)
    out_path = Path(args.out).resolve()

    current_hash = None
    if out_path.exists():
        try:
            current = json.loads(out_path.read_text(encoding="utf-8"))
            current_hash = compute_hash(current)
        except Exception:
            current_hash = None

    changed = (desired_hash != current_hash)

    # Workspace variant (read-only)
    workspace_payload = None
    if args.workspace_out:
        ws = {"mcpServers": {}}
        for k, stanza in sorted_servers.items():
            clone = json.loads(json.dumps(stanza))
            clone["env"]["ALLOW_MUTATIONS"] = "false"
            ws["mcpServers"][k] = clone
        workspace_payload = ws

    # Write or dry-run
    if args.dry_run:
        print(json.dumps(out, indent=2))
        if changed or args.workspace_out:
            return 2
        return 0

    if changed:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {out_path} ({len(sorted_servers)} entries)")
    else:
        print(f"No changes for {out_path}")

    if workspace_payload and args.workspace_out:
        wsp = Path(args.workspace_out).resolve()
        wsp.parent.mkdir(parents=True, exist_ok=True)
        wsp.write_text(json.dumps(workspace_payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {wsp} (read-only variant)")

    return 0

if __name__ == "__main__":
    sys.exit(main())
