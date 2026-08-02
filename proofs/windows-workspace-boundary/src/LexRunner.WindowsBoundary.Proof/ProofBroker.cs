using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LexRunner.WindowsBoundary.Proof;

[SupportedOSPlatform("windows")]
internal static class ProofBroker
{
  internal static async Task<int> RunAsync(string rootPath)
  {
    using var authority = NativeDirectoryAuthority.Acquire(rootPath);
    var sessionId = Guid.NewGuid().ToString("N");
    var capability = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    ProtocolJson.WriteLine(writer =>
    {
      writer.WriteString("protocol_version", "proof-1.0.0");
      writer.WriteString("event", "ready");
      writer.WriteString("session_id", sessionId);
      writer.WriteString("capability", capability);
      writer.WriteString("identity_digest", authority.RootIdentity.IdentityDigest);
    });

    while (true)
    {
      string? line;
      try
      {
        line = await ReadBoundedLineAsync(Console.In);
      }
      catch (BoundaryProofException error)
      {
        WriteResult(sessionId, "unknown", "rejected", error.Code);
        continue;
      }

      if (line is null)
      {
        break;
      }

      try
      {
        using var request = ProtocolJson.ParseBounded(line);
        var root = request.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
          throw new BoundaryProofException("invalid_request", "Request must be an object");
        }

        var operation = RequireString(root, "operation");
        var suppliedCapability = RequireString(root, "capability");
        var allowedFields = operation == "hold"
            ? new HashSet<string>(["operation", "capability", "milliseconds"], StringComparer.Ordinal)
            : new HashSet<string>(["operation", "capability"], StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
          if (!allowedFields.Contains(property.Name))
          {
            throw new BoundaryProofException("invalid_request", "Unknown protocol field");
          }
        }

        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(capability),
                ParseCapability(suppliedCapability)))
        {
          WriteResult(sessionId, operation, "rejected", "lease_stale");
          continue;
        }

        if (operation == "assert")
        {
          _ = authority.RecaptureRoot();
          WriteResult(sessionId, operation, "completed", null);
          continue;
        }

        if (operation == "hold")
        {
          var milliseconds = RequireInt32(root, "milliseconds");
          if (milliseconds is < 1 or > 60_000)
          {
            throw new BoundaryProofException("invalid_request", "Hold duration is out of range");
          }

          ProtocolJson.WriteLine(writer =>
          {
            writer.WriteString("protocol_version", "proof-1.0.0");
            writer.WriteString("session_id", sessionId);
            writer.WriteString("operation", operation);
            writer.WriteString("outcome", "started");
            writer.WriteString("effect_state", "no_effect");
          });
          await Task.Delay(milliseconds);
          WriteResult(sessionId, operation, "completed", null);
          continue;
        }

        throw new BoundaryProofException("invalid_request", "Unknown operation");
      }
      catch (Exception error) when (error is BoundaryProofException or JsonException or FormatException)
      {
        var code = error is BoundaryProofException proofError ? proofError.Code : "invalid_request";
        WriteResult(sessionId, "unknown", "rejected", code);
      }
    }

    return 0;
  }

  private static async Task<string?> ReadBoundedLineAsync(TextReader reader)
  {
    const int maxCharacters = 4096;
    var line = new StringBuilder(maxCharacters);
    var buffer = new char[1];
    var sawAny = false;
    var overflowed = false;

    while (await reader.ReadAsync(buffer.AsMemory()) != 0)
    {
      sawAny = true;
      var value = buffer[0];
      if (value == '\n')
      {
        break;
      }

      if (value == '\r')
      {
        continue;
      }

      if (line.Length < maxCharacters)
      {
        line.Append(value);
      }
      else
      {
        overflowed = true;
      }
    }

    if (!sawAny)
    {
      return null;
    }

    if (overflowed)
    {
      throw new BoundaryProofException("request_too_large", "Protocol request exceeded the size limit");
    }

    return line.ToString();
  }

  private static byte[] ParseCapability(string capability)
  {
    if (capability.Length != 64)
    {
      return new byte[32];
    }

    try
    {
      return Convert.FromHexString(capability);
    }
    catch (FormatException)
    {
      return new byte[32];
    }
  }

  private static string RequireString(JsonElement root, string name)
  {
    if (!root.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String)
    {
      throw new BoundaryProofException("invalid_request", $"Missing string field {name}");
    }

    return property.GetString()!;
  }

  private static int RequireInt32(JsonElement root, string name)
  {
    if (!root.TryGetProperty(name, out var property) ||
        property.ValueKind != JsonValueKind.Number ||
        !property.TryGetInt32(out var value))
    {
      throw new BoundaryProofException("invalid_request", $"Missing integer field {name}");
    }

    return value;
  }

  private static void WriteResult(string sessionId, string operation, string outcome, string? code)
  {
    ProtocolJson.WriteLine(writer =>
    {
      writer.WriteString("protocol_version", "proof-1.0.0");
      writer.WriteString("session_id", sessionId);
      writer.WriteString("operation", operation);
      writer.WriteString("outcome", outcome);
      writer.WriteString("effect_state", "no_effect");
      if (code is not null)
      {
        writer.WriteString("code", code);
      }
    });
  }
}
