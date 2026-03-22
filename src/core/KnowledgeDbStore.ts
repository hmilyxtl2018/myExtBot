import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import type { KnowledgeEntry } from "./MemoryAdapter";
import { cosineSimilarity } from "./vectorUtils";

interface KnowledgeRow {
  id: number;
  agentId: string;
  content: string;
  source: string | null;
  score: number;
  createdAt: string;
  expiresAt: string | null;
  metadata: string | null;
  retiredAt: string | null;
  /** JSON-serialised Float32 array, or null if no embedding is stored. */
  embedding: string | null;
}

/**
 * SQLite-backed persistence layer for the Knowledge Database (K-DB).
 * Use `:memory:` as the dbPath in tests to avoid disk I/O.
 */
export class KnowledgeDbStore {
  private db!: Database.Database;

  /**
   * Open (or create) the SQLite database and create the knowledge_entries
   * table + index if they do not already exist.
   *
   * For on-disk paths the parent directory is created automatically and the
   * database file is restricted to owner read/write only (mode 0o600).
   *
   * @throws {Error} if `dbPath` is not `:memory:` and contains path-traversal
   *   sequences (`..`) or is an absolute path outside the working directory.
   */
  init(dbPath: string): void {
    if (dbPath !== ":memory:") {
      const normalized = path.normalize(dbPath);
      // Reject paths that contain traversal components.
      if (normalized.includes("..")) {
        throw new Error(`Invalid database path: "${dbPath}"`);
      }
      // Create parent directory if needed.
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      // Restrict the DB file to owner read/write only.
      try {
        fs.chmodSync(dbPath, 0o600);
      } catch {
        // Non-fatal: file may not yet exist on some platforms until first write.
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        agentId   TEXT    NOT NULL,
        content   TEXT    NOT NULL,
        source    TEXT,
        score     REAL    DEFAULT 0,
        createdAt TEXT    NOT NULL,
        expiresAt TEXT,
        metadata  TEXT,
        retiredAt TEXT,
        embedding TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_entries_agentId
        ON knowledge_entries (agentId);
    `);
    // Add columns to existing databases that pre-date this schema version.
    for (const col of ["retiredAt TEXT", "embedding TEXT"]) {
      try {
        this.db.exec(`ALTER TABLE knowledge_entries ADD COLUMN ${col}`);
      } catch {
        // Column already exists — safe to ignore.
      }
    }
    if (dbPath !== ":memory:") {
      // Ensure permissions are set after table creation (SQLite may rewrite the file).
      try {
        fs.chmodSync(dbPath, 0o600);
      } catch {
        // Non-fatal.
      }
    }
  }

  /**
   * Insert a KnowledgeEntry for the given agent.
   * `entry.confidence` is stored in the `score` column.
   * `entry.tags` is serialised as JSON in `metadata`.
   * `entry.expiresAt` is stored in the `expiresAt` column.
   *
   * @param embedding  Optional embedding vector to store alongside the entry.
   */
  insert(agentId: string, entry: KnowledgeEntry, embedding?: number[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_entries (agentId, content, source, score, createdAt, expiresAt, metadata, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agentId,
      entry.content,
      null,
      entry.confidence,
      entry.createdAt,
      entry.expiresAt ?? null,
      entry.tags ? JSON.stringify(entry.tags) : null,
      embedding ? JSON.stringify(embedding) : null,
    );
  }

  /**
   * Insert a KnowledgeEntry together with its embedding vector.
   * Convenience wrapper around `insert()` that makes the embedding mandatory.
   */
  insertWithEmbedding(agentId: string, entry: KnowledgeEntry, embedding: number[]): void {
    this.insert(agentId, entry, embedding);
  }

  /**
   * Return up to `topK` entries for `agentId` ranked by cosine similarity to
   * `queryEmbedding`.  Only entries that have a stored embedding are considered.
   * Excludes soft-deleted (retired) entries and entries whose `expiresAt` is in
   * the past.
   *
   * Cosine similarity is computed in application code because `better-sqlite3`
   * does not natively support vector operations.  For datasets with millions of
   * entries consider `sqlite-vss` or an external vector DB instead.
   */
  searchSemantic(agentId: string, queryEmbedding: number[], topK: number): KnowledgeEntry[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE agentId = ?
        AND embedding IS NOT NULL
        AND (retiredAt IS NULL)
        AND (expiresAt IS NULL OR expiresAt > ?)
    `).all(agentId, now) as KnowledgeRow[];

    if (rows.length === 0) return [];

    const scored = rows.map((row) => {
      const emb = JSON.parse(row.embedding!) as number[];
      const sim = cosineSimilarity(queryEmbedding, emb);
      return { entry: this.rowToEntry(row), sim };
    });

    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, topK).map((item) => item.entry);
  }

  /**
   * Return up to `topK` entries for `agentId` whose content contains
   * `keyword` (case-insensitive LIKE), ordered by score DESC then createdAt DESC.
   * Excludes soft-deleted (retired) entries and entries whose `expiresAt` is in
   * the past, so no explicit `deleteExpired()` call is required on the read path.
   */
  query(agentId: string, keyword: string, topK: number): KnowledgeEntry[] {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE agentId = ? AND content LIKE ?
        AND (retiredAt IS NULL)
        AND (expiresAt IS NULL OR expiresAt > ?)
      ORDER BY score DESC, createdAt DESC
      LIMIT ?
    `);
    const rows = stmt.all(agentId, `%${keyword}%`, now, topK) as KnowledgeRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Like `searchSemantic()` but also returns the raw cosine-similarity score
   * for each result.  Used internally by `MemoryAdapter.lookupHybrid()`.
   */
  searchSemanticWithScores(
    agentId: string,
    queryEmbedding: number[],
    topK: number,
  ): Array<{ entry: KnowledgeEntry; score: number }> {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE agentId = ?
        AND embedding IS NOT NULL
        AND (retiredAt IS NULL)
        AND (expiresAt IS NULL OR expiresAt > ?)
    `).all(agentId, now) as KnowledgeRow[];

    if (rows.length === 0) return [];

    const scored = rows.map((row) => {
      const emb = JSON.parse(row.embedding!) as number[];
      const score = cosineSimilarity(queryEmbedding, emb);
      return { entry: this.rowToEntry(row), score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Keep only the most recent `maxEntries` rows for `agentId`; delete older ones.
   */
  prune(agentId: string, maxEntries: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM knowledge_entries
      WHERE agentId = ?
        AND id NOT IN (
          SELECT id FROM knowledge_entries
          WHERE agentId = ?
          ORDER BY createdAt DESC, id DESC
          LIMIT ?
        )
    `);
    stmt.run(agentId, agentId, maxEntries);
  }

  /**
   * Soft-delete all entries for `agentId` (or all agents when omitted) whose
   * `expiresAt` timestamp is in the past by setting `retiredAt` to the current
   * UTC timestamp.  Entries without an `expiresAt` value never expire.
   * Soft-deleted entries are preserved for audit via `listRetired()` but are
   * excluded from `query()` and `list()` results.
   */
  deleteExpired(agentId?: string): void {
    const now = new Date().toISOString();
    if (agentId !== undefined) {
      this.db.prepare(`
        UPDATE knowledge_entries
        SET retiredAt = ?
        WHERE agentId = ? AND expiresAt IS NOT NULL AND expiresAt <= ?
          AND retiredAt IS NULL
      `).run(now, agentId, now);
    } else {
      this.db.prepare(`
        UPDATE knowledge_entries
        SET retiredAt = ?
        WHERE expiresAt IS NOT NULL AND expiresAt <= ?
          AND retiredAt IS NULL
      `).run(now, now);
    }
  }

  /**
   * Return all entries for `agentId` (or all agents when omitted), ordered
   * by score DESC then createdAt DESC.  Useful for inspection / admin tooling.
   *
   * By default, soft-deleted (retired) entries are excluded.  Pass
   * `includeRetired: true` to include them.
   */
  list(agentId?: string, options?: { includeRetired?: boolean }): KnowledgeEntry[] {
    const includeRetired = options?.includeRetired ?? false;
    if (agentId !== undefined) {
      const sql = includeRetired
        ? `SELECT * FROM knowledge_entries WHERE agentId = ? ORDER BY score DESC, createdAt DESC`
        : `SELECT * FROM knowledge_entries WHERE agentId = ? AND retiredAt IS NULL ORDER BY score DESC, createdAt DESC`;
      const rows = this.db.prepare(sql).all(agentId) as KnowledgeRow[];
      return rows.map((row) => this.rowToEntry(row));
    }
    const sql = includeRetired
      ? `SELECT * FROM knowledge_entries ORDER BY score DESC, createdAt DESC`
      : `SELECT * FROM knowledge_entries WHERE retiredAt IS NULL ORDER BY score DESC, createdAt DESC`;
    const rows = this.db.prepare(sql).all() as KnowledgeRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Return all soft-deleted (retired) entries for `agentId` (or all agents
   * when omitted), ordered by retiredAt DESC.  Useful for audit and inspection.
   */
  listRetired(agentId?: string): KnowledgeEntry[] {
    if (agentId !== undefined) {
      const rows = this.db.prepare(`
        SELECT * FROM knowledge_entries
        WHERE agentId = ? AND retiredAt IS NOT NULL
        ORDER BY retiredAt DESC
      `).all(agentId) as KnowledgeRow[];
      return rows.map((row) => this.rowToEntry(row));
    }
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE retiredAt IS NOT NULL
      ORDER BY retiredAt DESC
    `).all() as KnowledgeRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Permanently remove retired entries that were soft-deleted more than
   * `olderThanDays` days ago (default: 0, meaning all retired entries).
   * Returns the number of rows permanently deleted.
   */
  purgeRetired(olderThanDays = 0): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM knowledge_entries
      WHERE retiredAt IS NOT NULL AND retiredAt <= ?
    `).run(cutoff);
    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private rowToEntry(row: KnowledgeRow): KnowledgeEntry {
    return {
      id: `kdb-${row.agentId}-${row.id}`,
      agentId: row.agentId,
      content: row.content,
      confidence: row.score,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? undefined,
      retiredAt: row.retiredAt ?? undefined,
      tags: row.metadata ? (JSON.parse(row.metadata) as string[]) : undefined,
    };
  }
}
