/**
 * Canonical JSON serialization with deterministic key ordering
 * Ensures byte-for-byte identical output across multiple serializations
 */

/**
 * Stable array sorting helper
 */
export function stableSort<T>(array: T[]): T[] {
  return [...array].sort();
}

/**
 * Serialize any value to canonical JSON with deterministic key ordering
 * Arrays keep authored order, objects get keys sorted recursively
 * Always ends with newline for consistent file artifacts
 */
export function canonicalJSONStringify(input: unknown): string {
  return JSON.stringify(sortRec(input), null, 2) + "\n";
  function sortRec(v: any): any {
    if (Array.isArray(v)) return v.map(sortRec); // arrays keep order
    if (v && typeof v === "object" && v.constructor === Object) {
      const out: any = {};
      for (const k of Object.keys(v).sort()) out[k] = sortRec(v[k]);
      return out;
    }
    return v;
  }
}
