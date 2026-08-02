[CmdletBinding()]
param(
    [string]$UnsupportedRoot
)

$ErrorActionPreference = "Stop"
$proofRoot = $PSScriptRoot
$project = Join-Path $proofRoot "src\LexRunner.WindowsBoundary.Proof\LexRunner.WindowsBoundary.Proof.csproj"
$artifacts = Join-Path $proofRoot "artifacts"
$publish = Join-Path $artifacts "publish\win-x64"
$receiptPath = Join-Path $artifacts "proof-receipt.json"
$signingReceiptPath = Join-Path $artifacts "signing-receipt.json"
$signedCopy = Join-Path $artifacts "signed\lexrunner-windows-boundary-proof.exe"
$tamperedCopy = Join-Path $artifacts "signed\lexrunner-windows-boundary-proof.tampered.exe"
$password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$certificate = $null
$rsa = $null
$pfxPath = Join-Path $artifacts "ephemeral-signing.pfx"

New-Item -ItemType Directory -Force -Path $artifacts, $publish, (Split-Path $signedCopy) | Out-Null

try {
    dotnet build $project -c Release
    if ($LASTEXITCODE -ne 0) { throw "Managed proof build failed" }

    dotnet publish $project -c Release -r win-x64 --self-contained true -o $publish
    if ($LASTEXITCODE -ne 0) { throw "NativeAOT publish failed" }

    $executable = Join-Path $publish "lexrunner-windows-boundary-proof.exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "NativeAOT publish did not produce the proof executable"
    }

    $arguments = @("self-test")
    if ($UnsupportedRoot) {
        $arguments += @("--unsupported-root", $UnsupportedRoot)
    }
    $receipt = & $executable @arguments
    if ($LASTEXITCODE -ne 0) { throw "Published hostile proof failed" }
    $parsedReceipt = $receipt | ConvertFrom-Json
    if ($parsedReceipt.outcome -ne "completed" -or $parsedReceipt.cleanup -ne "completed") {
        throw "Published hostile proof did not emit a completed cleanup receipt"
    }
    Set-Content -LiteralPath $receiptPath -Value $receipt -Encoding utf8NoBOM

    Copy-Item -LiteralPath $executable -Destination $signedCopy -Force
    $rsa = [Security.Cryptography.RSA]::Create(2048)
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        "CN=LexRunner Windows Boundary Ephemeral Proof",
        $rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $oids = [Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.3"))
    $request.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    $request.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $certificate = $request.CreateSelfSigned((Get-Date).AddMinutes(-1), (Get-Date).AddHours(1))
    [IO.File]::WriteAllBytes(
        $pfxPath,
        $certificate.Export(
            [Security.Cryptography.X509Certificates.X509ContentType]::Pfx,
            $password))

    $windowsKitsBin = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $signTool = Get-ChildItem -LiteralPath $windowsKitsBin `
        -Recurse -Filter signtool.exe -ErrorAction Stop |
        Where-Object FullName -Match "\\x64\\signtool\.exe$" |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $signTool) { throw "Windows SDK signtool.exe was not found" }

    & $signTool sign /fd SHA256 /f $pfxPath /p $password $signedCopy
    if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed" }

    $signature = Get-AuthenticodeSignature -LiteralPath $signedCopy
    if ($signature.SignatureType -ne "Authenticode" -or -not $signature.SignerCertificate) {
        throw "Signed artifact does not contain an Authenticode signer"
    }
    if ($signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
        throw "Signed artifact does not contain the ephemeral proof signer"
    }
    if ($signature.Status -in @("NotSigned", "HashMismatch")) {
        throw "Signed artifact reported invalid signature status $($signature.Status)"
    }

    Copy-Item -LiteralPath $signedCopy -Destination $tamperedCopy -Force
    $tamperedBytes = [IO.File]::ReadAllBytes($tamperedCopy)
    $tamperedBytes[512] = $tamperedBytes[512] -bxor 1
    [IO.File]::WriteAllBytes($tamperedCopy, $tamperedBytes)
    $tamperedSignature = Get-AuthenticodeSignature -LiteralPath $tamperedCopy
    if ($tamperedSignature.Status -ne "HashMismatch") {
        throw "Tampered artifact did not produce an Authenticode hash mismatch"
    }

    $signingReceipt = [ordered]@{
        schema_version = "1.0.0"
        receipt_kind = "windows-boundary-signing-proof"
        outcome = "completed"
        artifact_sha256 = (Get-FileHash -LiteralPath $signedCopy -Algorithm SHA256).Hash.ToLowerInvariant()
        signer = "ephemeral-self-signed-test-certificate"
        trust_evaluated = $false
        tamper_control = "hash_mismatch"
        production_signer_required = $true
        observed_at = [DateTimeOffset]::UtcNow.ToString("O")
        receipt_digest_scope = "compact-json-without-receipt-digest"
    }
    $signingBody = $signingReceipt | ConvertTo-Json -Compress
    $signingDigest = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($signingBody))
    ).ToLowerInvariant()
    $signingJson = $signingBody.Insert(
        $signingBody.Length - 1,
        ",`"receipt_digest`":`"$signingDigest`"")
    [IO.File]::WriteAllText(
        $signingReceiptPath,
        $signingJson,
        [Text.UTF8Encoding]::new($false))

    $writtenSigningJson = [IO.File]::ReadAllText($signingReceiptPath)
    $digestProperty = ',"receipt_digest":"'
    $digestOffset = $writtenSigningJson.LastIndexOf($digestProperty, [StringComparison]::Ordinal)
    if ($digestOffset -lt 0) { throw "Signing receipt digest field was not written" }
    $writtenSigningBody = $writtenSigningJson.Substring(0, $digestOffset) + "}"
    $writtenSigningDigest = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($writtenSigningBody))
    ).ToLowerInvariant()
    if ($writtenSigningDigest -ne $signingDigest) {
        throw "Signing receipt digest does not bind the written compact body"
    }
} finally {
    if ($certificate) { $certificate.Dispose() }
    if ($rsa) { $rsa.Dispose() }
    Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
}

Write-Output $receiptPath
Write-Output $signingReceiptPath
