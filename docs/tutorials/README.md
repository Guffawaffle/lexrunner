# Video Tutorial Scripts

This directory contains scripts and resources for creating video tutorials about lex-pr-runner.

## Quick Start Tutorial

**[Quick Merge Pyramid](./quick-merge-pyramid.md)** (10 minutes) - Complete hands-on tutorial
- Discover → Plan → Execute → Merge workflow
- Dependency management and merge order
- Gate execution and verification
- Common patterns and best practices
- **Start here** for a practical introduction to lex-pr-runner!

## Available Scripts

1. **[Getting Started](./01-getting-started.md)** (5 minutes)
   - Installation and setup
   - First successful merge
   - Target audience: New users

2. **[Understanding Dependencies](./02-understanding-dependencies.md)** (8 minutes)
   - Dependency syntax
   - Merge order computation
   - Target audience: Developers

3. **[Quality Gates](./03-quality-gates.md)** (10 minutes)
   - Configuring gates
   - Gate execution
   - Target audience: DevOps/QA

4. **[CI/CD Integration](./04-cicd-integration.md)** (12 minutes)
   - GitHub Actions setup
   - Automated workflows
   - Target audience: Platform engineers

5. **[Advanced Workflows](./05-advanced-workflows.md)** (15 minutes)
   - PR stacks
   - Team coordination
   - Target audience: Tech leads

## Video Production Guidelines

### Recording Setup

**Screen Recording:**
- Resolution: 1920x1080 (1080p)
- Frame rate: 30 fps
- Software: OBS Studio, ScreenFlow, or Camtasia

**Terminal:**
- Font: Monaco or Fira Code, 14pt
- Color scheme: Solarized Dark or Nord
- Window size: 80x24 minimum

**Audio:**
- Microphone: USB condenser mic (Blue Yeti or similar)
- Sample rate: 48kHz
- No background music during code demos

### Visual Style

**Terminal Prompts:**
```bash
# Use clear, short prompts
$ lex-pr init

# Show output immediately
✓ Workspace initialized

# Highlight important output
[✓] All gates passed
```

**Code Examples:**
- Use syntax highlighting
- Show complete, runnable examples
- Include error cases and recovery

**Annotations:**
- Add text overlays for key concepts
- Use arrows to highlight CLI output
- Show keyboard shortcuts

### Pacing

- **Introduction:** 30 seconds (what you'll learn)
- **Setup:** 1-2 minutes (prerequisites)
- **Demonstration:** 60-70% of video (hands-on)
- **Recap:** 30 seconds (what you learned)
- **Next Steps:** 30 seconds (where to go next)

## Recording Checklist

Before recording:
- [ ] Test all commands in clean environment
- [ ] Prepare sample repository with example PRs
- [ ] Script key talking points
- [ ] Close unnecessary applications
- [ ] Disable notifications
- [ ] Test audio levels

During recording:
- [ ] Speak clearly and at moderate pace
- [ ] Pause between commands to show output
- [ ] Explain what you're doing and why
- [ ] Show both success and error cases
- [ ] Point out important output/results

After recording:
- [ ] Add captions/subtitles
- [ ] Include chapter markers
- [ ] Add end screen with links
- [ ] Test playback at 1x and 1.5x speed

## Sample Repository Setup

Create example repository for demos:

```bash
# Create demo repo
mkdir lex-pr-demo
cd lex-pr-demo
git init

# Create sample PRs (use gh CLI)
gh pr create --title "Add authentication" --body "Base feature" --label "ready"
gh pr create --title "Add API endpoints" --body "Depends-On: #1" --label "ready"
gh pr create --title "Add dashboard" --body "Depends-On: #2" --label "ready"

# Initialize lex-pr-runner
lex-pr init
```

## Accompanying Resources

For each video, provide:

1. **Written transcript** - Full text of narration
2. **Code snippets** - Copy-pasteable examples
3. **Slide deck** - Key concepts and diagrams
4. **Exercise files** - Sample configurations
5. **Quiz** - Test understanding (optional)

## Publishing

### YouTube
- Title format: "lex-pr-runner: [Topic] - [Duration]"
- Description: Link to docs, timestamps, resources
- Tags: git, automation, pr, merge, ci-cd, devops
- Playlist: "lex-pr-runner Tutorials"

### Documentation Site
- Embed videos in relevant docs pages
- Provide download links for offline viewing
- Include transcript for accessibility

## Maintenance

Update videos when:
- CLI interface changes significantly
- New major features added
- Best practices evolve

Strategy:
- Create new video for major changes
- Add pinned comment for minor updates
- Archive outdated videos with redirect

## Feedback

Collect viewer feedback via:
- YouTube comments
- GitHub Discussions
- Video-specific survey links

Track metrics:
- Watch time and completion rate
- Likes/dislikes ratio
- Common questions in comments

## Related Documentation

- [Quickstart Guide](../quickstart.md) - Text version of Getting Started
- [CLI Reference](../cli.md) - Complete command documentation
- [Examples](../../examples/) - Working code examples
