# Merge-Weave CONTRIBUTING.md Template

Add this section to your repository's CONTRIBUTING.md file to document merge-weave usage.

---

## Merge-Weave Workflow

This repository uses [LexRunner](https://github.com/Guffawaffle/LexRunner)'s merge-weave functionality to efficiently merge multiple PRs in parallel while maintaining quality gates and dependency ordering.

### Quick Start

```bash
# 1. Install LexRunner (one-time setup)
npm install --save-dev github:Guffawaffle/LexRunner

# 2. Discover PRs with "ready-to-merge" label
npx lex-pr discover --owner <ORG> --repo <REPO> --labels ready-to-merge --output plan.json

# 3. Preview the merge plan
npx lex-pr merge --plan plan.json --dry-run

# 4. Execute the merge
npx lex-pr merge --plan plan.json --execute --cleanup
```

### Resources

- **Full Setup Guide**: [LexRunner Merge-Weave Setup](https://github.com/Guffawaffle/LexRunner/blob/main/docs/MERGE_WEAVE_SETUP.md)
- **Convenience Script**: Copy [merge-weave-wrapper.sh](https://github.com/Guffawaffle/LexRunner/blob/main/scripts/merge-weave-wrapper.sh) to your repo
- **Quickstart**: [Merge-Weave Quickstart](https://github.com/Guffawaffle/LexRunner/blob/main/docs/merge-weave-quickstart.md)

---
