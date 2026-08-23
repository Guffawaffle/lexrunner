const args = process.argv.slice(2);
const descriptorIndex = args.indexOf("--descriptorJson");
const deadlineIndex = args.indexOf("--deadlineMs");
const mode = process.env.FAKE_AXF_MODE ?? "success";

if (mode === "invalid") {
  process.stdout.write("not-json");
  process.exitCode = 1;
} else {
  const descriptor = JSON.parse(args[descriptorIndex + 1]);
  const outcome = mode === "observation-error" ? "observation-error" : "satisfied";
  process.stdout.write(
    JSON.stringify({
      ok: mode === "inconsistent" ? false : outcome !== "observation-error",
      data: {
        schemaVersion: "axf/await-result/v1",
        provider: descriptor.kind,
        outcome,
        terminal: true,
        durability: "process-bound",
        authorityModel: "host-provided",
        underlyingCancellation: false,
        effectiveDeadlineMs: Number(args[deadlineIndex + 1]),
        observationCount: 1,
        evidence:
          outcome === "observation-error"
            ? null
            : {
                repository: descriptor.subject.repository,
                headSha: descriptor.subject.headSha,
                pullRequestNumber: descriptor.subject.pullRequestNumber ?? null,
                requiredChecks: descriptor.condition.requiredChecks.map((selector) => ({
                  source: selector.source,
                  name: selector.name,
                  appSlug: selector.appSlug ?? null,
                  state: "completed",
                  conclusion: selector.source === "check-run" ? "success" : undefined,
                  terminal: true,
                  successful: true,
                })),
              },
      },
      ...(outcome === "observation-error" ? { error: { message: "bounded failure" } } : {}),
      meta: {},
    })
  );
  if (outcome === "observation-error") process.exitCode = 1;
}
