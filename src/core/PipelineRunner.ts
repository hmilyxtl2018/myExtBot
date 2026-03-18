import { AgentPipeline, PipelineRunResult, PipelineStep } from "./types";

/**
 * Minimal interface that PipelineRunner requires from the manager.
 * Using an interface keeps PipelineRunner decoupled from the concrete class.
 */
export interface IPipelineManager {
  dispatchAs(
    agentId: string,
    request: { toolName: string; arguments: Record<string, unknown> }
  ): Promise<{ success: boolean; output?: unknown; error?: string }>;
}

/**
 * PipelineRunner — executes all steps of a Pipeline in order, threading
 * context between steps via inputMapping.
 *
 * Execution logic:
 * 1. Iterate over pipeline.steps
 * 2. Build arguments using inputMapping:
 *    - string values are used as literals
 *    - { fromStep, outputPath } resolves the value from a previous step's output
 * 3. Call manager.dispatchAs(step.agentId, { toolName, arguments })
 * 4. Append the result to stepResults
 * 5. If a step fails, stop execution immediately (failFast mode)
 * 6. Record the overall result after all steps complete
 */
export class PipelineRunner {
  constructor(private manager: IPipelineManager) {}

  /**
   * Execute a Pipeline.
   * @param pipeline Pipeline definition
   * @param initialInput Optional initial input passed to every step as base arguments
   */
  async run(
    pipeline: AgentPipeline,
    initialInput: Record<string, unknown> = {}
  ): Promise<PipelineRunResult> {
    const startedAt = new Date().toISOString();

    const result: PipelineRunResult = {
      pipelineId: pipeline.id,
      startedAt,
      completedAt: startedAt,
      success: false,
      stepResults: [],
    };

    for (let stepIndex = 0; stepIndex < pipeline.steps.length; stepIndex++) {
      const step = pipeline.steps[stepIndex];
      const stepArgs = this.buildArgs(step, result.stepResults, initialInput);

      const stepStart = Date.now();
      let stepResult: { success: boolean; output?: unknown; error?: string };

      try {
        stepResult = await this.manager.dispatchAs(step.agentId, {
          toolName: step.toolName,
          arguments: stepArgs,
        });
      } catch (err) {
        stepResult = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const durationMs = Date.now() - stepStart;

      result.stepResults.push({
        stepIndex,
        agentId: step.agentId,
        toolName: step.toolName,
        success: stepResult.success,
        output: stepResult.output,
        error: stepResult.error,
        durationMs,
      });

      if (!stepResult.success) {
        result.failedAtStep = stepIndex;
        result.error = stepResult.error ?? `Step ${stepIndex} failed`;
        result.completedAt = new Date().toISOString();
        return result;
      }
    }

    result.success = true;
    result.completedAt = new Date().toISOString();

    if (result.stepResults.length > 0) {
      result.finalOutput =
        result.stepResults[result.stepResults.length - 1].output;
    }

    return result;
  }

  /**
   * 构建某一步的参数对象，根据 inputMapping 规则解析字面量和 fromStep 引用。
   */
  private buildArgs(
    step: PipelineStep,
    completedResults: PipelineRunResult["stepResults"],
    initialInput: Record<string, unknown>
  ): Record<string, unknown> {
    const args: Record<string, unknown> = { ...initialInput };

    if (!step.inputMapping) {
      return args;
    }

    for (const [key, mapping] of Object.entries(step.inputMapping)) {
      if (typeof mapping === "string") {
        // Literal value
        args[key] = mapping;
      } else {
        // { fromStep, outputPath } reference
        const fromResult = completedResults[mapping.fromStep];
        if (fromResult === undefined) {
          throw new Error(
            `Step ${step.toolName}: inputMapping key "${key}" references step ${mapping.fromStep} which has not been executed yet`
          );
        }
        args[key] = this.getByPath(fromResult.output, mapping.outputPath);
      }
    }

    return args;
  }

  /**
   * Resolve a value from a nested object by a dot-notation path.
   * Example: getByPath({ results: [{ url: "a" }] }, "results[0].url") → "a"
   */
  getByPath(obj: unknown, path: string): unknown {
    if (path === "") {
      return obj;
    }

    // Normalize array brackets: "results[0].url" → "results.0.url"
    const normalised = path.replace(/\[(\d+)\]/g, ".$1");
    const segments = normalised.split(".").filter((s) => s.length > 0);

    let current: unknown = obj;
    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }
}

