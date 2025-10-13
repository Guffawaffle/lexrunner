#!/bin/bash
# Example lint gate in bash using sidecar pattern directly
#
# Usage: ./lint-gate.sh

GATE_NAME="lint"
SIDECAR_FILE="${LEX_AUDIT_DROP_DIR}/${GATE_NAME}.$$.ndjson"

# Emit an audit event
emit_event() {
	local event="$1"
	local payload="$2"
	local level="${3:-info}"
	
	# Only emit if audit is enabled
	if [[ -z "$LEX_AUDIT_DROP_DIR" || -z "$LEX_AUDIT_SESSION_ID" ]]; then
		return 0
	fi
	
	local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	echo "{\"event\":\"$event\",\"ts\":\"$ts\",\"level\":\"$level\",\"gate\":\"$GATE_NAME\",\"payload\":$payload}" >> "$SIDECAR_FILE"
}

# Start linting
emit_event "lint_start" '{"tool":"npm run lint"}'

# Run lint command
if npm run lint 2>&1; then
	# Success
	emit_event "lint_complete" '{"violations":0}'
	echo "Linting passed"
	exit 0
else
	# Failed - try to parse violations count
	violations_count=1
	
	emit_event "lint_violations" "{\"count\":$violations_count}" "warn"
	echo "Linting failed with violations"
	exit 1
fi
