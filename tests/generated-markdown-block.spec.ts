import { describe, expect, it } from "vitest";

import { replaceGeneratedMarkdownBlock } from "../scripts/generated-markdown-block.mjs";

describe("replaceGeneratedMarkdownBlock", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("preserves %s target line endings", (_name, eol) => {
    const current = [
      "before",
      "<!-- BEGIN GENERATED TEST -->",
      "old",
      "<!-- END GENERATED TEST -->",
      "after",
      "",
    ].join(eol);
    const replacement = [
      "<!-- BEGIN GENERATED TEST -->",
      "new",
      "<!-- END GENERATED TEST -->",
    ].join("\n");

    const next = replaceGeneratedMarkdownBlock(current, "GENERATED TEST", replacement);

    expect(next).toBe(
      [
        "before",
        "<!-- BEGIN GENERATED TEST -->",
        "new",
        "<!-- END GENERATED TEST -->",
        "after",
        "",
      ].join(eol)
    );
    if (eol === "\r\n") expect(next.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("fails when the named block is absent", () => {
    expect(() => replaceGeneratedMarkdownBlock("plain\n", "MISSING", "replacement")).toThrow(
      "missing generated block MISSING"
    );
  });
});
