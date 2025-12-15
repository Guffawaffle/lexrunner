# Video Script: Understanding Dependencies

**Duration:** 8 minutes  
**Target Audience:** Developers working with PR stacks  
**Prerequisites:** Basic lexrunner knowledge (Getting Started video)

## Setup

**Demo Repository:** `lex-pr-demo`  
**Sample PRs:** 4 dependent PRs forming a stack

---

## Script

### Introduction (0:00 - 0:30)

**[Screen: Title slide with dependency graph visualization]**

> "Welcome back! In this video, you'll learn how to manage PR dependencies with lexrunner. We'll cover dependency syntax, merge order computation, and how to handle complex PR stacks."

**[Screen: Show outline]**
- Dependency syntax
- Merge order
- PR stacks
- Troubleshooting

---

### Why Dependencies Matter (0:30 - 1:30)

**[Screen: Split screen - manual vs automated]**

> "Let's say you're building a new feature across 4 PRs. Without dependency management, you'd merge them manually, one by one, waiting for CI each time. This takes 30+ minutes."

**[Animation: Show PRs being merged sequentially with waiting time]**

> "With lexrunner, you declare dependencies once, and the tool handles the merge order automatically. Same 4 PRs, merged in 5 minutes."

**[Animation: Show automatic dependency resolution and parallel execution]**

---

### Dependency Syntax (1:30 - 3:00)

**[Screen: Terminal with PR body editor]**

> "Declaring dependencies is simple. In your PR description, add a 'Depends-On' line with the PR number."

```markdown
## Description
This PR adds user authentication.

## Dependencies
Depends-On: #101
```

**[Annotation: Highlight the syntax]**

> "The syntax is strict: 'Depends-On' followed by colon, space, hash, and the PR number. Let me show you common mistakes."

**[Screen: Show incorrect examples with X marks]**

```markdown
# ❌ Wrong
Requires: #101
Needs: #101
depends on #101
Depends-On #101

# ✅ Correct
Depends-On: #101
```

> "Case-sensitive, exact match. Save yourself debugging time - use the correct syntax."

---

### Creating a PR Stack (3:00 - 4:30)

**[Screen: Terminal]**

> "Let's create a real PR stack. Imagine refactoring the database layer in 4 steps."

```bash
# Create base PR
$ gh pr create \
  --title "Part 1: Database schema" \
  --body "Foundation for refactoring"

Created pull request #101

# Create dependent PR
$ gh pr create \
  --title "Part 2: Repository layer" \
  --body "Depends-On: #101"

Created pull request #102
```

**[Annotation: Show dependency arrow from #102 to #101]**

> "Now PR #102 depends on #101. Let's continue the stack."

```bash
# Add more dependencies
$ gh pr create \
  --title "Part 3: Service layer" \
  --body "Depends-On: #102"

$ gh pr create \
  --title "Part 4: API endpoints" \
  --body "Depends-On: #103"
```

**[Animation: Show complete dependency chain]**

> "We have a 4-PR stack: 101 → 102 → 103 → 104"

---

### Computing Merge Order (4:30 - 5:30)

**[Screen: Terminal]**

> "Now let's see how lexrunner computes the merge order."

```bash
$ lex-pr plan --from-github
```

**[Annotation: Highlight plan generation output]**

```
✓ Generated merge plan
  - Detected 4 PRs
  - Computed dependency graph
  - Calculated merge order
```

> "The plan.json file now contains the dependency graph. Let's visualize it."

```bash
$ lex-pr merge-order plan.json
```

**[Annotation: Show merge order output]**

```
Merge order for 4 items:
Level 0: database-schema
Level 1: repository-layer
Level 2: service-layer
Level 3: api-endpoints
```

> "Perfect! The tool computed the correct order. Level 0 first, then level 1, and so on."

---

### Multiple Dependencies (5:30 - 6:30)

**[Screen: Diagram showing diamond dependency]**

> "What about complex dependencies? Let's say PR #105 depends on both #102 and #103."

```markdown
<!-- In PR #105 -->
Depends-On: #102
Depends-On: #103
```

**[Animation: Show dependency graph with diamond shape]**

> "lexrunner handles this automatically. It waits for both #102 and #103 to merge before merging #105."

```bash
$ lex-pr merge-order plan.json
```

**[Annotation: Show computed order]**

```
Level 0: database-schema
Level 1: repository-layer
Level 2: service-layer
Level 3: api-endpoints, complex-feature
```

> "Notice #105 is at the same level as #104. They can merge in parallel since they have no dependencies between them."

---

### Common Issues (6:30 - 7:30)

**[Screen: Terminal with error message]**

> "Let's troubleshoot common dependency issues."

**Issue 1: Circular Dependencies**

```bash
$ lex-pr plan --from-github

❌ Error: Cycle detected in dependency graph
   PR #201 → #202 → #203 → #201
```

**[Animation: Show cycle highlighted]**

> "Circular dependencies are impossible to resolve. Break the cycle by removing one dependency."

**Issue 2: Unknown Dependency**

```bash
❌ Error: Unknown dependency: #999
   PR #204 depends on non-existent PR #999
```

> "Check for typos in PR numbers. The PR must exist and be open."

**Issue 3: Case Sensitivity**

```markdown
# In PR body
depends-on: #101  ❌
Depends-On: #101  ✅
```

> "Remember: exact case matters. 'Depends-On' with capital D and O."

---

### Best Practices (7:30 - 8:00)

**[Screen: Checklist]**

> "Here are best practices for managing dependencies:"

1. **Keep stacks short** - 3-5 PRs maximum
2. **Document why** - Explain dependency in PR body
3. **Test locally** - Verify each PR builds independently
4. **Merge frequently** - Don't let stacks grow stale

**[Screen: Summary]**

> "You now know how to:"
- ✓ Declare dependencies with correct syntax
- ✓ Create PR stacks
- ✓ Understand merge order
- ✓ Troubleshoot common issues

> "Next video: Quality Gates. See you there!"

**[End screen with links]**

---

## B-Roll Suggestions

- Animated dependency graphs
- Time-lapse of CI pipeline
- Visual diff of merge order
- Real codebase example

## Code Examples to Prepare

### Simple Linear Stack
```bash
# 3 PRs in sequence
gh pr create --title "PR1" --body "Base"
gh pr create --title "PR2" --body "Depends-On: #PR1"
gh pr create --title "PR3" --body "Depends-On: #PR2"
```

### Diamond Dependency
```bash
# PR4 depends on both PR2 and PR3
gh pr create --title "PR4" --body "Depends-On: #PR2\nDepends-On: #PR3"
```

### Complex Graph
```bash
# Multiple independent and dependent branches
# (Prepare diagram)
```

## Interactive Elements

### Pause Points

1. After syntax explanation (1:30)
   - "Pause here and try creating your first dependent PR"

2. After merge order computation (5:30)
   - "Pause and run merge-order on your own plan"

3. After troubleshooting (7:30)
   - "Pause and check your PR bodies for correct syntax"

### On-Screen Annotations

- Highlight dependency syntax in green ✅
- Show errors in red with explanations ❌
- Use arrows to show dependencies →
- Box important commands

## Accessibility

### Captions
```
[Terminal shows: lex-pr plan --from-github]
[Narrator: The plan.json file now contains the dependency graph]
[Diagram appears showing PR #101 pointing to PR #102]
```

### Screen Reader Support
- Describe all visual graphs verbally
- Read command outputs aloud
- Explain diagram relationships

## Post-Production

### Editing Checklist
- [ ] Remove long pauses (>2 seconds)
- [ ] Add smooth transitions between sections
- [ ] Color-code syntax highlighting
- [ ] Sync audio with visual cues
- [ ] Add chapter markers at each section

### Export Settings
- Format: MP4 (H.264)
- Resolution: 1080p
- Bitrate: 8 Mbps
- Audio: AAC, 192 kbps

## Companion Resources

### GitHub Gist
Create gist with:
- Full command reference
- Syntax cheat sheet
- Troubleshooting flowchart
- Example PR bodies

### Interactive Quiz
1. What's the correct dependency syntax?
2. How do you handle circular dependencies?
3. Can a PR depend on multiple other PRs?

### Sample Repository
Provide fork-able repo with:
- Example PR stack
- Configured lexrunner
- Sample gates
- README with exercises
