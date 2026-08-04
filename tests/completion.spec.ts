import { describe, it, expect } from "vitest";
import { CompletionGenerator, registerCompletionCommand } from "../src/commands/completion.js";
import { Command } from "commander";

describe("CompletionGenerator", () => {
  it("uses the canonical executable name by default", () => {
    const generator = new CompletionGenerator();

    expect(generator.generateBash()).toContain("complete -F _lexrunner_completions lexrunner");
    expect(generator.generateZsh()).toContain("#compdef lexrunner");
  });

  describe("generateBash", () => {
    it("should generate valid bash completion script", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateBash();

      expect(script).toContain("_lex_pr_completions");
      expect(script).toContain("complete -F");
      expect(script).toContain("COMPREPLY");
      expect(script).toContain("plan");
      expect(script).toContain("execute");
      expect(script).toContain("merge");
    });

    it("should include new commands in completion", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateBash();

      expect(script).toContain("view");
      expect(script).toContain("query");
      expect(script).toContain("retry");
      expect(script).toContain("completion");
    });

    it("should handle command-specific options", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateBash();

      expect(script).toContain("plan_opts");
      expect(script).toContain("query_opts");
      expect(script).toContain("retry_opts");
    });
  });

  describe("generateZsh", () => {
    it("should generate valid zsh completion script", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateZsh();

      expect(script).toContain("#compdef lex-pr");
      expect(script).toContain("_lex_pr");
      expect(script).toContain("_arguments");
      expect(script).toContain("plan:");
      expect(script).toContain("execute:");
    });

    it("should include command descriptions", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateZsh();

      expect(script).toContain("Interactive plan viewer");
      expect(script).toContain("Advanced query and analysis");
      expect(script).toContain("Retry failed gates");
    });

    it("should include file completion for plan files", () => {
      const generator = new CompletionGenerator("lex-pr");
      const script = generator.generateZsh();

      expect(script).toContain("_files -g");
      expect(script).toContain("*.json");
    });
  });

  describe("getInstallInstructions", () => {
    it("should provide bash installation instructions", () => {
      const generator = new CompletionGenerator("lex-pr");
      const instructions = generator.getInstallInstructions("bash");

      expect(instructions).toContain("bash completion");
      expect(instructions).toContain("~/.bashrc");
      expect(instructions).toContain("source");
    });

    it("should provide zsh installation instructions", () => {
      const generator = new CompletionGenerator("lex-pr");
      const instructions = generator.getInstallInstructions("zsh");

      expect(instructions).toContain("zsh completion");
      expect(instructions).toContain("~/.zshrc");
      expect(instructions).toContain("source");
    });

    it("should include eval command", () => {
      const generator = new CompletionGenerator("lex-pr");
      const bashInstructions = generator.getInstallInstructions("bash");
      const zshInstructions = generator.getInstallInstructions("zsh");

      expect(bashInstructions).toContain('eval "$(lex-pr completion bash)"');
      expect(zshInstructions).toContain('eval "$(lex-pr completion zsh)"');
    });
  });

  describe("custom program name", () => {
    it("should support custom program names", () => {
      const generator = new CompletionGenerator("my-tool");
      const bashScript = generator.generateBash();

      expect(bashScript).toContain("my-tool");
      expect(bashScript).toContain("_my_tool_completions");
    });

    it("should handle hyphens in program name", () => {
      const generator = new CompletionGenerator("lex-pr");
      const bashScript = generator.generateBash();

      // Bash function names can't have hyphens
      expect(bashScript).toContain("_lex_pr_completions");
    });
  });

  describe("registerCompletionCommand", () => {
    it("should register completion command with program", () => {
      const program = new Command();
      const mockThrowExit = (code: number): never => {
        throw new Error(`Exit ${code}`);
      };
      const mockExitWith = (error: unknown): void => {
        throw error;
      };

      registerCompletionCommand(program, mockThrowExit, mockExitWith);

      const completionCommand = program.commands.find((cmd) => cmd.name() === "completion");
      expect(completionCommand).toBeDefined();
      expect(completionCommand?.description()).toBe("Generate shell completion scripts");
    });
  });
});
