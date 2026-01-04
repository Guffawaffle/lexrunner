/**
 * Adapter-specific errors (ADR-009)
 */

/**
 * Thrown when no adapter can be found for the given name or content
 */
export class AdapterNotFoundError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[] = []
  ) {
    super(message);
    this.name = "AdapterNotFoundError";
  }
}

/**
 * Thrown when an adapter fails to parse input
 *
 * Preserves raw input for debugging and auditability
 */
export class AdapterParseError extends Error {
  constructor(
    message: string,
    public readonly adapterName: string,
    public readonly raw: string | Buffer
  ) {
    super(message);
    this.name = "AdapterParseError";
  }
}
