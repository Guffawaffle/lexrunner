# lexrunner Documentation

Complete documentation for lexrunner - automated PR merge workflows with dependency management.

## 🚀 Getting Started

New to lexrunner? Start here:

1. **[Quickstart Guide](./quickstart.md)** (5 minutes)
   - Installation and setup
   - First successful merge
   - Basic workflow

2. **[Architecture Overview](./architecture.md)**
   - System design and philosophy
   - Core components
   - Data flow

3. **[CLI Reference](./cli.md)**
   - Complete command documentation
   - Options and flags
   - JSON output schemas

## 📚 Core Concepts

### Planning & Execution

- **[Dependency Parser](./dependency-parser.md)** - Understanding PR dependencies
- **[Schemas](./schemas.md)** - Plan and configuration schemas
- **[Gates](./gates.md)** - Quality gates and input validation
- **[Error Taxonomy](./errors.md)** - Error codes and handling
- **[Counter-Examples](./counter-examples.md)** - Failure learning and capture

### Merge Strategies

- **[Weave Contract](./weave-contract.md)** - Conflict resolution rules
- **[Merge-Weave Analysis](./merge-weave-analysis.md)** - Strategy selection
- **[Weave Execution Log](./weave-execution-log.md)** - Real-world example

### Automation

- **[Autopilot](./autopilot.md)** - Automation overview
- **[Autopilot Levels](./autopilot-levels.md)** - Levels 0-4 explained

## 🔧 Configuration

### Workspace Setup

- **[SmartGPT Structure v1 Spec](./specs/smartergpt-structure-v1.md)** - Complete structure specification
- **[Profile Resolution](./profile-resolution.md)** - Configuration precedence
- **[Prompts Configuration](./prompts.md)** - Prompts precedence, cross-repo usage, token expansion
- **[SmartGPT Structure v1 Specification](./specs/smartergpt-structure-v1.md)** - Complete directory structure spec
- **[TERMS](./TERMS.md)** - Canonical terminology

### File Reference

| File          | Purpose                       | Priority   |
| ------------- | ----------------------------- | ---------- |
| `stack.yml`   | Explicit plan with items/deps | Highest    |
| `scope.yml`   | PR selection criteria         | Fallback   |
| `deps.yml`    | Dependency definitions        | Supporting |
| `gates.yml`   | Quality gate configuration    | Supporting |
| `profile.yml` | Profile metadata              | Metadata   |

## 🎓 Learning Resources

### Tutorials

- **[Quick Merge Pyramid](./tutorials/quick-merge-pyramid.md)** - Complete workflow guide (10 min)
  - Discover → Plan → Execute → Merge
  - Dependency management
  - Gate execution and verification
- **[Video Tutorial Scripts](./tutorials/)** - Complete video guides
  - Getting Started (5 min)
  - Understanding Dependencies (8 min)
  - Quality Gates (10 min)
  - CI/CD Integration (12 min)
  - Advanced Workflows (15 min)

### Workflows by Team Size

- **[Solo Developer](./workflows/solo-developer.md)** - Personal projects
- **[Small Team](./workflows/small-team.md)** - 2-5 developers
- **[Medium Team](./workflows/medium-team.md)** - 6-20 developers
- **[Large Team](./workflows/large-team.md)** - 20+ developers
- **[Enterprise](./workflows/enterprise.md)** - Multi-repository

### Workflows by Project Type

- **[Open Source](./workflows/open-source.md)** - Community projects
- **[SaaS Application](./workflows/saas-application.md)** - Continuous deployment
- **[Mobile App](./workflows/mobile-app.md)** - Platform-specific gates
- **[Library/SDK](./workflows/library-sdk.md)** - API compatibility

### Workflows by Strategy

- **[Trunk-Based Development](./workflows/trunk-based.md)** - Short-lived branches
- **[GitFlow](./workflows/gitflow.md)** - Release branches
- **[GitHub Flow](./workflows/github-flow.md)** - Deploy from main

## 🔌 Integrations

### CI/CD Platforms

- **[GitHub Actions](./integrations/README.md#github-actions)** - Native integration
- **[GitLab CI](./integrations/README.md#gitlab-ci)** - GitLab pipelines
- **[Jenkins](./integrations/README.md#jenkins)** - Industry standard
- **[CircleCI](./integrations/README.md#circleci)** - Cloud CI/CD
- **[Azure DevOps](./integrations/README.md#azure-devops)** - Microsoft ecosystem
- **[More platforms...](./integrations/README.md)** - Complete list

### Memory & Lex Integration

- **[Memory Tools Guide](./MEMORY_TOOLS.md)** - Understanding Lex vs LexRunner memory tools
  - When to use `mcp_lex_frame_recall` vs `executor_recall_context`
  - Avoiding split-brain confusion
  - Performance and feature comparisons
- **[Lex Integration](./LEX_INTEGRATION.md)** - How LexRunner integrates with Lex
- **[Lex Public API](./LEX_PUBLIC_API.md)** - Lex API surface for LexRunner

### Communication Tools

- **Slack Notifications** - Post merge results
- **Microsoft Teams** - Integration examples
- **Email Reports** - Automated summaries

## 🛠️ Operations

### Security

- **[Security Implementation](./SECURITY_IMPLEMENTATION.md)** - Enterprise security features
- **[Secret Rotation Guide](./security/rotation-guide.md)** - Rotation patterns and best practices
  - Recommended rotation cadences
  - Compliance framework requirements
  - Step-by-step rotation workflows
  - Automation and CI/CD integration
  - Emergency rotation procedures

### Monitoring

- **[Monitoring Implementation](./monitoring-implementation.md)** - Setup guide
- **[Monitoring Examples](./monitoring-examples.md)** - Real-world usage
- **[CLI/MCP/Weave Reporting](./cli-mcp-weave-reporting.md)** - Reporting patterns

### Troubleshooting

- **[Troubleshooting Guide](./troubleshooting.md)** - Common issues and solutions
  - Installation problems
  - Configuration errors
  - GitHub API issues
  - Gate execution failures
  - Merge operation problems
  - Debugging techniques

### Migration

- **[Migration Guide](./migration-guide.md)** - From manual to automated
  - Migration paths (gradual vs big bang)
  - Scenario mapping
  - Team training
  - Rollback strategies
  - Success metrics

## 📖 Reference

### Commands

| Command       | Description          | Documentation                         |
| ------------- | -------------------- | ------------------------------------- |
| `init`        | Initialize workspace | [CLI Reference](./cli.md#init)        |
| `doctor`      | Validate environment | [CLI Reference](./cli.md#doctor)      |
| `discover`    | Find PRs             | [CLI Reference](./cli.md#discover)    |
| `plan`        | Generate merge plan  | [CLI Reference](./cli.md#plan)        |
| `execute`     | Run quality gates    | [CLI Reference](./cli.md#execute)     |
| `merge`       | Execute merges       | [CLI Reference](./cli.md#merge)       |
| `merge-order` | Show merge order     | [CLI Reference](./cli.md#merge-order) |
| `report`      | Aggregate results    | [CLI Reference](./cli.md#report)      |
| `status`      | Check system status  | [CLI Reference](./cli.md#status)      |
| `schema`      | Validate schemas     | [CLI Reference](./cli.md#schema)      |

### Exit Codes

- **`0`** - Success
- **`2`** - Validation errors (user input)
- **`1`** - System errors (unexpected)

See [Error Taxonomy](./errors.md) for details.

## 🎯 Quick Links

### Common Tasks

- **[First Time Setup](./quickstart.md#step-1-install-lexrunner)** - Install and initialize
- **[Create a PR Stack](./workflows/small-team.md#scenario-3-pr-stack)** - Dependent PRs
- **[Configure Quality Gates](./workflows/small-team.md#3-configure-quality-gates)** - Add checks
- **[Set Up CI/CD](./integrations/README.md#github-actions)** - Automation
- **[Debug Failures](./troubleshooting.md#debugging-techniques)** - Find issues

### Use Cases

- "I want to merge 10 PRs automatically" → [Small Team Workflow](./workflows/small-team.md)
- "I have dependent PRs to merge" → [Dependency Parser](./dependency-parser.md)
- "I need CI/CD integration" → [Integrations](./integrations/README.md)
- "Something's not working" → [Troubleshooting](./troubleshooting.md)
- "Migrating from manual process" → [Migration Guide](./migration-guide.md)

## 🤝 Contributing

### Documentation

Found an issue or want to improve docs?

1. **File an issue** - Report problems or suggest improvements
2. **Submit a PR** - Fix typos, add examples, clarify concepts
3. **Share workflows** - Contribute your team's workflow

### Code Examples

Help others by sharing:

- Configuration examples
- Custom gate scripts
- CI/CD pipeline templates
- Automation workflows

## 📦 Resources

### Downloads

- **[Latest Release](https://github.com/Guffawaffle/LexRunner/releases/latest)**
- **[Example Configurations](../../examples/)**
- **[Sample Fixtures](../../fixtures/)**

### External Links

- **[GitHub Repository](https://github.com/Guffawaffle/LexRunner)**
- **[Issue Tracker](https://github.com/Guffawaffle/LexRunner/issues)**
- **[Discussions](https://github.com/Guffawaffle/LexRunner/discussions)**
- **[npm Package](https://www.npmjs.com/package/lexrunner)**

## 📝 Document Index

### Core Documentation (Already Exists)

- [Quickstart Guide](./quickstart.md) ✅
- [CLI Reference](./cli.md) ✅
- [Autopilot](./autopilot.md) ✅
- [Autopilot Levels](./autopilot-levels.md) ✅
- [Profile Resolution](./profile-resolution.md) ✅
- [Dependency Parser](./dependency-parser.md) ✅
- [Schemas](./schemas.md) ✅
- [Errors](./errors.md) ✅
- [Weave Contract](./weave-contract.md) ✅
- [Merge-Weave Analysis](./merge-weave-analysis.md) ✅
- [Weave Execution Log](./weave-execution-log.md) ✅
- [Monitoring Implementation](./monitoring-implementation.md) ✅
- [Monitoring Examples](./monitoring-examples.md) ✅
- [CLI/MCP/Weave Reporting](./cli-mcp-weave-reporting.md) ✅
- [TERMS](./TERMS.md) ✅

### New Documentation (C3)

- [Architecture Overview](./architecture.md) ✅
- [Troubleshooting Guide](./troubleshooting.md) ✅
- [Migration Guide](./migration-guide.md) ✅
- [Video Tutorials](./tutorials/README.md) ✅
- [Workflows](./workflows/README.md) ✅
- [Integrations](./integrations/README.md) ✅

## 🔍 Search Tips

Use GitHub's search or your editor's search to find:

```bash
# Find command examples
grep -r "lex-pr plan" docs/

# Find configuration examples
grep -r "gates.yml" docs/

# Find troubleshooting tips
grep -r "Issue:" docs/troubleshooting.md
```

---

**Last Updated:** 2024
**Version:** 0.1.0
**Maintainers:** lexrunner team
