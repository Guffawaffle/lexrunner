param(
    [Parameter(Mandatory)][string]$SignedFixture,
    [Parameter(Mandatory)][string]$ReceiptPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This conformance probe requires native Windows.' }
$started = [DateTimeOffset]::UtcNow
$watch = [Diagnostics.Stopwatch]::StartNew()
$source = (Resolve-Path -LiteralPath $SignedFixture).ProviderPath
$receipt = [IO.Path]::GetFullPath($ReceiptPath)
if (Test-Path -LiteralPath $receipt) { throw 'Receipt already exists; preserve prior observations.' }
$sourceInfo = Get-Item -LiteralPath $source
if ($sourceInfo.Length -lt 512 -or $sourceInfo.Length -gt 32MB) { throw 'Fixture must contain 512 bytes..32 MiB.' }
Add-Type -Path (Join-Path $PSScriptRoot 'AuthenticodeHandleProbe.cs')
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = Join-Path $tempParent ('lexrunner-authenticode-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
$observations = [ordered]@{}
$checks = [ordered]@{}
$report = [ordered]@{
    schemaVersion = '1.0.0'
    purpose = 'non-authorizing WinVerifyTrust file-handle conformance'
    startedAt = $started.ToString('o')
    command = 'pwsh -NoLogo -NoProfile -File proofs/windows-authenticode-binding/verify.ps1 -SignedFixture <source> -ReceiptPath <new-receipt>'
    cwd = (Get-Location).Path
    commit = (git -C $PSScriptRoot rev-parse HEAD)
    probeSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'AuthenticodeHandleProbe.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
    harnessSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sourcePath = $source
    os = [Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    powershell = $PSVersionTable.PSVersion.ToString()
    policy = 'GENERIC_VERIFY_V2; no UI; cache-only URL retrieval; chain revocation excluding root; disable MD2/MD4'
    observations = $observations
    checks = $checks
    outcome = 'failed'
}
try {
    $signed = Join-Path $temp 'signed.exe'
    $tampered = Join-Path $temp 'tampered.exe'
    $checksum = Join-Path $temp 'checksum.exe'
    Copy-Item -LiteralPath $source -Destination $signed
    $bytes = [IO.File]::ReadAllBytes($signed)
    if ($bytes.Length -lt 512 -or $bytes.Length -gt 32MB) { throw 'Copied fixture outside bounds.' }
    # Validate PE offsets before changing a hashed section byte or the excluded checksum.
    if ([BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) { throw 'DOS header missing.' }
    $pe = [long][BitConverter]::ToUInt32($bytes, 0x3c)
    if ($pe -gt $bytes.Length - 24 -or [BitConverter]::ToUInt32($bytes, [int]$pe) -ne 0x4550) { throw 'PE header invalid.' }
    $sections = [BitConverter]::ToUInt16($bytes, [int]$pe + 6)
    $optionalSize = [BitConverter]::ToUInt16($bytes, [int]$pe + 20)
    $optional = $pe + 24
    $table = $optional + $optionalSize
    if ($optionalSize -lt 68 -or $sections -lt 1 -or $table + 40L * $sections -gt $bytes.Length) { throw 'PE section table invalid.' }
    $magic = [BitConverter]::ToUInt16($bytes, [int]$optional)
    if ($magic -notin @(0x10b, 0x20b)) { throw 'Unsupported PE optional header.' }
    $rawSize = [BitConverter]::ToUInt32($bytes, [int]$table + 16)
    $rawOffset = [BitConverter]::ToUInt32($bytes, [int]$table + 20)
    if ($rawSize -eq 0 -or $rawOffset -lt $table + 40L * $sections -or [long]$rawOffset + $rawSize -gt $bytes.Length) { throw 'First PE section invalid.' }
    $altered = [byte[]]$bytes.Clone()
    $altered[$rawOffset] = $altered[$rawOffset] -bxor 1
    [IO.File]::WriteAllBytes($tampered, $altered)
    $altered = [byte[]]$bytes.Clone()
    $altered[$optional + 64] = $altered[$optional + 64] -bxor 1
    [IO.File]::WriteAllBytes($checksum, $altered)
    $report['sourceSha256'] = 'sha256:' + [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    # Native cache-only probes run before PowerShell's path API can populate certificate caches.
    $observations['pathSigned'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($signed, $null)
    $observations['handleSigned'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($signed, $signed)
    $observations['pathTampered'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($tampered, $null)
    $observations['tamperedPathSignedHandle'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($tampered, $signed)
    $observations['signedPathTamperedHandle'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($signed, $tampered)
    $observations['checksumOnly'] = [LexRunner.Proofs.AuthenticodeHandleProbe]::Observe($checksum, $checksum)
    $pathSignature = Get-AuthenticodeSignature -LiteralPath $signed
    $contentSignature = Get-AuthenticodeSignature -Content $bytes -SourcePathOrExtension '.exe'
    $report['powershellComparison'] = @{
        pathStatus = [string]$pathSignature.Status
        pathSignatureType = [string]$pathSignature.SignatureType
        contentStatus = [string]$contentSignature.Status
        contentSignatureType = [string]$contentSignature.SignatureType
    }
    $checks['signedPathValid'] = $observations.pathSigned.Status -eq '0x00000000'
    $checks['signedHandleValid'] = $observations.handleSigned.Status -eq '0x00000000'
    $checks['tamperedPathBadDigest'] = $observations.pathTampered.Status -eq '0x80096010'
    $checks['signedHandleOverridesTamperedPath'] = $observations.tamperedPathSignedHandle.Status -eq '0x00000000'
    $checks['tamperedHandleOverridesSignedPath'] = $observations.signedPathTamperedHandle.Status -eq '0x80096010'
    $checks['checksumExcludedFromSignature'] = $observations.checksumOnly.Status -eq '0x00000000'
    $checks['checksumChangesRawDigest'] = $observations.checksumOnly.Sha256Before -ne $observations.handleSigned.Sha256Before
    $checks['signerExtracted'] = $null -ne $observations.handleSigned.SignerCertificateSha256
    $checks['signerBoundToProvider'] = $observations.handleSigned.SignerCertificateSha256 -eq $observations.tamperedPathSignedHandle.SignerCertificateSha256
    $checks['sameHeldDigest'] = $observations.handleSigned.Sha256Before -eq $observations.tamperedPathSignedHandle.Sha256Before
    $checks['allProviderStatesClosed'] = @($observations.Values | Where-Object CloseStatus -ne '0x00000000').Count -eq 0
    $checks['heldBytesUnchanged'] = @($observations.Values | Where-Object { $_.HandleSupplied -and $_.Sha256Before -ne $_.Sha256After }).Count -eq 0
    if (@($checks.Values | Where-Object { -not $_ }).Count -eq 0) { $report.outcome = 'passed' }
}
catch {
    $report['error'] = $_.Exception.Message.Substring(0, [Math]::Min(1000, $_.Exception.Message.Length))
}
finally {
    $watch.Stop()
    $report['durationSeconds'] = $watch.Elapsed.TotalSeconds
    $resolvedTemp = [IO.Path]::GetFullPath($temp)
    if ([IO.Path]::GetDirectoryName($resolvedTemp).TrimEnd('\') -ne $tempParent.TrimEnd('\') -or
        [IO.Path]::GetFileName($resolvedTemp) -notmatch '^lexrunner-authenticode-[a-f0-9]{32}$') { throw 'Unexpected cleanup path.' }
    try { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
    catch {
        $report.outcome = 'failed'
        $report['cleanupError'] = 'Temporary fixture cleanup failed; inspect ' + $resolvedTemp
    }
    $report['exitCode'] = $(if ($report.outcome -eq 'passed') { 0 } else { 1 })
    $json = $report | ConvertTo-Json -Depth 8
    # CreateNew prevents overwriting an existing receipt even if it appeared during the probe.
    $output = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $encoded = [Text.UTF8Encoding]::new($false).GetBytes($json + "`n")
        $output.Write($encoded, 0, $encoded.Length)
    } finally { $output.Dispose() }
    Write-Output $json
}
exit $report.exitCode
