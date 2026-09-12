using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace LexRunner.Proofs
{
    // Development conformance probe only: neither publisher approval nor a launcher.
    public static class AuthenticodeHandleProbe
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct FileInfo
        {
            public uint Size;
            public IntPtr Path, Handle, Subject;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TrustData
        {
            public uint Size;
            public IntPtr PolicyCallback, SipClient;
            public uint UiChoice, RevocationChecks, UnionChoice;
            public IntPtr File;
            public uint StateAction;
            public IntPtr State, Url;
            public uint Flags, UiContext;
            public IntPtr SignatureSettings;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProviderCertificatePrefix
        {
            public uint Size;
            public IntPtr Certificate;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct CertificatePrefix
        {
            public uint Encoding;
            public IntPtr Bytes;
            public uint Length;
        }

        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("wintrust.dll", ExactSpelling = true)]
        private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);

        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("wintrust.dll", ExactSpelling = true)]
        private static extern IntPtr WTHelperProvDataFromStateData(IntPtr state);

        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("wintrust.dll", ExactSpelling = true)]
        private static extern IntPtr WTHelperGetProvSignerFromChain(
            IntPtr data, uint signer, [MarshalAs(UnmanagedType.Bool)] bool counterSigner, uint counterIndex);

        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("wintrust.dll", ExactSpelling = true)]
        private static extern IntPtr WTHelperGetProvCertFromChain(IntPtr signer, uint certificate);

        public sealed class Observation
        {
            public string Status { get; set; }
            public string CloseStatus { get; set; }
            public string Sha256Before { get; set; }
            public string Sha256After { get; set; }
            public string SignerCertificateSha256 { get; set; }
            public long? Length { get; set; }
            public bool HandleSupplied { get; set; }
        }

        private static string Hash(Stream stream)
        {
            stream.Position = 0;
            string hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            stream.Position = 0;
            return "sha256:" + hash;
        }

        private static string SignerHash(IntPtr state)
        {
            if (state == IntPtr.Zero) return null;
            IntPtr provider = WTHelperProvDataFromStateData(state);
            if (provider == IntPtr.Zero) return null;
            IntPtr signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
            if (signer == IntPtr.Zero) return null;
            IntPtr certificate = WTHelperGetProvCertFromChain(signer, 0);
            if (certificate == IntPtr.Zero) return null;
            var entry = Marshal.PtrToStructure<ProviderCertificatePrefix>(certificate);
            if (entry.Certificate == IntPtr.Zero) return null;
            var context = Marshal.PtrToStructure<CertificatePrefix>(entry.Certificate);
            if (context.Bytes == IntPtr.Zero || context.Length == 0 || context.Length > 65536)
                throw new InvalidDataException("Invalid provider certificate length.");
            byte[] bytes = new byte[(int)context.Length];
            Marshal.Copy(context.Bytes, bytes, 0, bytes.Length);
            return "sha256:" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        }

        public static Observation Observe(string suppliedPath, string heldPath)
        {
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
            // PowerShell marshals a null string argument as an empty string.
            if (heldPath == "") heldPath = null;
            if (!Path.IsPathFullyQualified(suppliedPath)) throw new ArgumentException("Absolute path required.");
            if (heldPath != null && !Path.IsPathFullyQualified(heldPath))
                throw new ArgumentException("Absolute handle path required.");
            using FileStream held = heldPath == null ? null :
                new FileStream(heldPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (held != null && (held.Length == 0 || held.Length > 32 * 1024 * 1024))
                throw new InvalidDataException("Fixture must contain 1..32 MiB.");
            var result = new Observation { HandleSupplied = held != null, Length = held?.Length };
            IntPtr path = IntPtr.Zero, file = IntPtr.Zero;
            bool handleReference = false;
            Guid action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            var data = new TrustData();
            try
            {
                if (held != null)
                {
                    held.SafeFileHandle.DangerousAddRef(ref handleReference);
                    result.Sha256Before = Hash(held);
                }
                path = Marshal.StringToCoTaskMemUni(suppliedPath);
                var info = new FileInfo {
                    Size = (uint)Marshal.SizeOf<FileInfo>(), Path = path,
                    Handle = held == null ? IntPtr.Zero : held.SafeFileHandle.DangerousGetHandle()
                };
                file = Marshal.AllocHGlobal(Marshal.SizeOf<FileInfo>());
                Marshal.StructureToPtr(info, file, false);
                data = new TrustData {
                    Size = (uint)Marshal.SizeOf<TrustData>(), UiChoice = 2,
                    UnionChoice = 1, File = file, StateAction = 1,
                    // Cache-only retrieval; check chain revocation excluding root; reject MD2/MD4.
                    Flags = 0x1000 | 0x80 | 0x2000
                };
                int status = WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                result.Status = "0x" + unchecked((uint)status).ToString("X8");
                result.SignerCertificateSha256 = SignerHash(data.State);
                if (held != null) result.Sha256After = Hash(held);
            }
            finally
            {
                try
                {
                    if (data.State != IntPtr.Zero)
                    {
                        data.StateAction = 2;
                        result.CloseStatus = "0x" + unchecked((uint)WinVerifyTrust(
                            new IntPtr(-1), ref action, ref data)).ToString("X8");
                    }
                }
                finally
                {
                    if (file != IntPtr.Zero) Marshal.FreeHGlobal(file);
                    if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
                    if (handleReference) held.SafeFileHandle.DangerousRelease();
                }
            }
            return result;
        }
    }
}
