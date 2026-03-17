import { AgentPipeline, PipelineRunResult } from "./types";
import { McpServiceListManager } from "./McpServiceListManager";

export class PipelineRunner {
  constructor(private manager: McpServiceListManager) {}

  async run(
    pipeline: AgentPipeline,
    initialInput?: Record<string, unknown>
  ): Promise<PipelineRunResult> {
    const startedAt = new Date().toISOString();
    const stepResults: PipelineRunResult["stepResults"] = [];

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      const stepStart = Date.now();

      // Build arguments from inputMapping
      const args: Record<string, unknown> = {};
      if (step.inputMapping) {
        for (const [key, value] of Object.entries(step.inputMapping)) {
          if (typeof value === "string") {
            args[key] = value;
          } else {
            // { fromStep, outputPath }
            const prevOutput = stepResults[value.fromStep]?.output;
            args[key] = this.getByPath(prevOutput, value.outputPath);
          }
        }
      } else if (initialInput) {
        Object.assign(args, initialInput);
      }

      try {
        const result = await this.manager.dispatchAs(step.agentId, {
          toolName: step.toolName,
          arguments: args,
        });
        const durationMs = Date.now() - stepStart;
        stepResults.push({
          stepIndex: i,
          agentId: step.agentId,
          toolName: step.toolName,
          success: result.success,
          output: result.output,
          error: result.error,
          durationMs,
        });
        if (!result.success) {
          return {
            pipelineId: pipeline.id,
            startedAt,
            completedAt: new Date().toISOString(),
            success: false,
            stepResults,
            failedAtStep: i,
            error: result.error,
          };
        }
      } catch (err) {
        const durationMs = Date.now() - stepStart;
        stepResults.push({
          stepIndex: i,
          agentId: step.agentId,
          toolName: step.toolName,
          success: false,
          error: (err as Error).message,
          durationMs,
        });
        return {
          pipelineId: pipeline.id,
          startedAt,
          completedAt: new Date().toISOString(),
          success: false,
          stepResults,
          failedAtStep: i,
          error: (err as Error).message,
        };
      }
    }

    const lastStep = stepResults[stepResults.length - 1];
    return {
      pipelineId: pipeline.id,
      startedAt,
      completedAt: new Date().toISOString(),
      success: true,
      stepResults,
      finalOutput: lastStep?.output,
    };
  }

  private getByPath(obj: unknown, path: string): unknown {
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
