import type { SimpleGit } from "simple-git";
import { sha256 } from "../util/hash.js";
import { FrozenGitInputs, repositoryIdentity } from "./input-schema.js";

export class FrozenGitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrozenGitInputError";
  }
}

/** Acquire only declared refs, then compare with the already frozen expectations. */
export async function verifyFrozenGitInputs(git: SimpleGit, value: FrozenGitInputs) {
  const inputs = FrozenGitInputs.parse(value);
  let remote: string;
  try {
    remote = (await git.raw(["remote", "get-url", inputs.checkoutRemote])).trim();
    if (repositoryIdentity(remote) !== repositoryIdentity(inputs.repository)) throw new Error();
  } catch {
    throw new FrozenGitInputError(
      "Checkout repository does not match gitInputs; use the declared checkout"
    );
  }
  const resolve = async (input: { ref: string; commit: string }): Promise<string> => {
    let ref = input.ref;
    if (inputs.acquisition === "fetch") {
      ref = `refs/lexrunner/inputs/${sha256(Buffer.from(`${inputs.repository}\n${input.ref}\n${input.commit}`))}`;
      try {
        await git.raw([
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "--no-write-fetch-head",
          "--",
          inputs.repository,
          `+${input.ref}:${ref}`,
        ]);
      } catch {
        throw new FrozenGitInputError(
          `Declared acquisition failed for ${input.ref}; restore access and retry without changing frozen expectations`
        );
      }
    }
    let observed: string;
    try {
      observed = (await git.raw(["rev-parse", "--verify", ref])).trim();
    } catch {
      throw new FrozenGitInputError(
        `Declared ref ${input.ref} is unavailable; explicitly acquire it or create a new plan permitting fetch`
      );
    }
    if (observed !== input.commit) {
      throw new FrozenGitInputError(
        `Stale Git input ${input.ref}; reassess and generate a new plan instead of replacing its expected commit`
      );
    }
    if ((await git.raw(["cat-file", "-t", input.commit])).trim() !== "commit") {
      throw new FrozenGitInputError(`Declared input ${input.ref} is not a commit object`);
    }
    return observed;
  };
  const targetHeadSha = await resolve(inputs.target);
  const sourceHeads: Record<string, string> = Object.create(null);
  for (const source of inputs.sources) sourceHeads[source.item] = await resolve(source);
  return { targetHeadSha, sourceHeads };
}
