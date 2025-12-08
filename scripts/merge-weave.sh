#!/usr/bin/env bash

# Parameterized merge-weave script
# Merges multiple PRs into an umbrella/integration branch with validation gates

set -e

# ═══════════════════════════════════════════════════════════════════════════
# SCRIPT CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"

# Default values
REPO_DIR="$(pwd)"
TARGET_BRANCH="main"
UMBRELLA_BRANCH=""
PR_LIST=""
DRY_RUN=false
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

log_verbose() {
  if [ "$VERBOSE" = true ]; then
    echo -e "${CYAN}🔍${NC} $*" >&2
  fi
}

show_help() {
  cat << EOF
${SCRIPT_NAME} - Parameterized merge-weave script v${SCRIPT_VERSION}

USAGE:
  ${SCRIPT_NAME} [OPTIONS]

DESCRIPTION:
  Merges multiple PRs into an umbrella/integration branch with validation gates.
  Stops on first conflict without auto-resolution.

OPTIONS:
  --repo-dir DIR       Repository directory (default: current dir)
  --target BRANCH      Target branch for umbrella (default: main)
  --umbrella NAME      Umbrella branch name (default: integration/umbrella-YYYYMMDD)
  --prs "1,2,3"        Comma-separated PR numbers to merge (required)
  --dry-run            Show what would be done without making changes
  --verbose            Show detailed output
  --help               Show this help message

EXAMPLES:
  # Merge PRs 13, 14, 17, 19 into umbrella
  ${SCRIPT_NAME} --prs "13,14,17,19" --verbose

  # Dry run to see what would happen
  ${SCRIPT_NAME} --prs "13,14,17,19" --dry-run

  # Use custom umbrella branch name
  ${SCRIPT_NAME} --prs "1,2,3" --umbrella "integration/my-feature"

  # Work in different repository directory
  ${SCRIPT_NAME} --repo-dir /path/to/repo --prs "5,6,7"

EXIT CODES:
  0 - Success
  1 - General error
  2 - Invalid arguments
  3 - Merge conflict detected
  4 - Gate validation failed

EOF
}

# ═══════════════════════════════════════════════════════════════════════════
# ARGUMENT PARSING
# ═══════════════════════════════════════════════════════════════════════════

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --repo-dir)
        if [ -z "$2" ] || [[ "$2" == --* ]]; then
          log_error "Option --repo-dir requires a value"
          exit 2
        fi
        REPO_DIR="$2"
        shift 2
        ;;
      --target)
        if [ -z "$2" ] || [[ "$2" == --* ]]; then
          log_error "Option --target requires a value"
          exit 2
        fi
        TARGET_BRANCH="$2"
        shift 2
        ;;
      --umbrella)
        if [ -z "$2" ] || [[ "$2" == --* ]]; then
          log_error "Option --umbrella requires a value"
          exit 2
        fi
        UMBRELLA_BRANCH="$2"
        shift 2
        ;;
      --prs)
        if [ -z "$2" ] || [[ "$2" == --* ]]; then
          log_error "Option --prs requires a value"
          exit 2
        fi
        PR_LIST="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --verbose)
        VERBOSE=true
        shift
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        log_error "Unknown option: $1"
        echo ""
        show_help
        exit 2
        ;;
    esac
  done

  # Validate required arguments
  if [ -z "$PR_LIST" ]; then
    log_error "Missing required argument: --prs"
    echo ""
    show_help
    exit 2
  fi

  # Set default umbrella branch if not specified
  if [ -z "$UMBRELLA_BRANCH" ]; then
    UMBRELLA_BRANCH="integration/umbrella-$(date +%Y%m%d)"
  fi

  # Validate repository directory
  if [ ! -d "$REPO_DIR" ]; then
    log_error "Repository directory does not exist: $REPO_DIR"
    exit 2
  fi

  if [ ! -d "$REPO_DIR/.git" ]; then
    log_error "Not a git repository: $REPO_DIR"
    exit 2
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# CORE FUNCTIONALITY
# ═══════════════════════════════════════════════════════════════════════════

check_gh_cli() {
  if ! command -v gh &> /dev/null; then
    log_error "GitHub CLI (gh) is not installed or not in PATH"
    log_error "Install from: https://cli.github.com/"
    exit 1
  fi
  log_verbose "GitHub CLI found: $(gh --version | head -1)"
}

fetch_pr_branch() {
  local pr_num=$1
  local branch_name

  log_verbose "Fetching branch name for PR #$pr_num..."
  
  if [ "$DRY_RUN" = true ]; then
    echo "pr-${pr_num}-branch"
    return 0
  fi

  branch_name=$(gh pr view "$pr_num" --json headRefName -q .headRefName 2>/dev/null)
  
  if [ -z "$branch_name" ]; then
    log_error "Could not fetch branch name for PR #$pr_num"
    exit 1
  fi

  echo "$branch_name"
}

verify_pr_branches() {
  local mapping_file="$1"
  shift
  local pr_numbers=("$@")
  
  log_info "Verifying PR branches..."
  echo "" >&2

  # Clear the mapping file
  > "$mapping_file"

  for pr_num in "${pr_numbers[@]}"; do
    # Validate PR number is numeric
    if ! [[ "$pr_num" =~ ^[0-9]+$ ]]; then
      log_error "Invalid PR number: $pr_num (must be numeric)"
      exit 2
    fi
    
    branch_name=$(fetch_pr_branch "$pr_num")
    
    # Validate branch name follows git conventions (basic check)
    # Git branch names can contain alphanumeric, dash, underscore, slash, and dots
    # but cannot contain special chars like ~, ^, :, ?, *, [, \, or whitespace
    if ! [[ "$branch_name" =~ ^[a-zA-Z0-9._/-]+$ ]] || [[ "$branch_name" =~ \.\. ]]; then
      log_error "Invalid branch name: $branch_name"
      exit 1
    fi
    
    if [ "$DRY_RUN" = true ]; then
      log_info "[DRY-RUN] PR-$pr_num → $branch_name (not verified)"
    else
      if git show-ref --quiet refs/remotes/origin/"$branch_name"; then
        log_success "PR-$pr_num → $branch_name"
        # Count commits ahead of target (using origin/ for both refs)
        ahead=$(git rev-list --count origin/"$TARGET_BRANCH"..origin/"$branch_name" 2>/dev/null || echo "0")
        log_verbose "  Commits ahead of $TARGET_BRANCH: $ahead"
      else
        log_error "PR-$pr_num branch NOT FOUND: $branch_name"
        exit 1
      fi
    fi
    
    # Write mapping to file
    echo "$pr_num:$branch_name" >> "$mapping_file"
  done
  
  echo "" >&2
}

create_umbrella_branch() {
  log_info "Creating umbrella branch: $UMBRELLA_BRANCH"
  echo "" >&2

  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY-RUN] Would create branch: $UMBRELLA_BRANCH from origin/$TARGET_BRANCH"
    return 0
  fi

  # Check if branch already exists
  if git show-ref --quiet refs/heads/"$UMBRELLA_BRANCH"; then
    log_warning "Umbrella branch already exists, resetting to origin/$TARGET_BRANCH"
    git checkout "$UMBRELLA_BRANCH"
    git reset --hard origin/"$TARGET_BRANCH"
  else
    log_info "Creating new branch: $UMBRELLA_BRANCH from origin/$TARGET_BRANCH"
    git checkout -b "$UMBRELLA_BRANCH" origin/"$TARGET_BRANCH"
  fi
  
  log_success "Umbrella branch ready: $UMBRELLA_BRANCH"
  echo "" >&2
}

merge_prs() {
  local merge_failures=0
  local merge_successes=0
  local total_prs=0
  
  # Count PRs and store mapping
  local -a pr_nums
  local -a branch_names
  
  # Parse PR branches from input
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      pr_num="${line%%:*}"
      branch_name="${line#*:}"
      pr_nums+=("$pr_num")
      branch_names+=("$branch_name")
      total_prs=$((total_prs + 1))
    fi
  done

  log_info "Merging $total_prs PRs sequentially..."
  echo "" >&2

  for i in "${!pr_nums[@]}"; do
    pr_num="${pr_nums[$i]}"
    branch_name="${branch_names[$i]}"
    
    log_info "Merging PR-$pr_num from $branch_name..."
    
    if [ "$DRY_RUN" = true ]; then
      log_info "[DRY-RUN] Would merge: git merge --no-ff -m \"Merge PR-$pr_num\" origin/$branch_name"
      merge_successes=$((merge_successes + 1))
    else
      # Get first line of PR commit message for merge commit
      # Sanitize commit message to prevent command injection
      commit_msg=$(git log -1 --pretty=%B origin/"$branch_name" | head -1 | tr -d '\n\r' | sed 's/["`$\\]//g')
      
      # Use git merge with properly quoted message
      if git merge --no-ff -m "Merge PR-$pr_num: $commit_msg" origin/"$branch_name" 2>&1 | head -10; then
        log_success "Merged PR-$pr_num"
        merge_successes=$((merge_successes + 1))
      else
        log_error "CONFLICT merging PR-$pr_num - stopping (no auto-resolution)"
        log_error "Please resolve conflicts manually and re-run"
        git merge --abort 2>/dev/null || true
        merge_failures=$((merge_failures + 1))
        exit 3
      fi
    fi
    echo "" >&2
  done

  log_success "Merged $merge_successes/$((merge_successes + merge_failures)) PRs successfully"
  
  if [ $merge_failures -gt 0 ]; then
    exit 3
  fi
}

run_validation_gates() {
  log_info "Running validation gates..."
  echo "" >&2

  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY-RUN] Would run: npm run lint && npm run typecheck && npm test"
    return 0
  fi

  local gate_failed=false

  # Run linting
  log_info "Gate 1/3: Linting..."
  if npm run lint 2>&1 | tail -10; then
    log_success "Linting passed"
  else
    log_error "Linting failed"
    gate_failed=true
  fi
  echo "" >&2

  # Run typecheck
  log_info "Gate 2/3: Type checking..."
  if npm run typecheck 2>&1 | tail -10; then
    log_success "Type checking passed"
  else
    log_error "Type checking failed"
    gate_failed=true
  fi
  echo "" >&2

  # Run tests
  log_info "Gate 3/3: Running tests..."
  if npm test 2>&1 | tail -20; then
    log_success "Tests passed"
  else
    log_error "Tests failed"
    gate_failed=true
  fi
  echo "" >&2

  if [ "$gate_failed" = true ]; then
    log_error "Validation gates failed"
    exit 4
  fi

  log_success "All validation gates passed"
  echo "" >&2
}

show_summary() {
  local pr_numbers=("$@")
  
  echo "════════════════════════════════════════════════════════════════"
  log_success "MERGE-WEAVE COMPLETE"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  echo "Configuration:"
  echo "  Repository:      $REPO_DIR"
  echo "  Target branch:   $TARGET_BRANCH"
  echo "  Umbrella branch: $UMBRELLA_BRANCH"
  echo "  PRs merged:      ${pr_numbers[*]}"
  echo ""
  
  if [ "$DRY_RUN" = true ]; then
    echo "  Mode:            DRY-RUN (no changes made)"
  else
    echo "  Commits:         $(git rev-list --count "$TARGET_BRANCH"..HEAD)"
    echo ""
    echo "Next steps:"
    echo "  1. Review changes: git log --oneline $TARGET_BRANCH..HEAD"
    echo "  2. Push umbrella branch: git push origin $UMBRELLA_BRANCH"
    echo "  3. Create PR from umbrella to $TARGET_BRANCH"
  fi
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════

main() {
  parse_args "$@"

  echo "════════════════════════════════════════════════════════════════"
  echo "MERGE-WEAVE: Parameterized PR Merge Script v${SCRIPT_VERSION}"
  echo "════════════════════════════════════════════════════════════════"
  echo ""

  # Convert comma-separated PR list to array
  IFS=',' read -ra PR_NUMBERS <<< "$PR_LIST"
  
  log_info "Configuration:"
  log_verbose "  Repository: $REPO_DIR"
  log_verbose "  Target branch: $TARGET_BRANCH"
  log_verbose "  Umbrella branch: $UMBRELLA_BRANCH"
  log_info "  PRs to merge: ${PR_NUMBERS[*]}"
  if [ "$DRY_RUN" = true ]; then
    log_warning "  Mode: DRY-RUN (no changes will be made)"
  fi
  echo ""

  # Change to repository directory
  cd "$REPO_DIR"
  log_verbose "Working directory: $(pwd)"
  echo ""

  # Check prerequisites
  check_gh_cli

  # Create secure temporary file for PR branch mapping
  local pr_mapping_file
  pr_mapping_file=$(mktemp) || {
    log_error "Failed to create temporary file"
    exit 1
  }

  # Verify all PR branches exist
  verify_pr_branches "$pr_mapping_file" "${PR_NUMBERS[@]}"

  # Create umbrella branch
  create_umbrella_branch

  # Merge PRs
  cat "$pr_mapping_file" | merge_prs

  # Clean up temporary file
  rm -f "$pr_mapping_file"

  # Run validation gates
  run_validation_gates

  # Show summary
  show_summary "${PR_NUMBERS[@]}"

  exit 0
}

# Execute main function with all arguments
main "$@"
