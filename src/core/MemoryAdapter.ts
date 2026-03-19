import type { McpServiceListManager } from "./McpServiceListManager";
import type { KnowledgeDbStore } from "./KnowledgeDbStore";
import type { CostSummary, ServiceHealthRecord } from "./types";

export interface AgentHealthSummary {
  agentId: string;
  status: "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  serviceHealths: ServiceHealthRecord[];
  lastCheckedAt: string;
}

export interface AgentCostSummary {
  agentId: string;
  totalCost: number;
  dailyBudget?: number;
  budgetUsedFraction?: number;
  alertThreshold?: number;
  isOverBudget: boolean;
  isNearAlert: boolean;
}

export interface KnowledgeEntry {
  id: string;
  agentId: string;
  content: string;
  confidence: number;
  createdAt: string;
  /** ISO timestamp after which this entry may be purged by autoRetire. */
  expiresAt?: string;
  tags?: string[];
}

export class MemoryAdapter {
  /** In-memory K-DB stub — replace with real storage backend. */
  private knowledgeDb = new Map<string, KnowledgeEntry[]>();

  constructor(
    private readonly manager: McpServiceListManager,
    private readonly store?: KnowledgeDbStore,
  ) {}

  /**
   * Get agent-level health summary by aggregating service-level health.
   */
  getAgentHealth(agentId: string): AgentHealthSummary {
    const agent = this.manager.getAgent(agentId);
    const config = agent?.memory?.healthMonitoring;
    const serviceHealths = this.manager.getAllServiceHealths?.() ?? [];

    const degradedThreshold = config?.degradedThreshold ?? 3;
    const downThreshold = config?.downThreshold ?? 5;

    // Filter to services used by this agent
    const agentServices = agent?.allowedServices;
    const relevantHealths = agentServices
      ? serviceHealths.filter((h) => agentServices.includes(h.serviceName))
      : serviceHealths;

    const maxFailures = Math.max(0, ...relevantHealths.map((h) => h.consecutiveFailures));

    let status: AgentHealthSummary["status"];
    if (maxFailures >= downThreshold) {
      status = "down";
    } else if (maxFailures >= degradedThreshold) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return {
      agentId,
      status,
      consecutiveFailures: maxFailures,
      serviceHealths: relevantHealths,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  /**
   * Get cost summary for an agent, applying memory config budget limits.
   */
  getAgentCostSummary(agentId: string, costSummary: CostSummary): AgentCostSummary {
    const agent = this.manager.getAgent(agentId);
    const config = agent?.memory?.costTracking;

    const agentCost = costSummary.byAgent?.[agentId]?.cost ?? 0;
    const dailyBudget = config?.dailyBudget;
    const alertThreshold = config?.alertThreshold ?? 0.8;

    const budgetUsedFraction = dailyBudget ? agentCost / dailyBudget : undefined;
    const isOverBudget = dailyBudget ? agentCost > dailyBudget : false;
    const isNearAlert =
      budgetUsedFraction !== undefined ? budgetUsedFraction >= alertThreshold : false;

    return {
      agentId,
      totalCost: agentCost,
      dailyBudget,
      budgetUsedFraction,
      alertThreshold,
      isOverBudget,
      isNearAlert,
    };
  }

  /**
   * Extract a knowledge trace from execution result and store in K-DB.
   * Returns the entry if stored, or null if knowledge DB is disabled or
   * confidence is below the auto-promote threshold.
   *
   * When a `KnowledgeDbStore` is injected, also runs lazy autoRetire cleanup
   * based on `autoRetireAfterMinutes` config.
   */
  extractTrace(
    agentId: string,
    content: string,
    confidence: number,
    tags?: string[]
  ): KnowledgeEntry | null {
    const agent = this.manager.getAgent(agentId);
    const config = agent?.memory?.knowledgeDb;
    if (!config?.enabled) return null;

    const now = new Date();
    const expiresAt = config.autoRetireAfterMinutes !== undefined
      ? new Date(now.getTime() + config.autoRetireAfterMinutes * 60_000).toISOString()
      : undefined;

    const entry: KnowledgeEntry = {
      id: `kdb-${agentId}-${Date.now()}`,
      agentId,
      content,
      confidence,
      createdAt: now.toISOString(),
      expiresAt,
      tags,
    };

    const existing = this.knowledgeDb.get(agentId) ?? [];

    // Auto-promote: undefined threshold means always promote; otherwise check confidence.
    const shouldPromote =
      config.autoPromoteThreshold === undefined ||
      confidence >= config.autoPromoteThreshold;
    if (shouldPromote) {
      if (this.store) {
        // Lazy cleanup: purge expired entries before inserting the new one.
        this.store.deleteExpired(agentId);
        this.store.insert(agentId, entry);
        const maxEntries = config.maxEntries ?? 1000;
        this.store.prune(agentId, maxEntries);
      } else {
        existing.push(entry);
        // Prune if over max
        const maxEntries = config.maxEntries ?? 1000;
        while (existing.length > maxEntries) existing.shift();
        this.knowledgeDb.set(agentId, existing);
      }
      return entry;
    }

    return null;
  }

  /**
   * Look up similar knowledge entries for RAG retrieval.
   * Uses simple keyword matching; replace with embedding-based similarity in production.
   */
  lookupSimilar(agentId: string, query: string, topK = 5): KnowledgeEntry[] {
    if (this.store) {
      return this.store.query(agentId, query, topK);
    }
    const entries = this.knowledgeDb.get(agentId) ?? [];
    const q = query.toLowerCase();
    return entries.filter((e) => e.content.toLowerCase().includes(q)).slice(0, topK);
  }

  getKnowledgeDb(agentId: string): KnowledgeEntry[] {
    if (this.store) {
      return this.store.query(agentId, "", 10000);
    }
    return [...(this.knowledgeDb.get(agentId) ?? [])];
  }
}
