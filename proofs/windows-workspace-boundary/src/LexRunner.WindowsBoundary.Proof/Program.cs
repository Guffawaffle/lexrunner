namespace LexRunner.WindowsBoundary.Proof;

internal static class Program
{
  public static async Task<int> Main(string[] args)
  {
    if (!OperatingSystem.IsWindows())
    {
      Console.Error.WriteLine("windows-native proof requires Windows");
      return 2;
    }

    try
    {
      if (args is ["broker", "--root", var brokerRoot])
      {
        return await ProofBroker.RunAsync(brokerRoot);
      }

      if (args is ["self-test"])
      {
        return await ProofSuite.RunAsync(null);
      }

      if (args is ["self-test", "--unsupported-root", var unsupportedRoot])
      {
        return await ProofSuite.RunAsync(unsupportedRoot);
      }

      Console.Error.WriteLine(
          "usage: lexrunner-windows-boundary-proof self-test [--unsupported-root PATH]");
      return 2;
    }
    catch (Exception error)
    {
      Console.Error.WriteLine($"proof failed: {error.GetType().Name}: {error.Message}");
      return 1;
    }
  }
}
