# Agent Stall Detection and Monitoring

Automatically detect and respond when Copilot coding agents get stuck or take too long on PRs.

## Overview

When running fanout operations with multiple Copilot agents working in parallel, some agents may stall for various reasons:

- Waiting for user input
- Encountering unexpected errors
- Getting stuck in a loop
- Taking longer than expected on complex tasks

This monitoring system detects these situations and can automatically take action.

## Quick Start

### Check PR Status Once

```bash
lex-pr fanout monitor --prs 123,456
```

### Watch PRs Continuously

```bash
lex-pr fanout monitor --prs 123,456,789 --watch --interval 5m
```

### Auto-Nudge Stalled PRs

```bash
lex-pr fanout monitor --prs 123,456 --action nudge
```

### Custom Thresholds

```bash
lex-pr fanout monitor --prs 123 \
  --warning-threshold 5m \
  --stall-threshold 15m \
  --action escalate
```

## Detection Heuristics

The monitor tracks three states for each PR:

### Active

- PR is open and has recent activity
- Time since last commit < stall threshold
- No action needed

### Stalled

- No commits for >= stall threshold (default: 20 minutes)
- PR is still open/draft (not ready for review)
- Action: Nudge or escalate based on configuration

### Complete

- PR is marked as "ready for review"
- No further monitoring needed

## Thresholds

| Threshold | Default | Description                                                 |
| --------- | ------- | ----------------------------------------------------------- |
| Warning   | 10 min  | Agent hasn't committed for this long - eligible for nudging |
| Stall     | 20 min  | Agent is considered stalled - needs intervention            |

These are configurable via `--warning-threshold` and `--stall-threshold` flags.

## Actions

### None (Default)

Monitor only - report status but take no action.

```bash
lex-pr fanout monitor --prs 123 --action none
```

### Nudge

Post a comment asking Copilot to continue:

> @copilot please continue with the implementation

```bash
lex-pr fanout monitor --prs 123 --action nudge
```

### Escalate

Post a notification comment for human review:

> ⚠️ **Agent Stall Detected**
>
> This PR has been inactive for an extended period. @author please review.

```bash
lex-pr fanout monitor --prs 123 --action escalate
```

### All

Both nudge and escalate as appropriate.

```bash
lex-pr fanout monitor --prs 123 --action all
```

## Watch Mode

Continuously monitor PRs at a specified interval:

```bash
lex-pr fanout monitor --prs 123,456,789 \
  --watch \
  --interval 5m \
  --action nudge
```

Press Ctrl+C to stop.

## JSON Output

For automation and integration with other tools:

```bash
lex-pr fanout monitor --prs 123,456 --json
```

Output format:

```json
{
  "summary": {
    "timestamp": "2025-01-03T07:30:00Z",
    "totalPRs": 2,
    "activePRs": 1,
    "stalledPRs": 1,
    "completePRs": 0,
    "monitors": [
      {
        "prNumber": 123,
        "title": "feat: Add new feature",
        "assignedAt": "2025-01-03T07:00:00Z",
        "lastCommitAt": "2025-01-03T07:05:00Z",
        "stallThresholdMinutes": 20,
        "status": "stalled",
        "author": "copilot-agent",
        "prState": "open"
      }
    ]
  },
  "actions": {
    "nudged": [123],
    "escalated": []
  }
}
```

## Use Cases

### During Fanout Wave Execution

After assigning a batch of issues to Copilot agents:

1. Wait 5 minutes for agents to start
2. Start monitoring all PRs
3. Auto-nudge any that stall

```bash
# After fanout assignment
lex-pr fanout monitor \
  --prs $(gh pr list --json number -q '.[].number' | tr '\n' ',') \
  --watch \
  --interval 5m \
  --action nudge
```

### CI/CD Integration

Add a monitoring step to your workflow:

```yaml
- name: Monitor agent PRs
  run: |
    lex-pr fanout monitor \
      --prs ${{ env.PR_NUMBERS }} \
      --json \
      --action escalate > monitor-report.json
```

### Manual Investigation

Check status without taking action:

```bash
lex-pr fanout monitor --prs 123,456,789
```

Output:

```
📊 Agent Monitor Summary

Total PRs: 3
Active: 2
Stalled: 1
Complete: 0

PRs:

🟢 PR #123: feat: Add authentication
   Author: copilot-agent
   Status: active
   Assigned: 5m ago
   Last activity: 2m ago
   PR state: draft

🟢 PR #456: feat: Update docs
   Author: copilot-agent
   Status: active
   Assigned: 10m ago
   Last activity: 1m ago
   PR state: open

🔴 PR #789: feat: Refactor utils
   Author: copilot-agent
   Status: stalled
   Assigned: 25m ago
   Last activity: 22m ago
   PR state: draft

⚠️  1 PR(s) stalled - consider manual intervention
```

## Configuration

All thresholds can be customized per run:

```bash
lex-pr fanout monitor \
  --prs 123 \
  --warning-threshold 5m \    # Nudge after 5 min
  --stall-threshold 10m \      # Escalate after 10 min
  --action all
```

## Best Practices

1. **Start monitoring after agents have time to initialize** (5-10 minutes after assignment)
2. **Use conservative thresholds** for complex tasks (e.g., 30m stall threshold)
3. **Monitor in batches** - don't monitor all PRs at once if you have many
4. **Use JSON output** for automation and logging
5. **Combine with other tools** - integrate with your workflow management

## Limitations

- Requires GitHub API authentication (`GITHUB_TOKEN` environment variable)
- Only monitors PRs created by the specified PR numbers
- Does not automatically reassign stalled PRs (manual intervention required)
- Watch mode runs indefinitely - must be stopped manually

## Future Enhancements

Potential improvements (not yet implemented):

- [ ] Auto-discover agent PRs from labels or assignments
- [ ] Automatic reassignment of stalled PRs to new agents
- [ ] Integration with CI status checks
- [ ] Slack/email notifications for escalations
- [ ] Historical stall analytics and reporting
- [ ] Smart threshold adjustment based on task complexity
