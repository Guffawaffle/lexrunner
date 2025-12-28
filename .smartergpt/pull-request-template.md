### Summary

Link issue: #<id> · Milestone: MVP 0.1.0 · PLAN milestone only.

### Review Checklist — Gate 0 (must pass)

- [ ] **Deliverables:** A single PR comment titled `Deliverables — <issue-number>: <short-title>` exists and is up to date (paste your `.smartergpt/deliverables/.live.md` verbatim).
- [ ] **Determinism:** Two consecutive runs produce byte-identical `.smartergpt/runner/plan.json` and `snapshot.md` (when applicable).
- [ ] **Scope:** Only PLAN files touched (Runner CLI: `src/core/*`, `src/cli.ts`; MCP server: `src/mcp/*`; Workspace profile: `.smartergpt/*`). **No** gates.run or weave/merge logic.
- [ ] **Style:** Tabs only; no trailing whitespace; imperative commit subject.
- [ ] **Schema:** `.smartergpt/*` YAML validates; bad input yields clear error messages.
- [ ] **Terminology:** Uses canonical terms per `docs/TERMS.md`.

<details><summary>Quick verification commands</summary>

```bash
pnpm run cli -- plan
cp .smartergpt/runner/plan.json /tmp/plan1.json
cp .smartergpt/runner/snapshot.md /tmp/snap1.md || true
pnpm run cli -- plan
cmp -s /tmp/plan1.json .smartergpt/runner/plan.json
[ -f /tmp/snap1.md ] && cmp -s /tmp/snap1.md .smartergpt/runner/snapshot.md
```

</details>
