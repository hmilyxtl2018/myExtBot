/**
 * AgentRouter — Automatically recommends the best-fit Agent for a user query.
 *
 * Routing algorithm (MVP):
 *
 * 1. Lowercase the user query and split into tokens (whitespace / punctuation).
 * 2. For each active Agent compute a match score:
 *    a. intents intersection  : +3 per matched intent
 *    b. domains intersection  : +2 per matched domain
 *    c. primarySkill contains : +2
 *    d. capabilities intersection: +1 per matched capability
 *    e. name / description contains a query token: +1
 * 3. Skip agents whose enabled flag is false.
 * 4. Sort descending by score; break ties by toolCount (more tools = more specialised).
 * 5. Return top-N results (default 3); entries with score 0 are excluded when at
 *    least one agent has a positive score.
 *
 * @module AgentRouter
 *
 * Related:
 *  - M7 (Scene Triggers): keyword-type triggers share the same token-matching logic
 *  - M3 (Multi-Agent Pipeline): pipelines can use AgentRouter to pick the right step agent
 */

import type { McpServiceListManager } from "./McpServiceListManager";

export interface AgentRouteSuggestion {
  agentId: string;
  agentName: string;
  score: number;
  matchedIntents: string[];
  matchedDomains: string[];
  /** Human-readable explanation, e.g. "匹配意图: web-search, research" */
  reasoning: string;
}

export class AgentRouter {
  constructor(private readonly manager: McpServiceListManager) {}

  /**
   * Recommend Agents for the given natural-language query.
   *
   * @param query User's natural-language input.
   * @param topN  Maximum number of results to return (default 3).
   * @returns Suggestions sorted by score descending.
   */
  route(query: string, topN = 3): AgentRouteSuggestion[] {
    const tokens = this.tokenize(query);
    const agents = this.manager.listAgents();

    const scored: (AgentRouteSuggestion & { toolCount: number })[] = agents
      .filter((a) => a.enabled !== false)
      .map((agent) => {
        let score = 0;
        const matchedIntents: string[] = [];
        const matchedDomains: string[] = [];

        // a. intents (+3 each)
        for (const intent of agent.intents ?? []) {
          if (tokens.some((t) => this.tokenMatchesTag(t, intent))) {
            matchedIntents.push(intent);
            score += 3;
          }
        }

        // b. domains (+2 each)
        for (const domain of agent.domains ?? []) {
          if (tokens.some((t) => this.tokenMatchesTag(t, domain))) {
            matchedDomains.push(domain);
            score += 2;
          }
        }

        // c. primarySkill (+2)
        if (agent.primarySkill) {
          const skill = agent.primarySkill.toLowerCase();
          if (tokens.some((t) => skill.split(/[\s\-]+/).includes(t))) {
            score += 2;
          }
        }

        // d. capabilities (+1 each)
        for (const cap of agent.capabilities ?? []) {
          const capWords = cap.toLowerCase().split(/[\s\-]+/);
          if (tokens.some((t) => capWords.includes(t))) {
            score += 1;
          }
        }

        // e. name / description (+1)
        const nameWords = agent.name.toLowerCase().split(/[\s\-]+/);
        const descWords = (agent.description ?? "").toLowerCase().split(/[\s\-]+/);
        if (tokens.some((t) => nameWords.includes(t) || descWords.includes(t))) {
          score += 1;
        }

        // Build reasoning string
        const reasons: string[] = [];
        if (matchedIntents.length > 0) reasons.push(`匹配意图: ${matchedIntents.join(", ")}`);
        if (matchedDomains.length > 0) reasons.push(`匹配领域: ${matchedDomains.join(", ")}`);
        const reasoning = reasons.length > 0 ? reasons.join("; ") : "无直接意图/领域匹配";

        return {
          agentId: agent.id,
          agentName: agent.name,
          score,
          matchedIntents,
          matchedDomains,
          reasoning,
          toolCount: agent.toolCount,
        };
      });

    // Determine whether any agent has a positive score
    const hasPositiveScore = scored.some((s) => s.score > 0);

    return scored
      .filter((s) => !hasPositiveScore || s.score > 0)
      .sort((a, b) => b.score - a.score || b.toolCount - a.toolCount)
      .slice(0, topN)
      .map(({ toolCount: _tc, ...rest }) => rest);
  }

  /**
   * Returns the ID of the single best-matching Agent, or undefined if no
   * agent scores above 0.
   */
  bestMatch(query: string): string | undefined {
    const results = this.route(query, 1);
    if (results.length === 0 || results[0].score === 0) return undefined;
    return results[0].agentId;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Check whether a query token matches a tag (intent or domain).
   *
   * Matching rules (in order):
   *  1. Exact equality        — token === tag
   *  2. Hyphen-segment        — token equals any hyphen-delimited segment
   *                             (e.g. "search" matches "web-search")
   *  3. CJK substring         — when either token or tag contains CJK characters,
   *                             use bidirectional substring containment to handle
   *                             Chinese/Japanese/Korean text without word boundaries
   *                             (e.g. "查询" matches tag "查询" and token "查询天气")
   *
   * Bidirectional substring matching is NOT used for purely-ASCII tags because it
   * causes false positives (e.g. "search" would otherwise match domain "research").
   */
  private tokenMatchesTag(token: string, tag: string): boolean {
    const tagLower = tag.toLowerCase();
    if (token === tagLower) return true;
    // Hyphen-segment exact match
    if (tagLower.split("-").includes(token)) return true;
    // CJK fallback: use substring matching when non-ASCII characters are present
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(token + tagLower)) {
      return tagLower.includes(token) || token.includes(tagLower);
    }
    return false;
  }

  /**
   * Split a query into lower-case tokens (split on whitespace and punctuation).
   * Tokens shorter than 2 characters are dropped to avoid false positives
   * (e.g. the article "a" would otherwise match "web-search").
   */
  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((t) => t.length >= 2);
  }
}
