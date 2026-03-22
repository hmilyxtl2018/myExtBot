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
  /** ISO timestamp when this entry was soft-deleted (retired). Undefined for active entries. */
  retiredAt?: string;
  tags?: string[];
}

export class MemoryAdapter {
  /** In-memory K-DB stub — replace with real storage backend. */
  private knowledgeDb = new Map<string, KnowledgeEntry[]>();

  /** Handle returned by setInterval for the background auto-retire sweep. */
  private sweepIntervalHandle: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly manager: McpServiceListManager,
    private readonly store?: KnowledgeDbStore,
  ) {}

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * Remove expired entries from the in-memory Map for `agentId`.
   * Only entries where `expiresAt` is defined and in the past are removed.
   */
  private purgeExpiredInMemory(agentId: string): void {
    const entries = this.knowledgeDb.get(agentId);
    if (!entries) return;
    const now = Date.now();
    const active = entries.filter(
      (e) => e.expiresAt === undefined || new Date(e.expiresAt).getTime() > now,
    );
    this.knowledgeDb.set(agentId, active);
  }

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
        // In-memory path: purge expired entries before inserting.
        this.purgeExpiredInMemory(agentId);
        const current = this.knowledgeDb.get(agentId) ?? [];
        current.push(entry);
        // Prune if over max
        const maxEntries = config.maxEntries ?? 1000;
        while (current.length > maxEntries) current.shift();
        this.knowledgeDb.set(agentId, current);
      }
      return entry;
    }

    return null;
  }

  /**
   * Look up similar knowledge entries for RAG retrieval.
   * Uses simple keyword matching; replace with embedding-based similarity in production.
   * Expired entries are filtered out on both the SQLite and in-memory paths.
   */
  lookupSimilar(agentId: string, query: string, topK = 5): KnowledgeEntry[] {
    if (this.store) {
      return this.store.query(agentId, query, topK);
    }
    this.purgeExpiredInMemory(agentId);
    const entries = this.knowledgeDb.get(agentId) ?? [];
    const q = query.toLowerCase();
    return entries.filter((e) => e.content.toLowerCase().includes(q)).slice(0, topK);
  }

  getKnowledgeDb(agentId: string): KnowledgeEntry[] {
    if (this.store) {
      return this.store.query(agentId, "", 10000);
    }
    this.purgeExpiredInMemory(agentId);
    return [...(this.knowledgeDb.get(agentId) ?? [])];
  }

  // ── Background auto-retire sweep ──────────────────────────────────────────

  /**
   * Start a periodic background sweep that soft-deletes expired entries for
   * every registered agent that has `autoRetireAfterMinutes` configured.
   *
   * @param intervalMs  Sweep interval in milliseconds.  Defaults to 5 minutes.
   * @returns           `this` for chaining.
   */
  startAutoRetireSweep(intervalMs = 5 * 60_000): this {
    this.stopAutoRetireSweep();
    this.sweepIntervalHandle = setInterval(() => {
      const agents = this.manager.listAgents?.() ?? [];
      for (const agent of agents) {
        if (agent.memory?.knowledgeDb?.autoRetireAfterMinutes !== undefined) {
          if (this.store) {
            this.store.deleteExpired(agent.id);
          } else {
            this.purgeExpiredInMemory(agent.id);
          }
        }
      }
    }, intervalMs);
    // Allow the Node.js process to exit even if the interval is still running.
    this.sweepIntervalHandle.unref();
    return this;
  }

  /**
   * Stop the background auto-retire sweep started by `startAutoRetireSweep()`.
   */
  stopAutoRetireSweep(): void {
    if (this.sweepIntervalHandle !== undefined) {
      clearInterval(this.sweepIntervalHandle);
      this.sweepIntervalHandle = undefined;
    }
  }
}
