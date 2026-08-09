using System.Text;
using System.Text.Json;

namespace LexRunner.WindowsBoundary.Proof;

internal static class ProtocolJson
{
  internal static string WriteObject(Action<Utf8JsonWriter> write)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream))
    {
      writer.WriteStartObject();
      write(writer);
      writer.WriteEndObject();
    }

    return Encoding.UTF8.GetString(stream.ToArray());
  }

  internal static void WriteLine(Action<Utf8JsonWriter> write)
  {
    Console.WriteLine(WriteObject(write));
    Console.Out.Flush();
  }

  internal static JsonDocument ParseBounded(string line)
  {
    if (Encoding.UTF8.GetByteCount(line) > 4_096)
    {
      throw new BoundaryProofException("request_too_large", "Protocol frame exceeds 4 KiB");
    }

    return JsonDocument.Parse(
        line,
        new JsonDocumentOptions
        {
          AllowTrailingCommas = false,
          CommentHandling = JsonCommentHandling.Disallow,
          MaxDepth = 8,
        });
  }
}
