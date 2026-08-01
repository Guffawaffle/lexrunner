import { spawnSync } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error("Run this check through npm so the active package-manager executable is explicit.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [npmExecPath, "approve-scripts", "--allow-scripts-pending"],
  { encoding: "utf8" }
);

if (result.error) {
  console.error(`Unable to inspect npm install-script policy: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
if (result.status !== 0 || !output.includes("No packages with unreviewed install scripts.")) {
  console.error(output || "npm did not return an install-script policy result.");
  process.exit(result.status || 1);
}

console.log(JSON.stringify({ status: "verified", pendingInstallScripts: 0 }));
