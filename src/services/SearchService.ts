/**
 * src/services/SearchService.ts
 *
 * A lightweight mock search service — used as a fallback when premium
 * services (e.g. PerplexityService) are unavailable.
 */

import { ServiceResult } from "../core/types";
import { BaseService } from "./BaseService";

export class SearchService extends BaseService {
  readonly name = "SearchService";
  readonly description = "Mock web-search service (free, always available)";

  async execute(payload: unknown): Promise<ServiceResult> {
    const query =
      typeof payload === "object" &&
      payload !== null &&
      "query" in payload
        ? (payload as { query: string }).query
        : String(payload);

    return {
      success: true,
      data: {
        source: "SearchService (mock)",
        query,
        results: [
          { title: "Mock Result 1", snippet: `Result for "${query}" (mock)` },
          { title: "Mock Result 2", snippet: `Another result for "${query}" (mock)` },
        ],
      },
    };
  }
}
