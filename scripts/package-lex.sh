#!/usr/bin/env bash
# Package Lex Management Script
# 
# Purpose: Check for Lex updates, validate versions, and assist with updates
# Usage:
#   ./scripts/package-lex.sh check        # Check for available updates
#   ./scripts/package-lex.sh validate     # Validate current installation
#   ./scripts/package-lex.sh update 4.0.3 # Update to an explicitly selected version
#   ./scripts/package-lex.sh info         # Show current Lex version info

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Package details
PACKAGE_NAME="@smartergpt/lex"

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Get current installed version
get_current_version() {
    if [ -f "package.json" ]; then
        # Extract version from package.json
        local version=$(node -p "require('./package.json').dependencies['${PACKAGE_NAME}']" 2>/dev/null || echo "")
        echo "${version}"
    else
        echo ""
    fi
}

# Get actually installed version (from node_modules)
get_installed_version() {
    local pkg_path="node_modules/@smartergpt/lex/package.json"
    if [ -f "$pkg_path" ]; then
        local version=$(node -p "require('./${pkg_path}').version" 2>/dev/null || echo "")
        echo "${version}"
    else
        echo ""
    fi
}

# Get latest version from npm registry
get_latest_version() {
    npm view "${PACKAGE_NAME}" version 2>/dev/null || echo ""
}

# Get all available versions
get_available_versions() {
    npm view "${PACKAGE_NAME}" versions --json 2>/dev/null || echo "[]"
}

# Validate installation
validate_installation() {
    log_info "Validating Lex installation..."
    
    local pkg_version=$(get_current_version)
    local installed_version=$(get_installed_version)
    
    if [ -z "$pkg_version" ]; then
        log_error "Lex not found in package.json dependencies"
        return 1
    fi
    
    log_success "Lex declared in package.json: ${pkg_version}"
    
    if [ -z "$installed_version" ]; then
        log_warning "Lex not installed in node_modules. Run 'npm install'"
        return 1
    fi
    
    log_success "Lex installed in node_modules: ${installed_version}"
    
    # Check if package-lock.json exists
    if [ ! -f "package-lock.json" ]; then
        log_warning "package-lock.json not found. Run 'npm install' to generate it"
        return 1
    fi
    
    log_success "package-lock.json exists"
    
    # Verify exports are accessible
    log_info "Checking Lex exports..."
    
    local exports=("errors" "types" "policy" "atlas" "aliases" "logger")
    local pkg_path="node_modules/@smartergpt/lex/package.json"
    
    if [ ! -f "$pkg_path" ]; then
        log_error "Lex package.json not found"
        return 1
    fi
    
    # Check exports are defined in package.json
    for export in "${exports[@]}"; do
        if node -p "
            const pkg = require('./${pkg_path}');
            const hasExport = pkg.exports && (pkg.exports['./${export}'] || pkg.exports['./' + '${export}']);
            hasExport ? '1' : '0';
        " | grep -q "1"; then
            log_success "  ${PACKAGE_NAME}/${export} — defined in exports"
        else
            log_error "  ${PACKAGE_NAME}/${export} — not defined in exports"
            return 1
        fi
    done
    
    log_success "All Lex exports validated"
    return 0
}

# Check for updates
check_updates() {
    log_info "Checking for Lex updates..."
    
    local current_version=$(get_current_version)
    local installed_version=$(get_installed_version)
    local latest_version=$(get_latest_version)
    
    if [ -z "$latest_version" ]; then
        log_error "Failed to fetch latest version from npm registry"
        return 1
    fi
    
    echo ""
    echo "Current version (package.json): ${current_version}"
    echo "Installed version (node_modules): ${installed_version}"
    echo "Latest version (npm registry):   ${latest_version}"
    echo ""
    
    # Check if update is available
    if [ "$installed_version" = "$latest_version" ]; then
        log_success "You are using the latest version of Lex"
    else
        log_warning "A newer version of Lex is available: ${latest_version}"
        echo ""
        echo "To update:"
        echo "  npm install --save-exact ${PACKAGE_NAME}@${latest_version}"
        echo ""
    fi
    
    # Show recent versions
    log_info "Recent versions:"
    npm view "${PACKAGE_NAME}" versions --json | node -e "
        const versions = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
        versions.slice(-5).forEach(v => console.log('  - ' + v));
    "
}

# Show package info
show_info() {
    log_info "Lex Package Information"
    echo ""
    
    local current_version=$(get_current_version)
    local installed_version=$(get_installed_version)
    
    echo "Package Name:       ${PACKAGE_NAME}"
    echo "Declared Version:   ${current_version}"
    echo "Installed Version:  ${installed_version}"
    echo ""
    
    log_info "Package Details from npm:"
    npm view "${PACKAGE_NAME}" description license repository.url homepage
    echo ""
    
    log_info "Available Exports:"
    local pkg_path="node_modules/@smartergpt/lex/package.json"
    if [ -f "$pkg_path" ]; then
        node -p "
            const pkg = require('./${pkg_path}');
            const exports = Object.keys(pkg.exports || {});
            exports.map(e => '  - ' + (e === '.' ? '@smartergpt/lex' : '@smartergpt/lex/' + e)).join('\\n');
        "
    fi
}

# Update to an explicitly selected exact version
update_lex() {
    local requested_version="${1:-}"
    if [ -z "$requested_version" ]; then
        log_error "Exact Lex version is required (for example: $0 update 4.0.3)"
        return 1
    fi

    log_info "Updating Lex to exact version ${requested_version}..."
    
    local current_version=$(get_current_version)
    echo "Current version: ${current_version}"
    
    log_info "Running: npm install --save-exact ${PACKAGE_NAME}@${requested_version}"
    npm install --save-exact "${PACKAGE_NAME}@${requested_version}"
    
    local new_version=$(get_installed_version)
    
    if [ "$current_version" = "$new_version" ]; then
        log_success "Already at exact selected version: ${new_version}"
    else
        log_success "Updated Lex from ${current_version} to ${new_version}"
        echo ""
        log_warning "Don't forget to:"
        echo "  1. Run tests: npm test"
        echo "  2. Commit changes: git add package.json package-lock.json"
        echo "  3. Create PR with update"
    fi
}

# Main command dispatch
main() {
    local command="${1:-help}"
    
    case "$command" in
        check)
            check_updates
            ;;
        validate)
            validate_installation
            ;;
        update)
            update_lex "${2:-}"
            ;;
        info)
            show_info
            ;;
        help|--help|-h)
            echo "Package Lex Management Script"
            echo ""
            echo "Usage: $0 <command>"
            echo ""
            echo "Commands:"
            echo "  check      Check for available Lex updates"
            echo "  validate   Validate current Lex installation"
            echo "  update     Update Lex to an explicitly selected exact version"
            echo "  info       Show Lex package information"
            echo "  help       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 check      # Check if newer version available"
            echo "  $0 validate   # Verify installation is correct"
            echo "  $0 update 4.0.3 # Update to exact selected version"
            echo ""
            ;;
        *)
            log_error "Unknown command: $command"
            echo "Run '$0 help' for usage information"
            exit 1
            ;;
    esac
}

main "$@"
