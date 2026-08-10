import { z } from "zod";

/**
 * Repository identities are bounded logical names, not opaque transport IDs.
 * In particular, the canonical GitHub-style identity is `owner/repository`.
 */
export const GovernedRepositoryId = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes("\0"), { message: "Must not contain NUL bytes" });
export type GovernedRepositoryId = z.infer<typeof GovernedRepositoryId>;
