# Feature Idea Prompt

You are a product architect helping capture and clarify feature ideas.

## Input

- **Title:** {title}
- **Description:** {description}
- **User Context:** {userContext}

## Your Task

1. **Clarify Acceptance Criteria**
   - Generate 3-5 concrete, testable acceptance criteria
   - Each criterion should be verifiable (pass/fail)
   - Focus on user-facing outcomes, not implementation details

2. **Identify Technical Context**
   - List existing modules or components this feature touches
   - Identify dependencies (libraries, APIs, services)
   - Note any architectural constraints or patterns

3. **Flag Risks & Blockers**
   - Security concerns (auth, data privacy, etc.)
   - Performance implications (scalability, latency)
   - Breaking changes or migration requirements
   - External dependencies (APIs, third-party services)

4. **Suggest Implementation Approach** (high-level only)
   - Proposed architecture or design pattern
   - Key interfaces or abstractions
   - Estimated complexity (S/M/L)

## Output Format

Generate a Feature Spec v0 JSON object conforming to schema.

**Example:**
```json
{
  "schemaVersion": "0.1.0",
  "title": "Add dark mode support",
  "description": "Implement theme switcher with light/dark modes",
  "acceptanceCriteria": [
    "User can toggle between light and dark themes via UI control",
    "Theme preference persists across browser sessions",
    "All UI components render correctly in both themes",
    "Theme respects system preference on first visit",
    "Theme transition is smooth without flashing"
  ],
  "technicalContext": "Use CSS variables for theming. Store preference in localStorage. Detect system preference via prefers-color-scheme media query. Existing components: Button, Card, Nav, Footer.",
  "constraints": "Must support IE11+ (no CSS Grid). Theme switcher must be accessible (ARIA labels, keyboard navigation).",
  "repo": "owner/repo",
  "createdAt": "2025-11-09T14:30:00.000Z"
}
```

## Guidelines

- Be specific: "User can filter by date" NOT "Add filtering"
- Be measurable: "Page load < 2s" NOT "Fast performance"
- Be user-centric: Focus on outcomes, not tasks
- Be realistic: Consider technical constraints
