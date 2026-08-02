using System.Diagnostics;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LexRunner.WindowsBoundary.Proof;

[SupportedOSPlatform("windows")]
internal static class ProofSuite
{
  private const string Canary = "outside-authority-canary";

  internal static async Task<int> RunAsync(string? unsupportedRoot)
  {
    var fixtureRoot = Path.Combine(
        Path.GetTempPath(),
        $"lexrunner-boundary-proof-{Guid.NewGuid():N}");
    Directory.CreateDirectory(fixtureRoot);
    var results = new List<ProofCaseResult>();
    string? ntfsIdentityDigest = null;
    var cleanup = "indeterminate";

    try
    {
      results.Add(RunCase("ntfs-handle-identity-and-aliases", "protection", () =>
      {
        var root = NewDirectory(fixtureRoot, "identity-root");
        Directory.CreateDirectory(Path.Combine(root, "child"));
        using var authority = NativeDirectoryAuthority.Acquire(root);
        using var caseAlias = NativeDirectoryAuthority.Acquire(root.ToUpperInvariant());
        using var dotDotAlias = NativeDirectoryAuthority.Acquire(
            Path.Combine(root, "child", ".."));
        using var extendedAlias = NativeDirectoryAuthority.Acquire(@"\\?\" + root);

        var identities = new[]
        {
          authority.RootIdentity,
          caseAlias.RootIdentity,
          dotDotAlias.RootIdentity,
          extendedAlias.RootIdentity,
        };
        if (identities.Any(identity =>
                identity.VolumeSerialNumber != authority.RootIdentity.VolumeSerialNumber ||
                identity.FileId != authority.RootIdentity.FileId ||
                identity.IdentityDigest != authority.RootIdentity.IdentityDigest))
        {
          throw new InvalidOperationException("Path aliases did not converge on one file identity");
        }

        var driveRoot = Path.GetPathRoot(root)
            ?? throw new InvalidOperationException("Proof fixture did not have a drive root");
        var uncAlias = $@"\\localhost\{driveRoot[0]}$\{root[driveRoot.Length..]}";
        ExpectBoundaryCode(
            "unsupported_filesystem",
            () => NativeDirectoryAuthority.Acquire(uncAlias).Dispose());
        var volumeAlias = NativeDirectoryAuthority.GetVolumeAlias(root);
        ExpectBoundaryCode(
            "invalid_path",
            () => NativeDirectoryAuthority.Acquire(volumeAlias).Dispose());
        ExpectBoundaryCode(
            "invalid_path",
            () => NativeDirectoryAuthority.Acquire($@"\\.\{driveRoot}").Dispose());

        ntfsIdentityDigest = authority.RootIdentity.IdentityDigest;
        return "case, dot-dot, and extended aliases converged; UNC, volume, and device namespaces failed closed";
      }));

      results.Add(RunCase("pre-acquire-directory-replacement-is-rejected", "protection", () =>
      {
        var root = NewDirectory(fixtureRoot, "pre-acquire-root");
        var original = root + "-original";
        IReadOnlyList<string> expectedIdentityDigests;
        using (var snapshot = NativeDirectoryAuthority.Acquire(root))
        {
          expectedIdentityDigests = snapshot.Identities
              .Select(identity => identity.IdentityDigest)
              .ToArray();
        }

        Directory.Move(root, original);
        Directory.CreateDirectory(root);
        ExpectBoundaryCode(
            "identity_changed",
            () => NativeDirectoryAuthority.Acquire(
                root,
                new AuthorityOptions(ExpectedIdentityDigests: expectedIdentityDigests)).Dispose());
        Directory.Delete(root);
        Directory.Move(original, root);
        return "a regular directory substituted after snapshot was rejected by expected handle identity";
      }));

      if (unsupportedRoot is not null)
      {
        results.Add(RunCase("unsupported-filesystem-fails-before-mutation", "protection", () =>
        {
          var fileSystem = NativeDirectoryAuthority.GetFileSystem(unsupportedRoot);
          if (fileSystem.Equals("NTFS", StringComparison.OrdinalIgnoreCase))
          {
            throw new InvalidOperationException(
                "The supplied negative-control root is NTFS; an actual unsupported filesystem is required");
          }

          ExpectBoundaryCode(
              "unsupported_filesystem",
              () => NativeDirectoryAuthority.Acquire(unsupportedRoot).Dispose());
          return $"{fileSystem} was observed from a handle and rejected before mutation";
        }));
      }

      results.Add(RunCase("repository-and-worktree-roots-held-together", "protection", () =>
      {
        var caseRoot = NewDirectory(fixtureRoot, "repository-worktree-roots");
        var repository = NewDirectory(caseRoot, "repository");
        var worktree = Path.Combine(caseRoot, "worktree");
        InitializeGitRepository(repository);
        RunGit("-C", repository, "worktree", "add", "--detach", worktree, "HEAD");

        using var repositoryAuthority = NativeDirectoryAuthority.Acquire(repository);
        using var worktreeAuthority = NativeDirectoryAuthority.Acquire(worktree);
        if (repositoryAuthority.RootIdentity.FileId == worktreeAuthority.RootIdentity.FileId)
        {
          throw new InvalidOperationException("Repository and worktree resolved to one directory identity");
        }

        ExpectSharingViolation(() => Directory.Move(repository, repository + "-moved"));
        ExpectSharingViolation(() => Directory.Move(worktree, worktree + "-moved"));
        return "a real Git repository and linked worktree retained distinct held identities for one lease interval";
      }));

      results.Add(RunCase("held-root-blocks-rename-and-delete", "protection", () =>
      {
        var root = NewDirectory(fixtureRoot, "held-root");
        var moved = root + "-moved";
        using (NativeDirectoryAuthority.Acquire(root))
        {
          ExpectSharingViolation(() => Directory.Move(root, moved));
          ExpectSharingViolation(() => Directory.Delete(root));
        }

        Directory.Move(root, moved);
        Directory.Move(moved, root);
        return "rename and delete were denied for the lease and succeeded after handle release";
      }));

      results.Add(RunCase("share-delete-negative-control-redirects-path", "negative_control", () =>
      {
        var root = NewDirectory(fixtureRoot, "unprotected-root");
        var moved = root + "-original";
        using var authority = NativeDirectoryAuthority.Acquire(
                  root,
                  new AuthorityOptions(ExcludeRenameDelete: false));
        var originalIdentity = authority.RootIdentity;

        Directory.Move(root, moved);
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "canary.txt"), Canary);
        var recaptured = authority.RecaptureRoot();
        if (recaptured.FileId != originalIdentity.FileId ||
                  !File.ReadAllText(Path.Combine(root, "canary.txt")).Equals(Canary, StringComparison.Ordinal))
        {
          throw new InvalidOperationException("Share-delete negative control did not expose redirection");
        }

        authority.Dispose();
        Directory.Delete(root, recursive: true);
        Directory.Move(moved, root);
        return "allowing FILE_SHARE_DELETE let the caller path name a replacement while the handle retained the original identity";
      }));

      results.Add(RunCase("reparse-before-acquire-is-rejected", "protection", () =>
      {
        var outside = NewDirectory(fixtureRoot, "reparse-outside");
        var link = Path.Combine(fixtureRoot, "reparse-link");
        CreateJunction(link, outside);
        try
        {
          ExpectBoundaryCode(
              "reparse_point_rejected",
              () => NativeDirectoryAuthority.Acquire(link).Dispose());
        }
        finally
        {
          Directory.Delete(link);
        }

        return "a pre-existing junction was identified from its handle tag and rejected";
      }));

      results.Add(RunCase("no-follow-negative-control-grants-outside-root", "negative_control", () =>
      {
        var outsideOriginal = NewDirectory(fixtureRoot, "follow-outside-original");
        var outsideReplacement = NewDirectory(fixtureRoot, "follow-outside-replacement");
        RunGit("init", outsideOriginal);
        RunGit("init", outsideReplacement);
        File.WriteAllText(Path.Combine(outsideOriginal, "canary.txt"), "original");
        File.WriteAllText(Path.Combine(outsideReplacement, "canary.txt"), Canary);
        var link = Path.Combine(fixtureRoot, "follow-link");
        CreateJunction(link, outsideOriginal);
        try
        {
          using var authority = NativeDirectoryAuthority.Acquire(
              link,
              new AuthorityOptions(
                  ExcludeRenameDelete: false,
                  OpenReparsePoint: false,
                  RejectReparsePoints: false,
                  ValidateFinalPath: false));
          if (!PathsIdentifySameDirectory(authority.RootIdentity.FinalPath, outsideOriginal))
          {
            throw new InvalidOperationException("No-follow negative control did not follow the junction");
          }

          Directory.Delete(link);
          CreateJunction(link, outsideReplacement);
          if (File.ReadAllText(Path.Combine(link, "canary.txt")) != Canary)
          {
            throw new InvalidOperationException("Live junction swap did not reach the replacement canary");
          }

          var gitTop = RunGit("-C", link, "rev-parse", "--show-toplevel").Trim();
          if (!PathsIdentifySameDirectory(gitTop, outsideReplacement))
          {
            throw new InvalidOperationException("Git escape did not reach the outside repository");
          }
        }
        finally
        {
          Directory.Delete(link);
        }

        return "removing open-reparse and final-path checks allowed a live junction-target swap to redirect direct and Git operations";
      }));

      results.Add(RunCase("held-ancestor-chain-blocks-component-swap", "protection", () =>
      {
        var ancestor = NewDirectory(fixtureRoot, "held-ancestor");
        var root = NewDirectory(ancestor, "repository");
        var moved = ancestor + "-moved";
        using (NativeDirectoryAuthority.Acquire(root))
        {
          ExpectSharingViolation(() => Directory.Move(ancestor, moved));
        }

        Directory.Move(ancestor, moved);
        Directory.Move(moved, ancestor);
        return "an ancestor component could not be renamed until the complete handle chain was released";
      }));

      results.Add(RunCase("released-ancestor-negative-control-allows-swap", "negative_control", () =>
      {
        var ancestor = NewDirectory(fixtureRoot, "released-ancestor");
        var root = NewDirectory(ancestor, "repository");
        var moved = ancestor + "-original";
        string evidenceDigest;
        using (var authority = NativeDirectoryAuthority.Acquire(root))
        {
          evidenceDigest = authority.RootIdentity.IdentityDigest;
        }

        Directory.Move(ancestor, moved);
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "canary.txt"), Canary);
        if (evidenceDigest.Length != 64 || File.ReadAllText(Path.Combine(root, "canary.txt")) != Canary)
        {
          throw new InvalidOperationException("Ancestor negative control did not expose substitution");
        }

        Directory.Delete(ancestor, recursive: true);
        Directory.Move(moved, ancestor);
        return "after the ancestor handles were released, persisted identity evidence could not prevent path substitution";
      }));

      results.Add(RunCase("capability-relative-file-and-git-probes", "protection", () =>
      {
        var root = NewDirectory(fixtureRoot, "bounded-probes");
        RunGit("init", root);
        File.WriteAllText(Path.Combine(root, "inside.txt"), "inside");
        using var authority = NativeDirectoryAuthority.Acquire(root);
        var inside = authority.RenderRelativePath("inside.txt");
        if (File.ReadAllText(inside) != "inside")
        {
          throw new InvalidOperationException("Bounded read did not reach the granted file");
        }

        ExpectBoundaryCode(
            "containment_violation",
            () => authority.RenderRelativePath("..", "outside.txt"));
        ExpectBoundaryCode(
            "containment_violation",
            () => authority.RenderRelativePath(Path.Combine(fixtureRoot, "outside.txt")));
        var gitState = RunGit(
            "-C",
            NativeDirectoryAuthority.NormalizeFinalPath(authority.RootIdentity.FinalPath),
            "rev-parse",
            "--is-inside-work-tree").Trim();
        if (gitState != "true")
        {
          throw new InvalidOperationException("Bounded Git probe did not run in the granted root");
        }

        return "capability-rendered paths allowed in-root file and Git probes and rejected rooted or parent traversal";
      }));

      results.Add(await RunCaseAsync("broker-crash-cleans-handles-and-rejects-replay", "protection", async () =>
      {
        var root = NewDirectory(fixtureRoot, "broker-root");
        var moved = root + "-moved";
        var first = await StartBrokerAsync(root);
        try
        {
          var assert = await SendBrokerRequestAsync(
              first,
              $"{{\"operation\":\"assert\",\"capability\":\"{first.Capability}\"}}");
          RequireOutcome(assert, "completed");
          var started = await SendBrokerRequestAsync(
              first,
              $"{{\"operation\":\"hold\",\"capability\":\"{first.Capability}\",\"milliseconds\":30000}}");
          RequireOutcome(started, "started");
        }
        finally
        {
          KillBroker(first);
        }

        Directory.Move(root, moved);
        Directory.Move(moved, root);

        var second = await StartBrokerAsync(root);
        try
        {
          var unknownField = await SendBrokerRequestAsync(
              second,
              $"{{\"operation\":\"assert\",\"capability\":\"{second.Capability}\",\"extra\":true}}");
          RequireOutcome(unknownField, "rejected", "invalid_request");
          var missingField = await SendBrokerRequestAsync(
              second,
              $"{{\"operation\":\"hold\",\"capability\":\"{second.Capability}\"}}");
          RequireOutcome(missingField, "rejected", "invalid_request");
          var oversized = await SendBrokerRequestAsync(
              second,
              $"{{\"operation\":\"assert\",\"capability\":\"{new string('a', 4_096)}\"}}");
          RequireOutcome(oversized, "rejected", "request_too_large");
          var stale = await SendBrokerRequestAsync(
              second,
              $"{{\"operation\":\"assert\",\"capability\":\"{first.Capability}\"}}");
          RequireOutcome(stale, "rejected", "lease_stale");
          var current = await SendBrokerRequestAsync(
              second,
              $"{{\"operation\":\"assert\",\"capability\":\"{second.Capability}\"}}");
          RequireOutcome(current, "completed");
          if (first.Capability == second.Capability)
          {
            throw new InvalidOperationException("Broker sessions reused capability material");
          }
        }
        finally
        {
          KillBroker(second);
        }

        return "killing a broker mid-operation released handles; a fresh session rejected malformed frames and the old capability";
      }));

      cleanup = "completed";
    }
    finally
    {
      try
      {
        if (Directory.Exists(fixtureRoot))
        {
          DeleteFixtureTree(fixtureRoot);
        }
      }
      catch
      {
        cleanup = "failed";
      }
    }

    var passed = results.All(result => result.Passed) && cleanup == "completed";
    var unsupportedFileSystemObserved = results.Any(result =>
        result.Name == "unsupported-filesystem-fails-before-mutation" && result.Passed);
    WriteReceipt(results, passed, cleanup, ntfsIdentityDigest, unsupportedFileSystemObserved);
    return passed ? 0 : 1;
  }

  private static ProofCaseResult RunCase(string name, string control, Func<string> body)
  {
    var stopwatch = Stopwatch.StartNew();
    try
    {
      var detail = body();
      return new ProofCaseResult(name, control, true, detail, stopwatch.ElapsedMilliseconds);
    }
    catch (Exception error)
    {
      return new ProofCaseResult(
          name,
          control,
          false,
          SanitizeDetail($"{error.GetType().Name}: {error.Message}"),
          stopwatch.ElapsedMilliseconds);
    }
  }

  private static async Task<ProofCaseResult> RunCaseAsync(
      string name,
      string control,
      Func<Task<string>> body)
  {
    var stopwatch = Stopwatch.StartNew();
    try
    {
      var detail = await body();
      return new ProofCaseResult(name, control, true, detail, stopwatch.ElapsedMilliseconds);
    }
    catch (Exception error)
    {
      return new ProofCaseResult(
          name,
          control,
          false,
          SanitizeDetail($"{error.GetType().Name}: {error.Message}"),
          stopwatch.ElapsedMilliseconds);
    }
  }

  private static string NewDirectory(string parent, string name)
  {
    var path = Path.Combine(parent, name);
    Directory.CreateDirectory(path);
    return path;
  }

  private static void DeleteFixtureTree(string directory)
  {
    foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
    {
      var attributes = File.GetAttributes(entry);
      if ((attributes & FileAttributes.ReparsePoint) != 0)
      {
        File.SetAttributes(entry, FileAttributes.Normal);
        if ((attributes & FileAttributes.Directory) != 0)
        {
          Directory.Delete(entry);
        }
        else
        {
          File.Delete(entry);
        }

        continue;
      }

      if ((attributes & FileAttributes.Directory) != 0)
      {
        DeleteFixtureTree(entry);
      }
      else
      {
        File.SetAttributes(entry, FileAttributes.Normal);
        File.Delete(entry);
      }
    }

    File.SetAttributes(directory, FileAttributes.Normal);
    Directory.Delete(directory);
  }

  private static void ExpectBoundaryCode(string code, Action action)
  {
    try
    {
      action();
    }
    catch (BoundaryProofException error) when (error.Code == code)
    {
      return;
    }

    throw new InvalidOperationException($"Expected boundary error {code}");
  }

  private static void ExpectSharingViolation(Action action)
  {
    try
    {
      action();
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      return;
    }

    throw new InvalidOperationException("Expected a sharing violation");
  }

  private static void CreateJunction(string link, string target)
  {
    var result = RunProcess("cmd.exe", "/d", "/c", "mklink", "/J", link, target);
    if (!Directory.Exists(link))
    {
      throw new InvalidOperationException($"Junction creation failed: {result.Trim()}");
    }
  }

  private static string RunGit(params string[] args)
  {
    return RunProcess("git.exe", args);
  }

  private static string RunProcess(string executable, params string[] args)
  {
    var startInfo = new ProcessStartInfo(executable)
    {
      UseShellExecute = false,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      CreateNoWindow = true,
    };
    foreach (var argument in args)
    {
      startInfo.ArgumentList.Add(argument);
    }

    using var process = Process.Start(startInfo)
        ?? throw new InvalidOperationException($"Could not start {executable}");
    var stdoutTask = process.StandardOutput.ReadToEndAsync();
    var stderrTask = process.StandardError.ReadToEndAsync();
    if (!process.WaitForExit(15_000))
    {
      process.Kill(entireProcessTree: true);
      process.WaitForExit(10_000);
      Task.WhenAll(stdoutTask, stderrTask).GetAwaiter().GetResult();
      throw new InvalidOperationException($"{executable} timed out");
    }

    Task.WhenAll(stdoutTask, stderrTask).GetAwaiter().GetResult();
    var stdout = stdoutTask.Result;
    var stderr = stderrTask.Result;
    if (process.ExitCode != 0)
    {
      throw new InvalidOperationException(
          $"{executable} failed with exit {process.ExitCode}: {stderr.Trim()}");
    }

    return stdout;
  }

  private static void InitializeGitRepository(string repository)
  {
    RunGit("init", repository);
    RunGit("-C", repository, "config", "user.name", "LexRunner Boundary Proof");
    RunGit("-C", repository, "config", "user.email", "boundary-proof@invalid.example");
    RunGit("-C", repository, "config", "commit.gpgsign", "false");
    File.WriteAllText(Path.Combine(repository, "tracked.txt"), "tracked");
    RunGit("-C", repository, "add", "tracked.txt");
    RunGit("-C", repository, "commit", "-m", "Create proof fixture");
  }

  private static bool PathsIdentifySameDirectory(string left, string right)
  {
    return string.Equals(
        Path.GetFullPath(NativeDirectoryAuthority.NormalizeFinalPath(left)),
        Path.GetFullPath(NativeDirectoryAuthority.NormalizeFinalPath(right)),
        StringComparison.OrdinalIgnoreCase);
  }

  private static async Task<BrokerSession> StartBrokerAsync(string root)
  {
    var executable = Environment.ProcessPath
        ?? throw new InvalidOperationException("Could not identify the current proof executable");
    var startInfo = new ProcessStartInfo(executable)
    {
      UseShellExecute = false,
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      CreateNoWindow = true,
    };
    startInfo.ArgumentList.Add("broker");
    startInfo.ArgumentList.Add("--root");
    startInfo.ArgumentList.Add(root);
    var process = Process.Start(startInfo)
        ?? throw new InvalidOperationException("Could not start proof broker");
    try
    {
      var readyLine = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10))
          ?? throw new InvalidOperationException(
              $"Broker exited before readiness: {await process.StandardError.ReadToEndAsync()}");
      using var ready = ProtocolJson.ParseBounded(readyLine);
      if (ready.RootElement.GetProperty("event").GetString() != "ready")
      {
        throw new InvalidOperationException("Broker did not emit readiness");
      }

      return new BrokerSession(
          process,
          ready.RootElement.GetProperty("capability").GetString()!);
    }
    catch
    {
      if (!process.HasExited)
      {
        process.Kill(entireProcessTree: true);
        await process.WaitForExitAsync();
      }

      process.Dispose();
      throw;
    }
  }

  private static async Task<JsonDocument> SendBrokerRequestAsync(BrokerSession session, string request)
  {
    await session.Process.StandardInput.WriteLineAsync(request);
    await session.Process.StandardInput.FlushAsync();
    var response = await session.Process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10))
        ?? throw new InvalidOperationException("Broker closed without a response");
    return ProtocolJson.ParseBounded(response);
  }

  private static void RequireOutcome(JsonDocument response, string outcome, string? code = null)
  {
    using (response)
    {
      var root = response.RootElement;
      if (root.GetProperty("outcome").GetString() != outcome)
      {
        throw new InvalidOperationException($"Expected broker outcome {outcome}");
      }

      if (code is not null && root.GetProperty("code").GetString() != code)
      {
        throw new InvalidOperationException($"Expected broker code {code}");
      }
    }
  }

  private static void KillBroker(BrokerSession session)
  {
    try
    {
      if (!session.Process.HasExited)
      {
        session.Process.Kill(entireProcessTree: true);
        session.Process.WaitForExit(10_000);
      }
    }
    finally
    {
      session.Process.Dispose();
    }
  }

  private static void WriteReceipt(
      IReadOnlyList<ProofCaseResult> results,
      bool passed,
      string cleanup,
      string? identityDigest,
      bool unsupportedFileSystemObserved)
  {
    var observedAt = DateTimeOffset.UtcNow.ToString("O");
    var claimsConfirmed = passed;
    var body = ProtocolJson.WriteObject(writer =>
    {
      writer.WriteString("schema_version", "1.0.0");
      writer.WriteString("receipt_kind", "windows-handle-authority-proof");
      writer.WriteString("backend_kind", "windows-native-proof");
      writer.WriteString("outcome", passed ? "completed" : "rejected");
      writer.WriteString("effect_state", "no_effect");
      writer.WriteString("cleanup", cleanup);
      writer.WriteString("observed_at", observedAt);
      writer.WriteString("filesystem", "NTFS");
      writer.WriteString("architecture", System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant());
      writer.WriteBoolean("unsupported_filesystem_observed", unsupportedFileSystemObserved);
      if (identityDigest is not null)
      {
        writer.WriteString("root_identity_digest", identityDigest);
      }

      writer.WriteStartObject("claims");
      writer.WriteBoolean("held_directory_identity", claimsConfirmed);
      writer.WriteBoolean("no_follow_open", claimsConfirmed);
      writer.WriteBoolean("final_path_from_handle", claimsConfirmed);
      writer.WriteBoolean("held_ancestor_chain", claimsConfirmed);
      writer.WriteBoolean("replacement_resistant_process_binding", claimsConfirmed);
      writer.WriteBoolean("rename_delete_exclusion", claimsConfirmed);
      writer.WriteBoolean("durable_directory_mutation", false);
      writer.WriteEndObject();
      writer.WriteStartArray("cases");
      foreach (var result in results)
      {
        writer.WriteStartObject();
        writer.WriteString("name", result.Name);
        writer.WriteString("control", result.Control);
        writer.WriteBoolean("passed", result.Passed);
        writer.WriteString("detail", result.Detail);
        writer.WriteNumber("duration_ms", result.DurationMs);
        writer.WriteEndObject();
      }

      writer.WriteEndArray();
    });
    var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)))
        .ToLowerInvariant();
    using var bodyDocument = JsonDocument.Parse(body);
    ProtocolJson.WriteLine(writer =>
    {
      foreach (var property in bodyDocument.RootElement.EnumerateObject())
      {
        property.WriteTo(writer);
      }

      writer.WriteString("receipt_digest", digest);
    });
  }

  private static string SanitizeDetail(string detail)
  {
    var sanitized = detail.Replace(
        Path.TrimEndingDirectorySeparator(Path.GetTempPath()),
        "<temp>",
        StringComparison.OrdinalIgnoreCase);
    return sanitized.Replace(Environment.UserName, "<user>", StringComparison.OrdinalIgnoreCase);
  }

  private sealed record ProofCaseResult(
      string Name,
      string Control,
      bool Passed,
      string Detail,
      long DurationMs);

  private sealed record BrokerSession(Process Process, string Capability);
}
