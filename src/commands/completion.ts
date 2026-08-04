/**
 * Shell completion generation for bash and zsh
 */

import { Command } from "commander";

export interface CompletionScript {
  shell: "bash" | "zsh";
  script: string;
}

/**
 * Generate shell completion scripts
 */
export class CompletionGenerator {
  private programName: string;
  private commands: string[];

  constructor(programName: string = "lexrunner") {
    this.programName = programName;
    this.commands = [
      "init",
      "doctor",
      "discover",
      "plan",
      "execute",
      "merge",
      "status",
      "report",
      "schema",
      "merge-order",
      "autopilot",
      "bootstrap",
      "init-local",
      "view",
      "query",
      "retry",
      "completion",
    ];
  }

  /**
   * Generate bash completion script
   */
  generateBash(): string {
    return `# ${this.programName} completion for bash

_${this.programName.replace(/-/g, "_")}_completions()
{
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Command list
    local commands="${this.commands.join(" ")}"

    # Top-level options
    local opts="--help --version --log-format"

    # Complete commands
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands} \${opts}" -- \${cur}) )
        return 0
    fi

    # Complete subcommands based on command
    case "\${COMP_WORDS[1]}" in
        plan)
            local plan_opts="--out --json --dry-run --from-github --query --labels --include-drafts --github-token --owner --repo --profile-dir"
            COMPREPLY=( $(compgen -W "\${plan_opts}" -- \${cur}) )
            ;;
        execute|status|merge-order|autopilot)
            local file_opts="--plan --json --state-dir --profile-dir"
            COMPREPLY=( $(compgen -W "\${file_opts}" -- \${cur}) )
            # Also complete .json files
            if [[ "\${cur}" == *.json ]] || [[ -z "\${cur}" ]]; then
                COMPREPLY+=( $(compgen -f -X '!*.json' -- \${cur}) )
            fi
            ;;
        merge)
            local merge_opts="--plan --dry-run --execute --json --timeout --state-dir --profile-dir"
            COMPREPLY=( $(compgen -W "\${merge_opts}" -- \${cur}) )
            ;;
        query)
            local query_opts="--plan --format --output --stats --roots --leaves --level"
            COMPREPLY=( $(compgen -W "\${query_opts}" -- \${cur}) )
            ;;
        view)
            local view_opts="--plan --filter --show-deps --show-gates"
            COMPREPLY=( $(compgen -W "\${view_opts}" -- \${cur}) )
            ;;
        retry)
            local retry_opts="--state-dir --filter --items --dry-run"
            COMPREPLY=( $(compgen -W "\${retry_opts}" -- \${cur}) )
            ;;
        completion)
            local comp_opts="bash zsh fish --install"
            COMPREPLY=( $(compgen -W "\${comp_opts}" -- \${cur}) )
            ;;
        *)
            ;;
    esac
}

complete -F _${this.programName.replace(/-/g, "_")}_completions ${this.programName}
`;
  }

  /**
   * Generate zsh completion script
   */
  generateZsh(): string {
    return `#compdef ${this.programName}

# ${this.programName} completion for zsh

_${this.programName.replace(/-/g, "_")}() {
    local -a commands
    commands=(
${this.commands.map((cmd) => `        '${cmd}:${this.getCommandDescription(cmd)}'`).join("\n")}
    )

    local -a global_opts
    global_opts=(
        '--help[Display help for command]'
        '--version[Output the version number]'
        '--log-format[Log output format: json or human]:format:(json human)'
    )

    _arguments -C \\
        "1: :{_describe 'command' commands}" \\
        '*::arg:->args' \\
        \${global_opts[@]}

    case \$state in
        args)
            case \$words[1] in
                plan)
                    _arguments \\
                        '--out[Output directory]:directory:_files -/' \\
                        '--json[Output JSON format]' \\
                        '--dry-run[Validate inputs without writing]' \\
                        '--from-github[Auto-discover PRs from GitHub]' \\
                        '--query[GitHub search query]:query:' \\
                        '--labels[Filter by labels]:labels:' \\
                        '--include-drafts[Include draft PRs]' \\
                        '--profile-dir[Profile directory]:directory:_files -/'
                    ;;
                execute|status|merge-order|autopilot)
                    _arguments \\
                        '--plan[Path to plan.json]:file:_files -g "*.json"' \\
                        '--json[Output JSON format]' \\
                        '--state-dir[State directory]:directory:_files -/' \\
                        '--profile-dir[Profile directory]:directory:_files -/'
                    ;;
                merge)
                    _arguments \\
                        '--plan[Path to plan.json]:file:_files -g "*.json"' \\
                        '--dry-run[Show what would be merged]' \\
                        '--execute[Actually perform merge operations]' \\
                        '--json[Output JSON format]'
                    ;;
                query)
                    _arguments \\
                        '--plan[Path to plan.json]:file:_files -g "*.json"' \\
                        '--format[Output format]:format:(json table csv)' \\
                        '--output[Output file]:file:_files' \\
                        '--stats[Show statistics]' \\
                        '--roots[Show root nodes]' \\
                        '--leaves[Show leaf nodes]' \\
                        '--level[Filter by level]:level:'
                    ;;
                view)
                    _arguments \\
                        '--plan[Path to plan.json]:file:_files -g "*.json"' \\
                        '--filter[Filter items]:filter:' \\
                        '--show-deps[Show dependencies]' \\
                        '--show-gates[Show gates]'
                    ;;
                retry)
                    _arguments \\
                        '--state-dir[State directory]:directory:_files -/' \\
                        '--filter[Filter items]:filter:' \\
                        '--items[Specific items]:items:' \\
                        '--dry-run[Show what would be retried]'
                    ;;
                completion)
                    _arguments \\
                        '1:shell:(bash zsh fish)' \\
                        '--install[Install completion script]'
                    ;;
            esac
            ;;
    esac
}

_${this.programName.replace(/-/g, "_")} "\$@"
`;
  }

  private getCommandDescription(cmd: string): string {
    const descriptions: Record<string, string> = {
      init: "Initialize workspace with interactive setup",
      doctor: "Validate environment and configuration",
      discover: "Discover open pull requests from GitHub",
      plan: "Generate plan from configuration or GitHub PRs",
      execute: "Execute plan with quality gates",
      merge: "Execute merge pyramid with git operations",
      status: "Show current execution status",
      report: "Aggregate gate reports from directory",
      schema: "Schema operations",
      "merge-order": "Compute dependency levels and merge order",
      autopilot: "Run autopilot analysis and artifact generation",
      bootstrap: "Create minimal workspace configuration",
      "init-local": "Initialize local overlay directory",
      view: "Interactive plan viewer",
      query: "Advanced query and analysis",
      retry: "Retry failed gates",
      completion: "Generate shell completion scripts",
    };

    return descriptions[cmd] || cmd;
  }

  /**
   * Get installation instructions for the shell
   */
  getInstallInstructions(shell: "bash" | "zsh"): string {
    const rcFile = shell === "bash" ? "~/.bashrc" : "~/.zshrc";
    const completionDir =
      shell === "bash" ? "/usr/local/etc/bash_completion.d" : "/usr/local/share/zsh/site-functions";

    return `
To install ${shell} completion:

1. Save the completion script:
   ${this.programName} completion ${shell} > ${completionDir}/_${this.programName}

2. Or add to your ${rcFile}:
   eval "$(${this.programName} completion ${shell})"

3. Reload your shell:
   source ${rcFile}
`;
  }
}

/**
 * Register the completion command with Commander program
 */
export function registerCompletionCommand(
  program: Command,
  throwExit: (code: number) => never,
  exitWith: (error: unknown) => void
): void {
  program
    .command("completion")
    .description("Generate shell completion scripts")
    .argument("[shell]", "Shell type: bash, zsh", "bash")
    .option("--install", "Show installation instructions")
    .action(async (shell: string, opts) => {
      try {
        const generator = new CompletionGenerator(program.name());

        if (opts.install) {
          console.log(generator.getInstallInstructions(shell as "bash" | "zsh"));
          return;
        }

        let script = "";
        if (shell === "zsh") {
          script = generator.generateZsh();
        } else if (shell === "bash") {
          script = generator.generateBash();
        } else {
          console.error(`Error: unsupported shell '${shell}'. Use 'bash' or 'zsh'`);
          throwExit(1);
        }

        console.log(script);
        return;
      } catch (error) {
        exitWith(error);
      }
    });
}
