import { AgentPipeline } from "./types";

/**
 * PipelineRegistry — stores and retrieves Pipeline definitions.
 */
export class PipelineRegistry {
  private pipelines = new Map<string, AgentPipeline>();

  register(pipeline: AgentPipeline): void {
    this.pipelines.set(pipeline.id, pipeline);
    this.pipelines.set(pipeline.id, { ...pipeline });
  }

  get(id: string): AgentPipeline | undefined {
    return this.pipelines.get(id);
  }

  list(): AgentPipeline[] {
    return Array.from(this.pipelines.values());
  }

  unregister(id: string): boolean {
    return this.pipelines.delete(id);
  }
}
