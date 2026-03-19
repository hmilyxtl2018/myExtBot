import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import type { KnowledgeEntry } from "./MemoryAdapter";

interface KnowledgeRow {
  id: number;
  agentId: string;
  content: string;
  source: string | null;
  score: number;
  createdAt: string;
  expiresAt: string | null;
  metadata: string | null;
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
        metadata  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_entries_agentId
        ON knowledge_entries (agentId);
    `);
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
   */
  insert(agentId: string, entry: KnowledgeEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_entries (agentId, content, source, score, createdAt, expiresAt, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agentId,
      entry.content,
      null,
      entry.confidence,
      entry.createdAt,
      entry.expiresAt ?? null,
      entry.tags ? JSON.stringify(entry.tags) : null,
    );
  }

  /**
   * Return up to `topK` entries for `agentId` whose content contains
   * `keyword` (case-insensitive LIKE), ordered by score DESC then createdAt DESC.
   */
  query(agentId: string, keyword: string, topK: number): KnowledgeEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE agentId = ? AND content LIKE ?
      ORDER BY score DESC, createdAt DESC
      LIMIT ?
    `);
    const rows = stmt.all(agentId, `%${keyword}%`, topK) as KnowledgeRow[];
    return rows.map((row) => this.rowToEntry(row));
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
   * Delete all entries for `agentId` (or all agents when omitted) whose
   * `expiresAt` timestamp is in the past.  No-op for entries without an
   * `expiresAt` value (they never expire).
   */
  deleteExpired(agentId?: string): void {
    const now = new Date().toISOString();
    if (agentId !== undefined) {
      this.db.prepare(`
        DELETE FROM knowledge_entries
        WHERE agentId = ? AND expiresAt IS NOT NULL AND expiresAt <= ?
      `).run(agentId, now);
    } else {
      this.db.prepare(`
        DELETE FROM knowledge_entries
        WHERE expiresAt IS NOT NULL AND expiresAt <= ?
      `).run(now);
    }
  }

  /**
   * Return all entries for `agentId` (or all agents when omitted), ordered
   * by score DESC then createdAt DESC.  Useful for inspection / admin tooling.
   */
  list(agentId?: string): KnowledgeEntry[] {
    if (agentId !== undefined) {
      const rows = this.db.prepare(`
        SELECT * FROM knowledge_entries
        WHERE agentId = ?
        ORDER BY score DESC, createdAt DESC
      `).all(agentId) as KnowledgeRow[];
      return rows.map((row) => this.rowToEntry(row));
    }
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_entries
      ORDER BY score DESC, createdAt DESC
    `).all() as KnowledgeRow[];
    return rows.map((row) => this.rowToEntry(row));
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
      tags: row.metadata ? (JSON.parse(row.metadata) as string[]) : undefined,
    };
  }
}
