using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LexRunner.WindowsBoundary.Proof;

[SupportedOSPlatform("windows")]
internal static class NativeMethods
{
  internal const uint FileAttributeReparsePoint = 0x00000400;
  internal const uint IoReparseTagMountPoint = 0xA0000003;
  internal const uint IoReparseTagSymlink = 0xA000000C;

  private const uint FileListDirectory = 0x00000001;
  private const uint FileReadAttributes = 0x00000080;
  private const uint FileShareRead = 0x00000001;
  private const uint FileShareWrite = 0x00000002;
  private const uint FileShareDelete = 0x00000004;
  private const uint OpenExisting = 3;
  private const uint FileFlagBackupSemantics = 0x02000000;
  private const uint FileFlagOpenReparsePoint = 0x00200000;

  internal static SafeFileHandle OpenDirectory(
      string path,
      bool excludeRenameDelete,
      bool openReparsePoint)
  {
    var share = FileShareRead | FileShareWrite;
    if (!excludeRenameDelete)
    {
      share |= FileShareDelete;
    }

    var flags = FileFlagBackupSemantics;
    if (openReparsePoint)
    {
      flags |= FileFlagOpenReparsePoint;
    }

    var handle = CreateFileW(
        path,
        FileListDirectory | FileReadAttributes,
        share,
        IntPtr.Zero,
        OpenExisting,
        flags,
        IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error, $"Could not open directory handle ({error})");
    }

    return handle;
  }

  internal static FileIdentity ReadIdentity(SafeFileHandle handle)
  {
    if (!GetFileInformationByHandleEx(
            handle,
            FileInfoByHandleClass.FileIdInfo,
            out FileIdInfo info,
            (uint)Marshal.SizeOf<FileIdInfo>()))
    {
      throw LastWin32("Could not read directory file identity");
    }

    return new FileIdentity(
        info.VolumeSerialNumber,
        $"{info.FileId.LowPart:x16}{info.FileId.HighPart:x16}");
  }

  internal static ReparseIdentity ReadReparseIdentity(SafeFileHandle handle)
  {
    if (!GetFileInformationByHandleEx(
            handle,
            FileInfoByHandleClass.FileAttributeTagInfo,
            out FileAttributeTagInfo info,
            (uint)Marshal.SizeOf<FileAttributeTagInfo>()))
    {
      throw LastWin32("Could not read directory reparse identity");
    }

    return new ReparseIdentity(
        (info.FileAttributes & FileAttributeReparsePoint) != 0,
        info.ReparseTag);
  }

  internal static string ReadFinalPath(SafeFileHandle handle)
  {
    var buffer = new StringBuilder(32_768);
    var length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
    if (length == 0)
    {
      throw LastWin32("Could not resolve final directory path");
    }

    if (length >= buffer.Capacity)
    {
      throw new BoundaryProofException("invalid_path", "Final directory path was too long");
    }

    return buffer.ToString();
  }

  internal static string ReadFileSystem(SafeFileHandle handle)
  {
    var volumeName = new StringBuilder(261);
    var fileSystemName = new StringBuilder(261);
    if (!GetVolumeInformationByHandleW(
            handle,
            volumeName,
            (uint)volumeName.Capacity,
            out _,
            out _,
            out _,
            fileSystemName,
            (uint)fileSystemName.Capacity))
    {
      throw LastWin32("Could not identify directory filesystem");
    }

    return fileSystemName.ToString();
  }

  internal static string ReadVolumeAlias(string driveRoot)
  {
    var volumeName = new StringBuilder(261);
    if (!GetVolumeNameForVolumeMountPointW(driveRoot, volumeName, (uint)volumeName.Capacity))
    {
      throw LastWin32("Could not resolve volume alias");
    }

    return volumeName.ToString();
  }

  private static Win32Exception LastWin32(string message)
  {
    var error = Marshal.GetLastWin32Error();
    return new Win32Exception(error, $"{message} ({error})");
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  private static extern SafeFileHandle CreateFileW(
      string lpFileName,
      uint dwDesiredAccess,
      uint dwShareMode,
      IntPtr lpSecurityAttributes,
      uint dwCreationDisposition,
      uint dwFlagsAndAttributes,
      IntPtr hTemplateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandleEx(
      SafeFileHandle hFile,
      FileInfoByHandleClass fileInformationClass,
      out FileIdInfo lpFileInformation,
      uint dwBufferSize);

  [DllImport("kernel32.dll", SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandleEx(
      SafeFileHandle hFile,
      FileInfoByHandleClass fileInformationClass,
      out FileAttributeTagInfo lpFileInformation,
      uint dwBufferSize);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  private static extern uint GetFinalPathNameByHandleW(
      SafeFileHandle hFile,
      StringBuilder lpszFilePath,
      uint cchFilePath,
      uint dwFlags);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetVolumeInformationByHandleW(
      SafeFileHandle hFile,
      StringBuilder lpVolumeNameBuffer,
      uint nVolumeNameSize,
      out uint lpVolumeSerialNumber,
      out uint lpMaximumComponentLength,
      out uint lpFileSystemFlags,
      StringBuilder lpFileSystemNameBuffer,
      uint nFileSystemNameSize);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetVolumeNameForVolumeMountPointW(
      string lpszVolumeMountPoint,
      StringBuilder lpszVolumeName,
      uint cchBufferLength);

  private enum FileInfoByHandleClass
  {
    FileAttributeTagInfo = 9,
    FileIdInfo = 18,
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileId128
  {
    internal ulong LowPart;
    internal ulong HighPart;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileIdInfo
  {
    internal ulong VolumeSerialNumber;
    internal FileId128 FileId;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileAttributeTagInfo
  {
    internal uint FileAttributes;
    internal uint ReparseTag;
  }
}

internal readonly record struct FileIdentity(ulong VolumeSerialNumber, string FileId);

internal readonly record struct ReparseIdentity(bool IsReparsePoint, uint Tag);
