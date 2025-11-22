# Aliasing for LexRunner: Failure Modes and Troubleshooting

This guide documents common failure modes when using module ID aliasing in LexRunner and provides clear troubleshooting guidance.

## Overview

LexRunner's aliasing system allows you to use shorthand names (aliases) for module IDs during `/remember` commands. The system resolves these aliases to canonical module IDs defined in `lexmap.policy.json`.

**Resolution Order:**
1. **Exact match** (confidence 1.0) - Module ID exists exactly in policy
2. **Alias table** (confidence 1.0) - Alias maps to canonical ID in `aliases.json`
3. **Fuzzy typo correction** (suggestions only) - Similar module IDs suggested
4. **Unique substring match** (confidence 0.9) - Single module contains the substring

---

## Common Failure Modes

### 1. Ambiguous Substring Error

**What Happened:**
You provided a substring that matches multiple module IDs in the policy. The system cannot automatically choose which one you meant.

**Error Message:**
```
Ambiguous substring 'user' matches:
  - services/user-access-api
  - services/user-profile-service
  - ui/user-admin-panel
  - ui/user-settings
  ... and 2 more
Please use full module ID or add to alias table.
```

**Why This Happens:**
- You used a short substring like `user` that appears in multiple module IDs
- Substring matching is enabled (default behavior)
- The system found more than one match

**How to Fix:**

**Option 1: Use a more specific substring**
```bash
# Instead of:
lex remember --modules user

# Use:
lex remember --modules user-access
# or
lex remember --modules user-admin
```

**Option 2: Use the full canonical module ID**
```bash
lex remember --modules services/user-access-api
```

**Option 3: Add an alias to the alias table**

Edit `src/shared/aliases/aliases.json`:
```json
{
  "aliases": {
    "user-access": {
      "canonical": "services/user-access-api",
      "confidence": 1.0,
      "reason": "commonly used shorthand"
    }
  }
}
```

Then rebuild:
```bash
npm run build
```

**Option 4: Disable substring matching (for CI/strict environments)**
```bash
lex remember --modules user --no-substring
# This will fail fast instead of attempting substring matching
```

---

### 2. Typo Correction Warnings

**What Happened:**
You made a typo in a module ID, and the system suggested similar module names.

**Error Message:**
```
Module 'servcies/auth-core' not found in policy. Did you mean 'services/auth-core'?
```

**Why This Happens:**
- You misspelled a module ID (e.g., `servcies` instead of `services`)
- The module doesn't exist in the policy
- The system used fuzzy matching to find similar names

**How to Fix:**

**Option 1: Use the suggested correction**
```bash
# Instead of:
lex remember --modules servcies/auth-core

# Use the suggestion:
lex remember --modules services/auth-core
```

**Option 2: Check the policy file for exact module IDs**
```bash
# List all available module IDs
cat .smartergpt.local/lex/lexmap.policy.json | jq '.modules | keys'
```

**Option 3: Add an alias for commonly mistyped names**

If you consistently make the same typo, add an alias:
```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "common shorthand to avoid typos"
    }
  }
}
```

---

### 3. Missing Module ID Error

**What Happened:**
The module ID you provided doesn't exist in the policy, and no similar matches were found.

**Error Message:**
```
Module 'payment-gateway' not found in policy.
```

**Why This Happens:**
- The module ID is completely unknown
- No fuzzy matches are close enough to suggest
- The module might not be registered in the policy yet

**How to Fix:**

**Option 1: Check if the module exists in the policy**
```bash
# Search for the module in the policy
cat .smartergpt.local/lex/lexmap.policy.json | jq '.modules | keys | .[]' | grep -i payment
```

**Option 2: Add the module to the policy file**

If the module should exist, add it to `lexmap.policy.json`:
```json
{
  "modules": {
    "services/payment-gateway": {
      "description": "Payment processing gateway",
      "owns_paths": ["services/payments/**"]
    }
  }
}
```

**Option 3: Use the correct module ID**

If the module exists under a different name:
```bash
# Check what modules are available
lex check --list-modules

# Use the correct name
lex remember --modules services/payment-processor
```

**Option 4: Create an alias once the correct module ID is found**
```json
{
  "aliases": {
    "payment-gateway": {
      "canonical": "services/payment-processor",
      "confidence": 1.0,
      "reason": "alternative name for payment service"
    }
  }
}
```

---

### 4. Alias Resolves to Invalid Module

**What Happened:**
An alias in the alias table points to a module ID that doesn't exist in the policy.

**Error Message:**
```
Module 'old-auth' resolved to 'legacy/auth-service' which is not found in policy. Did you mean 'services/auth-core'?
```

**Why This Happens:**
- The alias table contains an outdated entry
- A module was renamed in the policy but not updated in aliases
- The canonical module ID in the alias is incorrect

**How to Fix:**

**Option 1: Update the alias to point to the correct module**

Edit `src/shared/aliases/aliases.json`:
```json
{
  "aliases": {
    "old-auth": {
      "canonical": "services/auth-core",  // Updated
      "confidence": 1.0,
      "reason": "refactored from legacy/auth-service to services/auth-core"
    }
  }
}
```

**Option 2: Remove the obsolete alias**

If the alias is no longer needed, remove it from the alias table.

**Option 3: Add the missing module to the policy**

If the canonical module ID is correct, add it to the policy file.

---

## Debugging Tips

### Enable Substring Matching (Default)

Substring matching allows you to use partial module IDs:
```bash
# This works if only one module contains "auth-core"
lex remember --modules auth-core
```

### Disable Substring Matching (Strict Mode)

For CI pipelines or when you want exact matches only:
```bash
# Only exact matches and explicit aliases will work
lex remember --modules auth-core --no-substring
```

This is useful when:
- Running in CI/CD pipelines
- You want to catch configuration errors early
- You prefer explicit aliases over fuzzy matching

### Check Module ID Resolution

To see how a module ID would be resolved without committing:
```bash
# Use debug mode (if available)
LEX_DEBUG=1 lex remember --modules auth-core --dry-run
```

### List Available Modules

To see all canonical module IDs in the policy:
```bash
# Using jq
cat .smartergpt.local/lex/lexmap.policy.json | jq '.modules | keys | .[]'

# Or using the lex CLI (if available)
lex check --list-modules
```

### View Current Aliases

Check what aliases are currently defined:
```bash
cat src/shared/aliases/aliases.json | jq '.aliases'
```

### Test Alias Resolution

Before adding an alias, test if a substring already works:
```bash
# Try with substring matching enabled
lex remember --modules auth-core --dry-run
```

---

## Best Practices

### 1. Use Aliases for Frequently Used Shorthand

Create aliases for module IDs you use often:
```json
{
  "aliases": {
    "auth": "services/auth-core",
    "user-api": "services/user-access-api",
    "admin-ui": "ui/user-admin-panel"
  }
}
```

### 2. Document Refactorings with Aliases

When renaming modules, keep old names as aliases:
```json
{
  "aliases": {
    "legacy/auth-service": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "refactored 2025-10-15"
    }
  }
}
```

### 3. Use Descriptive Reasons

Always include a `reason` field to explain why an alias exists:
```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "common shorthand to reduce typing"
    }
  }
}
```

### 4. Keep Aliases in Sync with Policy

Regularly audit your alias table to ensure all canonical IDs still exist:
```bash
# Check for broken aliases (pseudo-code)
node scripts/validate-aliases.js
```

### 5. Use `--no-substring` in CI

In automated environments, disable fuzzy matching to catch configuration errors:
```bash
lex remember --modules auth-core --no-substring
```

---

## Examples: Fixing Real-World Scenarios

### Scenario 1: Multiple Matches for "user"

**Problem:**
```bash
lex remember --modules user
# Error: Ambiguous substring 'user' matches:
#   - services/user-access-api
#   - services/user-profile-service
#   - ui/user-admin-panel
```

**Solution:**
```bash
# Be more specific
lex remember --modules user-access
# or add an alias
```

### Scenario 2: Typo in Module Name

**Problem:**
```bash
lex remember --modules servcies/auth-core
# Error: Module 'servcies/auth-core' not found in policy. Did you mean 'services/auth-core'?
```

**Solution:**
```bash
# Use the correct spelling
lex remember --modules services/auth-core
```

### Scenario 3: Module Doesn't Exist

**Problem:**
```bash
lex remember --modules payment-gateway
# Error: Module 'payment-gateway' not found in policy.
```

**Solution:**
```bash
# Check what's available
cat .smartergpt.local/lex/lexmap.policy.json | jq '.modules | keys | .[]' | grep -i payment
# Found: services/payment-processor

# Use the correct name
lex remember --modules services/payment-processor

# Or add an alias
```

### Scenario 4: Old Alias After Refactoring

**Problem:**
```bash
lex remember --modules old-auth
# Error: Module 'old-auth' resolved to 'legacy/auth-service' which is not found in policy.
```

**Solution:**
Edit `aliases.json`:
```json
{
  "aliases": {
    "old-auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "updated after refactoring legacy/auth-service -> services/auth-core"
    }
  }
}
```

Then rebuild:
```bash
npm run build
lex remember --modules old-auth  # Now works
```

---

## Configuration Reference

### Alias Table Schema

Location: `src/shared/aliases/aliases.json`

```json
{
  "aliases": {
    "<alias-name>": {
      "canonical": "<canonical-module-id>",
      "confidence": 1.0,
      "reason": "<explanation>"
    }
  }
}
```

**Fields:**
- `alias-name` - The shorthand or alternative name
- `canonical` - The exact module ID from `lexmap.policy.json`
- `confidence` - Always `1.0` for explicit aliases
- `reason` - Human-readable explanation (optional but recommended)

### CLI Options

```bash
lex remember --modules <modules> [options]

Options:
  --no-substring    Disable substring matching (strict mode, for CI)
  --strict          Disable auto-correction for typos (for CI)
  --json            Output results in JSON format
```

---

## Getting Help

If you're still having issues:

1. **Check the FAQ**: See [docs/FAQ.md](./FAQ.md) for common questions
2. **Review the policy file**: Ensure module IDs are correctly defined
3. **Check the alias table**: Verify aliases point to valid modules
4. **Enable debug mode**: Set `LEX_DEBUG=1` for verbose output
5. **Open an issue**: Report problems on GitHub with:
   - The exact command you ran
   - The error message you received
   - Your Node.js version (`node --version`)
   - Steps to reproduce

---

## Related Documentation

- [Aliases README](../src/shared/aliases/README.md) - Technical implementation details
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) - General troubleshooting guide
- [Module ID Validation](../src/shared/module_ids/README.md) - Validation rules
- [Policy File Structure](./OVERVIEW.md) - Understanding `lexmap.policy.json`

---

**Last Updated:** 2025-11-09  
**Status:** ✅ Complete and ready for use
