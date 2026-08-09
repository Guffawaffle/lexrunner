# Windows WorkspaceBoundary proof

This proof exercises native Windows directory-handle authority for issue #888. It is intentionally
isolated from the production resolver and cannot advertise a ready backend.

Run `verify.ps1` from native Windows. See
[the security proof](../../docs/security/windows-handle-authority-proof.md) for the claim, hostile
matrix, non-claims, receipts, and production protocol recommendation.
