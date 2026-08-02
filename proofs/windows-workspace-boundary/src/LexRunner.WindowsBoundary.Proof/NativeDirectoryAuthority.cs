using System.ComponentModel;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LexRunner.WindowsBoundary.Proof;

internal sealed record AuthorityOptions(
    bool ExcludeRenameDelete = true,
    bool HoldAncestors = true,
    bool OpenReparsePoint = true,
    bool RejectReparsePoints = true,
    bool ValidateFinalPath = true,
    bool RequireNtfs = true,
    IReadOnlyList<string>? ExpectedIdentityDigests = null);

internal sealed record DirectoryIdentity(
    ulong VolumeSerialNumber,
    string FileId,
    string FinalPath,
    string FileSystem,
    bool IsReparsePoint,
    uint ReparseTag,
    string IdentityDigest);

[SupportedOSPlatform("windows")]
internal sealed class NativeDirectoryAuthority : IDisposable
{
  private readonly List<SafeFileHandle> handles;
  private bool disposed;

  private NativeDirectoryAuthority(
      string requestedPath,
      IReadOnlyList<DirectoryIdentity> identities,
      List<SafeFileHandle> handles)
  {
    RequestedPath = requestedPath;
    Identities = identities;
    this.handles = handles;
  }

  internal string RequestedPath { get; }

  internal IReadOnlyList<DirectoryIdentity> Identities { get; }

  internal DirectoryIdentity RootIdentity => Identities[^1];

  internal static NativeDirectoryAuthority Acquire(
      string absolutePath,
      AuthorityOptions? options = null)
  {
    options ??= new AuthorityOptions();
    var normalized = NormalizeInputPath(absolutePath);
    var prefixes = options.HoldAncestors ? EnumeratePrefixes(normalized) : [normalized];
    if (options.ExpectedIdentityDigests is not null &&
        options.ExpectedIdentityDigests.Count != prefixes.Count)
    {
      throw new BoundaryProofException(
          "identity_changed",
          "Expected identity chain length does not match the requested authority chain");
    }

    var handles = new List<SafeFileHandle>(prefixes.Count);
    var identities = new List<DirectoryIdentity>(prefixes.Count);

    try
    {
      for (var index = 0; index < prefixes.Count; index++)
      {
        var prefix = prefixes[index];
        var handle = NativeMethods.OpenDirectory(
            prefix,
            options.ExcludeRenameDelete,
            options.OpenReparsePoint);
        handles.Add(handle);
        var identity = Capture(handle);

        if (identity.IsReparsePoint && options.RejectReparsePoints)
        {
          throw new BoundaryProofException(
              "reparse_point_rejected",
              $"Directory component has disallowed reparse tag 0x{identity.ReparseTag:x8}");
        }

        if (options.RequireNtfs && !identity.FileSystem.Equals("NTFS", StringComparison.OrdinalIgnoreCase))
        {
          throw new BoundaryProofException(
              "unsupported_filesystem",
              $"Filesystem {identity.FileSystem} is not supported by this proof");
        }

        if (options.ValidateFinalPath && !PathsEqual(prefix, identity.FinalPath))
        {
          throw new BoundaryProofException(
              "identity_changed",
              "Handle final path did not match the requested directory component");
        }

        if (options.ExpectedIdentityDigests is not null &&
            !DigestsEqual(identity.IdentityDigest, options.ExpectedIdentityDigests[index]))
        {
          throw new BoundaryProofException(
              "identity_changed",
              "Handle identity did not match the expected authority chain");
        }

        identities.Add(identity);
      }

      return new NativeDirectoryAuthority(normalized, identities, handles);
    }
    catch
    {
      DisposeHandles(handles);
      throw;
    }
  }

  internal DirectoryIdentity RecaptureRoot()
  {
    ThrowIfDisposed();
    return Capture(handles[^1]);
  }

  internal string RenderRelativePath(params string[] components)
  {
    ThrowIfDisposed();
    if (components.Length == 0)
    {
      return NormalizeFinalPath(RootIdentity.FinalPath);
    }

    var current = NormalizeFinalPath(RootIdentity.FinalPath);
    foreach (var component in components)
    {
      if (string.IsNullOrWhiteSpace(component) ||
          component is "." or ".." ||
          Path.IsPathRooted(component) ||
          component.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
      {
        throw new BoundaryProofException(
            "containment_violation",
            "Process and filesystem paths must be capability-relative components");
      }

      current = Path.Combine(current, component);
    }

    return current;
  }

  internal static string GetFileSystem(string absolutePath)
  {
    using var authority = Acquire(
        absolutePath,
        new AuthorityOptions(
            ExcludeRenameDelete: false,
            HoldAncestors: false,
            RequireNtfs: false));
    return authority.RootIdentity.FileSystem;
  }

  internal static string GetVolumeAlias(string absolutePath)
  {
    var normalized = NormalizeInputPath(absolutePath);
    var root = Path.GetPathRoot(normalized)
        ?? throw new BoundaryProofException("invalid_path", "Path has no drive root");
    return NativeMethods.ReadVolumeAlias(root);
  }

  public void Dispose()
  {
    if (disposed)
    {
      return;
    }

    disposed = true;
    DisposeHandles(handles);
  }

  private static DirectoryIdentity Capture(SafeFileHandle handle)
  {
    var fileIdentity = NativeMethods.ReadIdentity(handle);
    var reparseIdentity = NativeMethods.ReadReparseIdentity(handle);
    var finalPath = NativeMethods.ReadFinalPath(handle);
    var fileSystem = NativeMethods.ReadFileSystem(handle);
    var digestInput = FormattableString.Invariant(
        $"windows-volume-file-id\0{fileIdentity.VolumeSerialNumber:x16}\0{fileIdentity.FileId}\0{NormalizeFinalPath(finalPath)}");
    var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(digestInput)))
        .ToLowerInvariant();

    return new DirectoryIdentity(
        fileIdentity.VolumeSerialNumber,
        fileIdentity.FileId,
        finalPath,
        fileSystem,
        reparseIdentity.IsReparsePoint,
        reparseIdentity.Tag,
        digest);
  }

  private static string NormalizeInputPath(string path)
  {
    if (string.IsNullOrWhiteSpace(path) || path.Contains('\0'))
    {
      throw new BoundaryProofException("invalid_path", "Path is empty or contains NUL");
    }

    if (path.StartsWith(@"\\.\", StringComparison.Ordinal) ||
        path.StartsWith(@"\??\", StringComparison.Ordinal) ||
        path.StartsWith(@"\\?\GLOBALROOT\", StringComparison.OrdinalIgnoreCase))
    {
      throw new BoundaryProofException("invalid_path", "Device namespaces are rejected");
    }

    if (path.StartsWith(@"\\?\Volume{", StringComparison.OrdinalIgnoreCase))
    {
      throw new BoundaryProofException(
          "invalid_path",
          "Volume aliases are ambiguous in the proof protocol");
    }

    if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
    {
      throw new BoundaryProofException(
          "unsupported_filesystem",
          "UNC paths require separate remote-filesystem conformance");
    }

    if (path.StartsWith(@"\\", StringComparison.Ordinal) &&
        !path.StartsWith(@"\\?\", StringComparison.Ordinal))
    {
      throw new BoundaryProofException(
          "unsupported_filesystem",
          "UNC paths require separate remote-filesystem conformance");
    }

    var localPath = path.StartsWith(@"\\?\", StringComparison.Ordinal)
        ? path[4..]
        : path;
    if (!Path.IsPathFullyQualified(localPath))
    {
      throw new BoundaryProofException("invalid_path", "Path must be fully qualified");
    }

    var fullPath = Path.GetFullPath(localPath);
    return Path.TrimEndingDirectorySeparator(fullPath);
  }

  private static List<string> EnumeratePrefixes(string absolutePath)
  {
    var root = Path.GetPathRoot(absolutePath)
        ?? throw new BoundaryProofException("invalid_path", "Path has no drive root");
    var prefixes = new List<string> { root };
    var relative = absolutePath[root.Length..];
    var current = root;
    foreach (var component in relative.Split(
                 [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                 StringSplitOptions.RemoveEmptyEntries))
    {
      current = Path.Combine(current, component);
      prefixes.Add(current);
    }

    return prefixes;
  }

  private static bool PathsEqual(string requested, string finalPath)
  {
    return string.Equals(
        NormalizeFinalPath(requested),
        NormalizeFinalPath(finalPath),
        StringComparison.OrdinalIgnoreCase);
  }

  private static bool DigestsEqual(string actual, string expected)
  {
    if (actual.Length != 64 || expected.Length != 64)
    {
      return false;
    }

    try
    {
      return CryptographicOperations.FixedTimeEquals(
          Convert.FromHexString(actual),
          Convert.FromHexString(expected));
    }
    catch (FormatException)
    {
      return false;
    }
  }

  internal static string NormalizeFinalPath(string path)
  {
    var normalized = path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
        ? @"\\" + path[8..]
        : path.StartsWith(@"\\?\", StringComparison.Ordinal)
            ? path[4..]
            : path;
    return normalized.Length > 3 ? Path.TrimEndingDirectorySeparator(normalized) : normalized;
  }

  private static void DisposeHandles(List<SafeFileHandle> openHandles)
  {
    for (var index = openHandles.Count - 1; index >= 0; index--)
    {
      openHandles[index].Dispose();
    }

    openHandles.Clear();
  }

  private void ThrowIfDisposed()
  {
    ObjectDisposedException.ThrowIf(disposed, this);
  }
}

internal sealed class BoundaryProofException : Exception
{
  internal BoundaryProofException(string code, string message)
      : base(message)
  {
    Code = code;
  }

  internal string Code { get; }
}
