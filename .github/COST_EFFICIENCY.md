# Cost Efficiency Guidelines for Copilot

## Core Principle

**Complete tasks in minimal prompts. Never stop mid-execution to ask questions when the user intent is clear.**

## Expensive Anti-Patterns to Avoid

### 1. Incomplete Task Execution

❌ **DON'T**: Merge to integration branch then stop
✅ **DO**: Complete full merge-weave workflow in one go

### 2. Unnecessary Planning Tools

❌ **DON'T**: Use `manage_todo_list` for straightforward operations
✅ **DO**: Just execute directly for clear tasks

### 3. Using Fake Data

❌ **DON'T**: Use example plans when user asks for "all open PRs"
✅ **DO**: Use `gh pr list --state open` to get real data

### 4. Stopping to Ask Questions

❌ **DON'T**: "Would you like me to..." when task is clear
✅ **DO**: Execute the full workflow without interruption

### 5. Declaring Success Prematurely

❌ **DON'T**: Say "completed successfully" when work remains
✅ **DO**: Verify all aspects of the contract are fulfilled

## Merge-Weave Contract

When user requests merge-weave on open PRs, complete ALL steps:

1. Discover real open PRs (`gh pr list --state open`)
2. Create integration branch and merge PRs (handle conflicts)
3. Merge integration branch back to main
4. Close successfully merged PRs with branch cleanup
5. Push all changes to remote
6. Verify final state matches user request

## Cost-Saving Checklist

Before responding, ask:

- [ ] Can I complete this in one execution without questions?
- [ ] Am I using real data instead of examples?
- [ ] Will this fulfill the complete user contract?
- [ ] Am I avoiding unnecessary planning overhead?
- [ ] **Have I checked existing state before creating duplicates?**

## Critical: Always Check Existing State

❌ **DON'T**: Blindly assign agents without checking for existing assignments
✅ **DO**: `gh issue view $issue --json comments | grep github-pull-request_copilot-coding-agent` first

**Remember: Each additional prompt costs the user money. Execute completely on first attempt.**
