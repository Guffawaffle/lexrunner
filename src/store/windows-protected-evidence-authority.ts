import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

interface PendingRequest {
  resolve: (value: boolean) => void;
  reject: (error: Error) => void;
}

interface HelperResponse {
  id?: unknown;
  ok?: unknown;
  attested?: unknown;
}

const HELPER_SOURCE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class LexRunnerDirectoryDurability {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(
    string name, uint access, uint share, IntPtr security, uint creation,
    uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool FlushFileBuffers(SafeFileHandle handle);
}
'@

function Test-OperatorOnlyDirectory([string] $Target) {
  $full = [IO.Path]::GetFullPath($Target)
  $item = Get-Item -LiteralPath $full -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    return $false
  }
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $security = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)
  if (-not $security.AreAccessRulesProtected -or $security.GetOwner([Security.Principal.SecurityIdentifier]) -ne $current) {
    return $false
  }
  $rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1) { return $false }
  $rule = $rules[0]
  $expectedInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  return (
    $rule.IdentityReference -eq $current -and
    $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    [int64]$rule.FileSystemRights -eq [int64][Security.AccessControl.FileSystemRights]::FullControl -and
    $rule.InheritanceFlags -eq $expectedInheritance -and
    $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None -and
    -not $rule.IsInherited
  )
}

function Set-OperatorOnlyDirectory([string] $Target) {
  $full = [IO.Path]::GetFullPath($Target)
  [IO.Directory]::CreateDirectory($full) | Out-Null
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($current)
  $security.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $current,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $security.AddAccessRule($rule)
  (Get-Item -LiteralPath $full -Force).SetAccessControl($security)
}

function Sync-Directory([string] $Target) {
  $full = [IO.Path]::GetFullPath($Target)
  $handle = [LexRunnerDirectoryDurability]::CreateFile(
    $full, 0x40000000, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
  if ($handle.IsInvalid) {
    throw "CreateFile failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  try {
    if (-not [LexRunnerDirectoryDurability]::FlushFileBuffers($handle)) {
      throw "FlushFileBuffers failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  } finally {
    $handle.Dispose()
  }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $id = $null
  try {
    $message = $line | ConvertFrom-Json
    $id = [int]$message.id
    $target = [string]$message.path
    switch ([string]$message.op) {
      'attest' {
        $attested = Test-OperatorOnlyDirectory $target
        [Console]::Out.WriteLine((@{id=$id;ok=$true;attested=$attested} | ConvertTo-Json -Compress))
      }
      'provision' {
        Set-OperatorOnlyDirectory $target
        $attested = Test-OperatorOnlyDirectory $target
        [Console]::Out.WriteLine((@{id=$id;ok=$attested;attested=$attested} | ConvertTo-Json -Compress))
      }
      'sync' {
        Sync-Directory $target
        [Console]::Out.WriteLine((@{id=$id;ok=$true} | ConvertTo-Json -Compress))
      }
      default { throw 'Unsupported protected-evidence helper operation' }
    }
  } catch {
    [Console]::Out.WriteLine((@{id=$id;ok=$false} | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
`;

/** Default operator-only root selected by the Stage 1 contract. */
export function defaultWindowsProtectedEvidenceRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.win32.isAbsolute(localAppData)) {
    throw new Error("LOCALAPPDATA is unavailable for protected evidence");
  }
  return path.win32.join(localAppData, "LexRunner", "protected-evidence", "stage1-v1");
}

/**
 * Resident operator-side authority for ACL attestation and directory metadata
 * durability. It has no operation that reads captured evidence.
 */
export class WindowsProtectedEvidenceAuthority {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdout = "";
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  async attestRoot(root: string): Promise<boolean> {
    return this.request("attest", requireAbsoluteWindowsPath(root));
  }

  async syncDirectory(directory: string): Promise<void> {
    const synced = await this.request("sync", requireAbsoluteWindowsPath(directory));
    if (!synced) throw new Error("Protected evidence directory durability failed");
  }

  async provisionDefaultRoot(root = defaultWindowsProtectedEvidenceRoot()): Promise<string> {
    const expected = path.win32.resolve(defaultWindowsProtectedEvidenceRoot());
    const target = path.win32.resolve(requireAbsoluteWindowsPath(root));
    if (target.toLowerCase() !== expected.toLowerCase()) {
      throw new Error("Only the exact default protected-evidence root may be provisioned");
    }
    const provisioned = await this.request("provision", target);
    if (!provisioned) throw new Error("Protected evidence root provisioning failed");
    return target;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = null;
    child?.stdin.end();
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve();
        }, 5_000);
        child.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.rejectPending(new Error("Protected evidence authority closed"));
  }

  private request(operation: "attest" | "provision" | "sync", target: string): Promise<boolean> {
    if (this.closed) return Promise.reject(new Error("Protected evidence authority is closed"));
    const child = this.ensureChild();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<boolean>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, op: operation, path: target })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(new Error("Protected evidence authority request failed"));
      });
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    if (process.platform !== "win32") {
      throw new Error("Windows protected evidence authority requires native Windows");
    }
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const encoded = Buffer.from(HELPER_SOURCE, "utf16le").toString("base64");
    const child = spawn(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: sanitizedPowerShellEnvironment(),
      }
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (value: string) => this.acceptOutput(value));
    let stderrBytes = 0;
    child.stderr.on("data", (value: Buffer | string) => {
      stderrBytes += Buffer.byteLength(value);
      if (stderrBytes > 64 * 1_024) child.kill();
    });
    child.once("error", () => {
      this.rejectPending(new Error("Protected evidence authority failed"));
    });
    child.once("close", () => {
      if (this.child === child) this.child = null;
      this.rejectPending(new Error("Protected evidence authority exited"));
    });
    this.child = child;
    return child;
  }

  private acceptOutput(value: string): void {
    this.stdout += value;
    if (Buffer.byteLength(this.stdout, "utf8") > 64 * 1_024) {
      this.child?.kill();
      return;
    }
    let newline = this.stdout.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (line.length > 0) this.acceptResponse(line);
      newline = this.stdout.indexOf("\n");
    }
  }

  private acceptResponse(line: string): void {
    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch {
      this.child?.kill();
      return;
    }
    if (!Number.isSafeInteger(response.id)) {
      this.child?.kill();
      return;
    }
    const pending = this.pending.get(response.id as number);
    if (!pending) {
      this.child?.kill();
      return;
    }
    this.pending.delete(response.id as number);
    if (response.ok !== true) {
      pending.reject(new Error("Protected evidence authority rejected the request"));
      return;
    }
    pending.resolve(response.attested === undefined ? true : response.attested === true);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function requireAbsoluteWindowsPath(candidate: string): string {
  if (!path.win32.isAbsolute(candidate) || candidate.includes("\0")) {
    throw new Error("Protected evidence path must be an absolute Windows path");
  }
  return path.win32.resolve(candidate);
}

function sanitizedPowerShellEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "PATH",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}
