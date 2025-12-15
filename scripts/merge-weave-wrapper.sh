#!/usr/bin/env bash

# Merge-Weave Convenience Wrapper
# A simplified interface for common merge-weave operations
#
# This script wraps the lex-pr CLI to provide easy access to merge-weave
# functionality in any Lex ecosystem repository.
#
# Prerequisites:
#   - LexRunner installed (npm link lexrunner or npm install github:Guffawaffle/LexRunner)
#   - GitHub CLI (gh) for PR discovery
#   - Git repository with remote configured
#
# Usage:
#   ./merge-weave-wrapper.sh <command> [options]
#
# Commands:
#   discover  - Discover PRs from GitHub and generate plan
#   preview   - Preview merge operations (dry-run)
#   execute   - Execute merge operations
#   resume    - Resume from failed execution
#   help      - Show this help message

set -e

# ═══════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

SCRIPT_VERSION="1.0.0"
PLAN_FILE="${MERGE_WEAVE_PLAN:-plan.json}"
INTEGRATION_BRANCH_PREFIX="${MERGE_WEAVE_BRANCH_PREFIX:-integration/}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════

log_info() {
    echo -e "${BLUE}ℹ${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}✅${NC} $*" >&2
}

log_warning() {
    echo -e "${YELLOW}⚠️${NC} $*" >&2
}

log_error() {
    echo -e "${RED}❌${NC} $*" >&2
}

show_help() {
    cat << EOF
${BOLD}Merge-Weave Wrapper${NC} v${SCRIPT_VERSION}

${BOLD}USAGE:${NC}
  $0 <command> [options]

${BOLD}COMMANDS:${NC}
  discover [--labels LABELS]       Discover PRs from GitHub and generate plan
  preview [--plan FILE]            Preview merge operations (dry-run)
  execute [--plan FILE] [OPTIONS]  Execute merge operations
  resume [--run-id ID]             Resume from failed execution
  help                             Show this help message

${BOLD}DISCOVER OPTIONS:${NC}
  --labels LABELS        Comma-separated list of GitHub labels (default: ready-to-merge)
  --base BRANCH          Base branch to merge into (default: main)
  --output FILE          Output plan file (default: $PLAN_FILE)

${BOLD}EXECUTE OPTIONS:${NC}
  --plan FILE            Path to plan.json (default: $PLAN_FILE)
  --cleanup              Remove integration branches after success
  --track-metrics        Track Turn Cost coordination metrics
  --resolve-policy POL   Conflict resolution: minimal-hunk (default), ours, theirs
  --verbose              Show detailed output
  --dry-run              Preview only (same as 'preview' command)

${BOLD}ENVIRONMENT VARIABLES:${NC}
  MERGE_WEAVE_PLAN              Plan file path (default: plan.json)
  MERGE_WEAVE_BRANCH_PREFIX     Integration branch prefix (default: integration/)
  GITHUB_OWNER                  GitHub repository owner (auto-detected if not set)
  GITHUB_REPO                   GitHub repository name (auto-detected if not set)

${BOLD}EXAMPLES:${NC}
  # Discover PRs with "ready-to-merge" label
  $0 discover --labels ready-to-merge

  # Preview merge operations
  $0 preview

  # Execute merge with cleanup
  $0 execute --cleanup

  # Execute with specific conflict resolution
  $0 execute --resolve-policy ours --cleanup

  # Resume after failure
  $0 resume

${BOLD}WORKFLOW:${NC}
  1. $0 discover --labels ready-to-merge     # Generate plan from GitHub PRs
  2. $0 preview                               # Review merge plan (dry-run)
  3. $0 execute --cleanup                     # Execute merge pyramid

${BOLD}NOTES:${NC}
  - Always preview before executing
  - Use --track-metrics to measure coordination overhead
  - Cleanup removes integration branches after successful merge
  - Resume capability requires weave-lock.json from previous run

EOF
}

check_prerequisites() {
    # Check for lex-pr command
    if ! command -v lex-pr &> /dev/null; then
        log_error "lex-pr command not found"
        log_info "Install LexRunner:"
        log_info "  npm link lexrunner"
        log_info "  OR npm install github:Guffawaffle/LexRunner"
        exit 1
    fi

    # Check for git
    if ! command -v git &> /dev/null; then
        log_error "git command not found"
        exit 1
    fi

    # Check if in git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi
}

detect_github_info() {
    # Try environment variables first
    if [ -n "$GITHUB_OWNER" ] && [ -n "$GITHUB_REPO" ]; then
        echo "$GITHUB_OWNER/$GITHUB_REPO"
        return 0
    fi

    # Auto-detect from git remote
    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || echo "")

    if [ -z "$remote_url" ]; then
        log_error "Could not detect GitHub repository"
        log_info "Set GITHUB_OWNER and GITHUB_REPO environment variables"
        exit 1
    fi

    # Extract owner and repo from remote URL
    # Handles both HTTPS and SSH formats
    GITHUB_OWNER=$(echo "$remote_url" | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|')
    GITHUB_REPO=$(basename "$remote_url" .git)

    if [ -z "$GITHUB_OWNER" ] || [ -z "$GITHUB_REPO" ]; then
        log_error "Could not parse GitHub owner/repo from remote: $remote_url"
        exit 1
    fi

    echo "$GITHUB_OWNER/$GITHUB_REPO"
}

# ═══════════════════════════════════════════════════════════════════════════
# COMMAND HANDLERS
# ═══════════════════════════════════════════════════════════════════════════

cmd_discover() {
    local labels="ready-to-merge"
    local base="main"
    local output="$PLAN_FILE"

    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --labels)
                labels="$2"
                shift 2
                ;;
            --base)
                base="$2"
                shift 2
                ;;
            --output)
                output="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    log_info "Discovering PRs from GitHub..."
    
    local repo_info
    repo_info=$(detect_github_info)
    log_info "Repository: $repo_info"
    log_info "Labels: $labels"
    log_info "Base branch: $base"
    echo ""

    lex-pr discover \
        --owner "$GITHUB_OWNER" \
        --repo "$GITHUB_REPO" \
        --labels "$labels" \
        --base "$base" \
        --output "$output"

    if [ -f "$output" ]; then
        log_success "Plan generated: $output"
        
        # Show summary if jq is available
        if command -v jq &> /dev/null; then
            local pr_count
            pr_count=$(jq -r '.nodes | length' "$output" 2>/dev/null || echo "unknown")
            log_info "PRs discovered: $pr_count"
        fi
    else
        log_error "Failed to generate plan"
        exit 1
    fi
}

cmd_preview() {
    local plan="$PLAN_FILE"
    local verbose=false

    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --plan)
                plan="$2"
                shift 2
                ;;
            --verbose)
                verbose=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    if [ ! -f "$plan" ]; then
        log_error "Plan file not found: $plan"
        log_info "Run '$0 discover' to generate a plan"
        exit 1
    fi

    log_info "Previewing merge operations (dry-run)..."
    log_info "Plan: $plan"
    echo ""

    if [ "$verbose" = true ]; then
        lex-pr merge --plan "$plan" --dry-run
    else
        lex-pr merge --plan "$plan" --dry-run --json | jq '.'
    fi
}

cmd_execute() {
    local plan="$PLAN_FILE"
    local cleanup=false
    local track_metrics=false
    local resolve_policy="minimal-hunk"
    local verbose=false
    local dry_run=false

    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --plan)
                plan="$2"
                shift 2
                ;;
            --cleanup)
                cleanup=true
                shift
                ;;
            --track-metrics)
                track_metrics=true
                shift
                ;;
            --resolve-policy)
                resolve_policy="$2"
                shift 2
                ;;
            --verbose)
                verbose=true
                shift
                ;;
            --dry-run)
                dry_run=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    if [ ! -f "$plan" ]; then
        log_error "Plan file not found: $plan"
        log_info "Run '$0 discover' to generate a plan"
        exit 1
    fi

    if [ "$dry_run" = true ]; then
        log_info "Dry-run mode (preview only)..."
        cmd_preview --plan "$plan" --verbose
        return 0
    fi

    log_info "Executing merge pyramid..."
    log_info "Plan: $plan"
    log_info "Conflict resolution: $resolve_policy"
    [ "$cleanup" = true ] && log_info "Cleanup: enabled"
    [ "$track_metrics" = true ] && log_info "Metrics tracking: enabled"
    echo ""

    local execute_opts="--plan $plan --execute --resolve-policy $resolve_policy"
    [ "$cleanup" = true ] && execute_opts="$execute_opts --cleanup"
    [ "$track_metrics" = true ] && execute_opts="$execute_opts --track-turncost"
    [ "$verbose" = false ] && execute_opts="$execute_opts --json"

    if [ "$verbose" = true ]; then
        lex-pr merge $execute_opts
    else
        lex-pr merge $execute_opts | jq '.'
    fi

    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "Merge pyramid execution completed successfully"
    else
        log_error "Merge pyramid execution failed (exit code: $exit_code)"
        log_info "Use '$0 resume' to continue from last successful state"
        exit $exit_code
    fi
}

cmd_resume() {
    local run_id=""

    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --run-id)
                run_id="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    log_info "Resuming merge execution from weave-lock.json..."

    if [ ! -f "weave-lock.json" ]; then
        log_error "Lock file not found: weave-lock.json"
        log_info "No execution to resume"
        exit 1
    fi

    local resume_opts="--resume"
    [ -n "$run_id" ] && resume_opts="$resume_opts $run_id"

    lex-pr merge $resume_opts --json | jq '.'

    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "Resume completed successfully"
    else
        log_error "Resume failed (exit code: $exit_code)"
        exit $exit_code
    fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi

    local command="$1"
    shift

    case "$command" in
        discover)
            check_prerequisites
            cmd_discover "$@"
            ;;
        preview)
            check_prerequisites
            cmd_preview "$@"
            ;;
        execute)
            check_prerequisites
            cmd_execute "$@"
            ;;
        resume)
            check_prerequisites
            cmd_resume "$@"
            ;;
        help|-h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"
