# Workflow Examples

This directory contains workflow examples for different team sizes and project types.

## By Team Size

### Solo Developer

**File:** [solo-developer.md](./solo-developer.md)

- Simple automation for personal projects
- Minimal configuration
- Focus on productivity

### Small Team (2-5 developers)

**File:** [small-team.md](./small-team.md)

- Collaborative workflows
- Basic dependency management
- Team coordination

### Medium Team (6-20 developers)

**File:** [medium-team.md](./medium-team.md)

- Multiple work streams
- Advanced dependency handling
- Quality gates and policies

### Large Team (20+ developers)

**File:** [large-team.md](./large-team.md)

- Monorepo support
- Team-specific scopes
- Scalable automation

### Enterprise

**File:** [enterprise.md](./enterprise.md)

- Multi-repository coordination
- Compliance and governance
- Advanced CI/CD integration

## By Project Type

### Open Source Project

**File:** [open-source.md](./open-source.md)

- External contributor workflow
- Community PR management
- Release automation

### SaaS Application

**File:** [saas-application.md](./saas-application.md)

- Feature flags
- Continuous deployment
- Zero-downtime releases

### Mobile App

**File:** [mobile-app.md](./mobile-app.md)

- Platform-specific gates (iOS/Android)
- App store submission prep
- Beta testing workflows

### Library/SDK

**File:** [library-sdk.md](./library-sdk.md)

- API compatibility checks
- Version management
- Documentation updates

## By Development Workflow

### Trunk-Based Development

**File:** [trunk-based.md](./trunk-based.md)

- Short-lived feature branches
- Continuous integration
- Rapid merge cycles

### GitFlow

**File:** [gitflow.md](./gitflow.md)

- Release branches
- Hotfix workflow
- Version management

### GitHub Flow

**File:** [github-flow.md](./github-flow.md)

- Deploy from main
- Feature branches
- Automated deployments

## Quick Start

Choose the workflow that matches your team:

```bash
# Copy example configuration
cp docs/workflows/<your-team-size>.yml .smartergpt.local/

# Customize for your needs
vim .smartergpt.local/scope.yml

# Run workflow
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

## Customization Guide

Each workflow can be customized:

1. **Scope filters** - Which PRs to include
2. **Quality gates** - What checks to run
3. **Dependencies** - How PRs relate
4. **Automation level** - Manual vs automated

See [Autopilot Levels](../autopilot-levels.md) for automation options.

## Related Documentation

- [Migration Guide](../migration-guide.md) - Moving from manual processes
- [CI/CD Integrations](../integrations/) - Platform-specific setup
- [Troubleshooting](../troubleshooting.md) - Common issues
