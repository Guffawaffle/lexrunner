---
"@smartergpt/lexrunner": patch
---

Run local gates through PowerShell 7 on Windows instead of accidentally crossing into WSL bash.
Emit bounded, hashed per-attempt execution receipts and fail closed when declared gate artifacts are
missing, stale, unsupported, or cannot be retained with an identical byte identity.
Invoke npm package and release checks through the active Node runtime and npm CLI so they work
without relying on Windows command-shim spawning.
