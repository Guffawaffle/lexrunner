import { z } from "zod";

/** Repository identity comparison is consistency evidence, not authentication. */
export function repositoryIdentity(value: string): string {
  const scp = /^git@([^/:]+):(.+)$/.exec(value);
  const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : value);
  if (
    !["https:", "ssh:", "file:"].includes(url.protocol) ||
    url.password ||
    url.search ||
    url.hash ||
    (url.username && !(url.protocol === "ssh:" && url.username === "git"))
  )
    throw new Error("Repository must be an explicit HTTPS, SSH or file URL without credentials");
  if (url.protocol === "file:") return url.href.replace(/\/$/, "");
  if (!url.hostname || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) {
    throw new Error("Repository URL must identify an owner and repository");
  }
  const path = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${
    url.hostname.toLowerCase() === "github.com" ? path.toLowerCase() : path
  }`;
}

export const GitCommitId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const GitRef = z
  .string()
  .max(512)
  .regex(/^refs\/(?:heads\/.+|pull\/[1-9][0-9]*\/head)$/)
  .refine(
    (ref) =>
      !/[\x00-\x20\x7f~^:?*\[\\]/.test(ref) &&
      !ref.includes("..") &&
      !ref.includes("@{") &&
      ref
        .split("/")
        .every(
          (part) =>
            !!part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock")
        ),
    "Invalid fully qualified Git ref"
  );
const GitInput = z.object({ ref: GitRef, commit: GitCommitId }).strict();

export const FrozenGitInputs = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    repository: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          repositoryIdentity(value);
          return true;
        } catch {
          return false;
        }
      }, "An explicit repository URL without credentials is required"),
    checkoutRemote: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    acquisition: z.enum(["local-only", "fetch"]),
    target: GitInput,
    sources: z.array(GitInput.extend({ item: z.string().min(1).max(512) }).strict()).max(256),
  })
  .strict();
export type FrozenGitInputs = z.infer<typeof FrozenGitInputs>;
