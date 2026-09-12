# Windows Authenticode file-handle conformance

This isolated development proof asks whether a full-file SHA-256 and a native
Authenticode signature check can refer to the same held file. It does not select
an approved LexRunner publisher, authenticate release metadata, execute the fixture,
or change the production WorkspaceBoundary resolver.

It supports the artifact verification work in
[#894](https://github.com/SmarterGPT/lexrunner/issues/894) and the helper design in
[ADR-011](../../docs/adr/ADR-011-native-host-workspace-boundary.md). PowerShell and
`Add-Type` are test machinery, not a product runtime dependency or an alternative
policy-host architecture.

## Run

Use native Windows PowerShell 7 with an existing, embedded Authenticode-signed PE
fixture between 512 bytes and 32 MiB, and a new receipt path whose parent exists:

```powershell
pwsh -NoLogo -NoProfile -File proofs/windows-authenticode-binding/verify.ps1 `
  -SignedFixture 'C:\Program Files\Git\bin\git.exe' `
  -ReceiptPath "$env:TEMP\authenticode-observation.json"
```

The installed fixture is only read. Mutation happens on three disposable copies;
none is executed. No certificates are generated or imported. The native calls use
cache-only chain retrieval, revocation checks excluding the root, no UI, and disabled
MD2/MD4. A missing cached chain or revocation result remains a failed observation;
the harness does not retry with a weaker policy. The subsequent PowerShell API
comparison uses its own defaults and may perform network retrieval. Existing host
caches are not cleared, so this is not a cold-cache experiment.

The receipt includes the base/current commit, hashes of both proof source files,
host versions, fixture digest, native statuses, duration, and exit code. Source
hashes identify uncommitted probe revisions as well as committed runs. Receipts are
created exclusively; an existing file is never replaced. Exit zero means all twelve
explicit assertions passed, not that a release is trusted. Early setup failures
(such as compilation or an invalid receipt destination) may prevent receipt creation.

## Experiment

`AuthenticodeHandleProbe.cs` passes a held read-only file handle in
[`WINTRUST_FILE_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_file_info),
hashes that stream before and after verification, and extracts the first signer's
certificate digest from the same provider state. The handle excludes concurrent
write/delete sharing while held. Provider state is explicitly closed, including
on failure; only a zero
[`WinVerifyTrust`](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust)
status is treated as signature success.

| Case                                   | Expected observation                    |
| -------------------------------------- | --------------------------------------- |
| Signed path, no explicit handle        | Valid                                   |
| Signed path and signed handle          | Valid, raw digest unchanged             |
| Hashed section byte changed, path only | Bad digest                              |
| Tampered path, signed handle           | Valid: verification follows handle      |
| Signed path, tampered handle           | Bad digest: verification follows handle |
| PE checksum field changed              | Signature valid, raw digest different   |

The last case makes the distinction concrete: an accepted Authenticode signature
does not substitute for the independently approved full artifact digest. Conversely,
an observed digest does not approve a publisher. Provider signer information can
also be returned on a failed signature check and is never interpreted as authority.

The PowerShell path/content comparison is recorded, not asserted. On the first
Windows x64 host, PowerShell 7.6.5 returned `Valid` by path but `NotSigned` for the
same PE byte array. Consumers must not assume those APIs are interchangeable.

## Evidence limits

This is a host-dependent conformance probe, not a hermetic CI gate. Invoke the same
entrypoint explicitly on a qualified Windows test host with a suitable fixture.
It requires a usable cached certificate chain and revocation data; CI must not
manufacture trust or disable revocation to make it pass.

The proof does not qualify ARM64, all Windows releases, catalog signatures,
multi-signature selection, whole-chain namespace custody, reparse/ADS policy,
hard-link exclusion, or launch-time identity. It does not protect the verifier's
own executable/module graph, independently provision an approved signer/manifest,
or prove rollback resistance. The legacy provider inspection APIs are test dependencies
whose availability must be checked on any future production target; see
[`WTHelperGetProvCertFromChain`](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-wthelpergetprovcertfromchain).
Native calls are synchronous; this harness does not claim a wall-clock deadline.

The next implementation must bind an independently approved digest and signer policy
to the actual helper artifact, preserve that identity through launch, and compose
with the existing owned handshake. This proof alone does not make Windows worker
execution available.
