#!/usr/bin/env node
import fs from "fs";
import path from "path";

const dir = path.join(
	process.cwd(),
	".smartergpt",
	"runner",
	"governance-logs"
);
if (!fs.existsSync(dir)) {
	console.error("No governance logs found at", dir);
	process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const logs = files.map((f) =>
	JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
);

const total = logs.length;
const successes = logs.filter((l) => l.lexsona.success).length;
const offline = logs.filter((l) => l.lexsona.offlineMode).length;
const withConstraints = logs.filter(
	(l) =>
		l.lexsona.constraintSet && l.lexsona.constraintSet.constraintCount > 0
).length;
const avgConstraintCount =
	logs.reduce(
		(s, l) => s + (l.lexsona.constraintSet?.constraintCount ?? 0),
		0
	) / total;
const personaCounts = logs.reduce((acc, l) => {
	acc[l.lexsona.personaId ?? "null"] =
		(acc[l.lexsona.personaId ?? "null"] || 0) + 1;
	return acc;
}, {});

console.log("Governance logs summary:");
console.log("  total logs:", total);
console.log(
	"  successful derivations:",
	successes,
	`(${((successes / total) * 100).toFixed(0)}%)`
);
console.log(
	"  offline-mode logs:",
	offline,
	`(${((offline / total) * 100).toFixed(0)}%)`
);
console.log(
	"  logs with >0 constraints:",
	withConstraints,
	`(${((withConstraints / total) * 100).toFixed(0)}%)`
);
console.log("  average constraintCount:", avgConstraintCount.toFixed(2));
console.log("  persona usage:", JSON.stringify(personaCounts, null, 2));

// Top constraints text frequency
const freq = new Map();
for (const l of logs) {
	const cs = l.lexsona.constraintSet?.topConstraints ?? [];
	for (const c of cs) {
		const k = c.description.slice(0, 80);
		freq.set(k, (freq.get(k) || 0) + 1);
	}
}
const freqArr = Array.from(freq.entries())
	.sort((a, b) => b[1] - a[1])
	.slice(0, 10);
if (freqArr.length > 0) {
	console.log("\nTop constraints (by frequency):");
	for (const [desc, count] of freqArr)
		console.log("  -", JSON.stringify(desc), "x", count);
} else {
	console.log("\nNo constraints recorded in logs.");
}

// Simple agreement metric: whether runner says mergeEligible true and LexSona produced zero constraints (i.e., no blocking rules)
let agreeCount = 0;
for (const l of logs) {
	const runnerEligible = l.runner.mergeEligible;
	const lexsonaBlocking = (l.lexsona.constraintSet?.constraintCount ?? 0) > 0;
	if (runnerEligible && !lexsonaBlocking) agreeCount++;
}
console.log(
	"\nSimple agreement: runner allowed and LexSona no-block ==",
	agreeCount,
	"/",
	total,
	`(${((agreeCount / total) * 100).toFixed(0)}%)`
);
