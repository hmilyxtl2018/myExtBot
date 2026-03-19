import Database from "better-sqlite3";
import type { KnowledgeEntry } from "./MemoryAdapter";

interface KnowledgeRow {
  id: number;
  agentId: string;
  content: string;
  source: string | null;
  score: number;
  createdAt: string;
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
   */
  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        agentId   TEXT    NOT NULL,
        content   TEXT    NOT NULL,
        source    TEXT,
        score     REAL    DEFAULT 0,
        createdAt TEXT    NOT NULL,
        metadata  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_entries_agentId
        ON knowledge_entries (agentId);
    `);
  }

  /**
   * Insert a KnowledgeEntry for the given agent.
   * `entry.confidence` is stored in the `score` column.
   * `entry.tags` is serialised as JSON in `metadata`.
   */
  insert(agentId: string, entry: KnowledgeEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_entries (agentId, content, source, score, createdAt, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agentId,
      entry.content,
      null,
      entry.confidence,
      entry.createdAt,
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
      tags: row.metadata ? (JSON.parse(row.metadata) as string[]) : undefined,
    };
  }
}
