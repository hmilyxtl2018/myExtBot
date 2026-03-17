import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/** Languages supported by the mock code runner. */
const SUPPORTED_LANGUAGES = ["javascript", "python", "typescript", "bash"] as const;

/**
 * CodeRunnerService exposes sandboxed code execution capabilities to the LLM.
 *
 * Tool provided: `run_code`
 */
export class CodeRunnerService extends BaseService {
  readonly name = "CodeRunnerService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "run_code",
        description:
          "Execute a snippet of code in a sandboxed environment and return the output.",
        parameters: {
          type: "object",
          properties: {
            language: {
              type: "string",
              description: `The programming language of the code snippet. Supported values: ${SUPPORTED_LANGUAGES.join(", ")}.`,
              enum: [...SUPPORTED_LANGUAGES],
            },
            code: {
              type: "string",
              description: "The source code to execute.",
            },
          },
          required: ["language", "code"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "run_code") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    const language = call.arguments["language"] as string;
    const code = call.arguments["code"] as string;

    if (!SUPPORTED_LANGUAGES.includes(language as (typeof SUPPORTED_LANGUAGES)[number])) {
      return {
        success: false,
        error: `Unsupported language "${language}". Supported: ${SUPPORTED_LANGUAGES.join(", ")}.`,
      };
    }

    // Mock implementation — replace with a real sandboxed execution engine.
    return {
      success: true,
      output: {
        language,
        code,
        stdout: `[mock] Executed ${language} code successfully.\n> ${code.split("\n")[0]}`,
        stderr: "",
        exitCode: 0,
      },
    };
  }
}
