import path from "node:path";

export function resolveContainedPackageTarget(packageRoot, relativeTarget) {
  const resolvedRoot = path.resolve(packageRoot);
  const target = path.resolve(resolvedRoot, relativeTarget);
  const relative = path.relative(resolvedRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Packed package bin target escaped the package root");
  }
  return target;
}
