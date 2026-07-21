# CI/CD Integration Examples

Integration examples for popular CI/CD platforms.

## Supported Platforms

### Cloud CI/CD

- [GitHub Actions](#github-actions) - Native GitHub integration
- [GitLab CI](#gitlab-ci) - GitLab pipelines
- [CircleCI](#circleci) - Cloud-based CI/CD
- [Travis CI](#travis-ci) - Open source friendly

### Self-Hosted

- [Jenkins](#jenkins) - Industry standard
- [Drone CI](#drone-ci) - Container-native
- [TeamCity](#teamcity) - JetBrains platform
- [Buildkite](#buildkite) - Hybrid cloud

### Enterprise

- [Azure DevOps](#azure-devops) - Microsoft ecosystem
- [AWS CodePipeline](#aws-codepipeline) - AWS native
- [Google Cloud Build](#google-cloud-build) - GCP integration

## GitHub Actions

### Basic Workflow

**`.github/workflows/auto-merge.yml`:**

```yaml
name: Automated PR Merge

on:
  schedule:
    - cron: "0 */2 * * *" # Every 2 hours
  workflow_dispatch: # Manual trigger
  pull_request:
    types: [labeled]

jobs:
  merge-automation:
    runs-on: ubuntu-latest
    if: |
      github.event_name == 'workflow_dispatch' ||
      github.event_name == 'schedule' ||
      github.event.label.name == 'ready-to-merge'

    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: Install lexrunner
        run: npm install -g lexrunner

      - name: Initialize workspace
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: lex-pr init --non-interactive

      - name: Discover PRs
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: lex-pr discover --json > discovered-prs.json

      - name: Generate plan
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: lex-pr plan --from-github --out artifacts/

      - name: Execute gates
        run: lex-pr execute artifacts/plan.json

      - name: Upload gate results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: gate-results
          path: gate-results/

      - name: Merge PRs
        if: success()
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: lex-pr merge artifacts/plan.json --execute

      - name: Generate report
        if: always()
        run: |
          lex-pr report gate-results --out md > merge-report.md
          cat merge-report.md >> $GITHUB_STEP_SUMMARY
```

### Advanced: Matrix Strategy

```yaml
name: Multi-Environment Merge

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
        type: choice
        options:
          - development
          - staging
          - production

jobs:
  merge:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}

    steps:
      - uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: Install lexrunner
        run: npm install -g lexrunner

      - name: Configure for environment
        run: |
          cat > .smartergpt.local/scope.yml << EOF
          target: ${{ github.event.inputs.environment }}
          filters:
            labels: ["deploy-${{ github.event.inputs.environment }}"]
          EOF

      - name: Run automation
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          lex-pr plan --from-github
          lex-pr execute plan.json
          lex-pr merge plan.json --execute
```

## GitLab CI

**`.gitlab-ci.yml`:**

```yaml
stages:
  - discover
  - plan
  - execute
  - merge

variables:
  LEX_PR_PROFILE_DIR: .smartergpt.local

# Run every 2 hours
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "web"

discover:
  stage: discover
  image: node:20
  before_script:
    - npm install -g lexrunner
  script:
    - lex-pr discover --json > discovered-prs.json
  artifacts:
    paths:
      - discovered-prs.json
    expire_in: 1 hour

plan:
  stage: plan
  image: node:20
  before_script:
    - npm install -g lexrunner
  script:
    - lex-pr plan --from-github --out artifacts/
  artifacts:
    paths:
      - artifacts/
    expire_in: 1 hour

execute:
  stage: execute
  image: node:20
  before_script:
    - npm install -g lexrunner
  script:
    - lex-pr execute artifacts/plan.json
  artifacts:
    paths:
      - gate-results/
    expire_in: 1 week
    when: always

merge:
  stage: merge
  image: node:20
  before_script:
    - npm install -g lexrunner
  script:
    - lex-pr merge artifacts/plan.json --execute
  when: on_success
  only:
    - schedules
    - web
```

## Jenkins

**`Jenkinsfile`:**

```groovy
pipeline {
  agent any

  triggers {
    // Run every 2 hours
    cron('0 */2 * * *')
  }

  environment {
    GITHUB_TOKEN = credentials('github-token')
    LEX_PR_PROFILE_DIR = '.smartergpt.local'
  }

  stages {
    stage('Setup') {
      steps {
        sh 'npm install -g lexrunner'
        sh 'lex-pr init --non-interactive'
      }
    }

    stage('Discover') {
      steps {
        sh 'lex-pr discover --json > discovered-prs.json'
        archiveArtifacts artifacts: 'discovered-prs.json'
      }
    }

    stage('Plan') {
      steps {
        sh 'lex-pr plan --from-github --out artifacts/'
        archiveArtifacts artifacts: 'artifacts/**/*'
      }
    }

    stage('Execute Gates') {
      steps {
        sh 'lex-pr execute artifacts/plan.json'
      }
      post {
        always {
          archiveArtifacts artifacts: 'gate-results/**/*'
          publishHTML([
            reportDir: 'gate-results',
            reportFiles: 'index.html',
            reportName: 'Gate Results'
          ])
        }
      }
    }

    stage('Merge') {
      when {
        expression { currentBuild.result == 'SUCCESS' }
      }
      steps {
        sh 'lex-pr merge artifacts/plan.json --execute'
      }
    }

    stage('Report') {
      steps {
        sh 'lex-pr report gate-results --out md > merge-report.md'
        archiveArtifacts artifacts: 'merge-report.md'
      }
    }
  }

  post {
    always {
      // Send Slack notification
      slackSend(
        channel: '#deployments',
        message: "Merge automation: ${currentBuild.currentResult}",
        tokenCredentialId: 'slack-token'
      )
    }
  }
}
```

## CircleCI

**`.circleci/config.yml`:**

```yaml
version: 2.1

orbs:
  node: circleci/node@5.1.0

workflows:
  scheduled-merge:
    triggers:
      - schedule:
          cron: "0 */2 * * *"
          filters:
            branches:
              only:
                - main
    jobs:
      - merge-automation

  manual-merge:
    jobs:
      - merge-automation:
          filters:
            branches:
              only:
                - main

jobs:
  merge-automation:
    docker:
      - image: cimg/node:20.18

    steps:
      - checkout

      - run:
          name: Install lexrunner
          command: npm install -g lexrunner

      - run:
          name: Initialize workspace
          command: lex-pr init --non-interactive
          environment:
            GITHUB_TOKEN: ${GITHUB_TOKEN}

      - run:
          name: Discover PRs
          command: lex-pr discover --json > discovered-prs.json

      - run:
          name: Generate plan
          command: lex-pr plan --from-github --out artifacts/

      - run:
          name: Execute gates
          command: lex-pr execute artifacts/plan.json

      - store_artifacts:
          path: gate-results
          destination: gate-results

      - run:
          name: Merge PRs
          command: lex-pr merge artifacts/plan.json --execute
          when: on_success

      - run:
          name: Generate report
          command: |
            lex-pr report gate-results --out md > merge-report.md
          when: always

      - store_artifacts:
          path: merge-report.md
          destination: merge-report
```

## Azure DevOps

**`azure-pipelines.yml`:**

```yaml
trigger: none

schedules:
  - cron: "0 */2 * * *"
    displayName: Every 2 hours
    branches:
      include:
        - main

pool:
  vmImage: "ubuntu-latest"

variables:
  GITHUB_TOKEN: $(GitHubToken)

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"
    displayName: "Install Node.js"

  - script: |
      npm install -g lexrunner
    displayName: "Install lexrunner"

  - script: |
      lex-pr init --non-interactive
    displayName: "Initialize workspace"
    env:
      GITHUB_TOKEN: $(GITHUB_TOKEN)

  - script: |
      lex-pr discover --json > discovered-prs.json
    displayName: "Discover PRs"

  - script: |
      lex-pr plan --from-github --out $(Build.ArtifactStagingDirectory)/
    displayName: "Generate plan"

  - script: |
      lex-pr execute $(Build.ArtifactStagingDirectory)/plan.json
    displayName: "Execute gates"

  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: "gate-results"
      artifactName: "gate-results"
    condition: always()

  - script: |
      lex-pr merge $(Build.ArtifactStagingDirectory)/plan.json --execute
    displayName: "Merge PRs"
    condition: succeeded()

  - script: |
      lex-pr report gate-results --out md > merge-report.md
    displayName: "Generate report"
    condition: always()

  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: "merge-report.md"
      artifactName: "merge-report"
    condition: always()
```

## Docker Integration

**`Dockerfile`:**

```dockerfile
FROM node:20-alpine

# Install lexrunner
RUN npm install -g lexrunner

# Set working directory
WORKDIR /workspace

# Copy configuration (if baked into image)
COPY .smartergpt.local /workspace/.smartergpt.local

# Entrypoint
ENTRYPOINT ["lex-pr"]
```

**Usage:**

```bash
# Build image
docker build -t lexrunner .

# Run automation
docker run --rm \
  -v $(pwd):/workspace \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  lexrunner plan --from-github
```

## Best Practices

### Security

1. **Token Management**

   ```yaml
   # Use secrets, never hardcode
   env:
     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

2. **Least Privilege**
   - Grant minimum required permissions
   - Use repository-scoped tokens
   - Rotate tokens regularly

3. **Artifact Security**
   - Don't expose sensitive data in artifacts
   - Set expiration on artifacts
   - Restrict artifact access

### Performance

1. **Caching**

   ```yaml
   # GitHub Actions example
   - uses: actions/cache@v6
     with:
       path: ~/.npm
       key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
   ```

2. **Parallelization**

   ```yaml
   # Run gates in parallel when possible
   env:
     LEX_PR_MAX_WORKERS: 4
   ```

3. **Artifact Management**
   - Set appropriate retention periods
   - Clean up old artifacts
   - Use compression for large artifacts

### Monitoring

1. **Notifications**
   - Send alerts on failures
   - Report successful merges
   - Track metrics over time

2. **Logging**

   ```bash
   # Structured logging
   lex-pr plan --json | tee plan.log
   ```

3. **Metrics**
   - Track merge success rate
   - Monitor gate execution time
   - Measure time-to-merge

## Troubleshooting

### Common Issues

**Issue: Token permissions**

```bash
# Verify token has required scopes
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user
```

**Issue: Timeouts**

```yaml
# Increase timeout
env:
  LEX_PR_TIMEOUT: 600
```

**Issue: Network errors**

```bash
# Add retry logic
retry: 3
```

## Related Documentation

- [Workflows](../workflows/) - Team-specific examples
- [Troubleshooting](../troubleshooting.md) - Common issues
- [CLI Reference](../cli.md) - Command documentation
