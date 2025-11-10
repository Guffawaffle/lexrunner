# Create Project Prompt

You are a project planner decomposing features into actionable tasks.

## Input

**Feature Spec v0:**
```json
{json-content}
```

## Your Task

Generate an Execution Plan v1 that breaks the feature into:
1. **Epic** - Top-level feature (same as Feature Spec)
2. **Sub-Issues** - Actionable tasks with dependencies

### Sub-Issue Types

- **feature**: Core implementation work
- **testing**: Unit, integration, E2E tests
- **docs**: User-facing documentation (README, API docs, examples)

### Dependency Rules

- `testing` depends on `feature`
- `docs` depends on `feature`
- Additional dependencies based on implementation order

### Acceptance Criteria

Each sub-issue should have:
- Clear, testable acceptance criteria
- No overlap with other sub-issues
- Completion time estimate (S/M/L)

## Output Format

Generate an Execution Plan v1 JSON object conforming to schema.

**Example:**
```json
{
  "schemaVersion": "1.0.0",
  "sourceSpec": { /* Feature Spec v0 */ },
  "epic": {
    "title": "Add dark mode support",
    "description": "Implement theme switcher with light/dark modes",
    "acceptanceCriteria": [
      "User can toggle between light and dark themes",
      "Theme preference persists across sessions",
      "All UI components support both themes"
    ]
  },
  "subIssues": [
    {
      "id": "feature-impl",
      "title": "Implement dark mode theme switcher",
      "description": "Core implementation: CSS variables, localStorage persistence, system preference detection",
      "type": "feature",
      "acceptanceCriteria": [
        "CSS variables defined for light/dark themes",
        "Theme switcher UI component renders",
        "localStorage saves/loads theme preference",
        "System preference detected via media query",
        "Theme applies globally on page load"
      ],
      "dependsOn": []
    },
    {
      "id": "tests",
      "title": "Add tests for dark mode",
      "description": "Unit tests for theme logic, integration tests for UI components",
      "type": "testing",
      "acceptanceCriteria": [
        "Unit tests: localStorage, preference detection",
        "Integration tests: theme switcher interaction",
        "E2E tests: theme persistence across sessions",
        "Coverage > 80%"
      ],
      "dependsOn": ["feature-impl"]
    },
    {
      "id": "docs",
      "title": "Document dark mode feature",
      "description": "Update README, add examples, document theme customization API",
      "type": "docs",
      "acceptanceCriteria": [
        "README updated with dark mode section",
        "Example code snippet added",
        "CSS variable API documented",
        "Migration guide for existing themes"
      ],
      "dependsOn": ["feature-impl"]
    }
  ],
  "createdAt": "2025-11-09T14:35:00.000Z"
}
```

## Guidelines

- Keep sub-issues focused (< 200 LOC each)
- Avoid waterfalls: parallelize when possible
- Testing should not block docs (unless API changes)
- Include migration sub-issues for breaking changes
