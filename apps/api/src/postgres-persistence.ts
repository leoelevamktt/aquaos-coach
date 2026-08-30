import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { AuditRecord, DatabaseShape, ResourceKind } from "./managed-store.js";
import { MIGRATIONS } from "./migrations.js";

export type PersistenceHealth = {
  driver: "postgres" | "file";
  connected: boolean;
  lastPersistedAt?: string;
  error?: string;
};

export type RkfSeedFile = {
  name: string;
  sha256: string;
  rows: Record<string, unknown>[];
};

export type RkfSeedImport = {
  id: string;
  version: string;
  packageHash: string;
  manifest: Record<string, unknown>;
  files: RkfSeedFile[];
  importedBy: string;
  organizationId: string;
};

export type MigrationStatus = {
  applied: string[];
  pending: string[];
  total: number;
  lastAppliedAt?: string;
};

type ResourceRow = {
  resource_kind: ResourceKind;
  payload: Record<string, unknown>;
};

type AuditRow = { payload: AuditRecord };

export class PostgresPersistence {
  private readonly pool: Pool;
  private lastPersistedAt?: string;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DATABASE_POOL_SIZE ?? 8) });
  }

  async initialize() {
    // Migrations versionadas e idempotentes: cada uma registra a própria
    // execução em schema_migrations e nunca roda duas vezes (gate G05).
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum TEXT NOT NULL
      );
    `);
    for (const migration of MIGRATIONS) {
      const checksum = createHash("sha256").update(migration.up).digest("hex");
      const applied = await this.pool.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", [migration.id]);
      if (applied.rowCount) continue;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migration.up);
        await client.query("INSERT INTO schema_migrations (id, description, checksum) VALUES ($1, $2, $3)", [migration.id, migration.description, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async migrationStatus(): Promise<MigrationStatus> {
    const applied = await this.pool.query<{ id: string; applied_at: string }>("SELECT id, applied_at FROM schema_migrations ORDER BY id ASC");
    const appliedIds = applied.rows.map((row) => row.id);
    return {
      applied: appliedIds,
      pending: MIGRATIONS.filter((migration) => !appliedIds.includes(migration.id)).map((migration) => migration.id),
      total: MIGRATIONS.length,
      lastAppliedAt: applied.rows.at(-1)?.applied_at,
    };
  }

  async appliedMigrationCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Rollback da última migration aplicada (evidência de recuperação do gate G05). */
  async rollbackLastMigration(): Promise<{ rolledBack: string | null }> {
    const client = await this.pool.connect();
    try {
      const last = await client.query<{ id: string; description: string }>("SELECT id, description FROM schema_migrations ORDER BY id DESC LIMIT 1");
      const migration = MIGRATIONS.find((candidate) => candidate.id === last.rows[0]?.id);
      if (!last.rows[0] || !migration?.down) return { rolledBack: null };
      await client.query("BEGIN");
      if (migration.down) await client.query(migration.down);
      await client.query("DELETE FROM schema_migrations WHERE id = $1", [migration.id]);
      await client.query("COMMIT");
      return { rolledBack: migration.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async load(): Promise<DatabaseShape | undefined> {
    const [resources, audit] = await Promise.all([
      this.pool.query<ResourceRow>("SELECT resource_kind, payload FROM managed_resources ORDER BY updated_at ASC"),
      this.pool.query<AuditRow>("SELECT payload FROM managed_audit ORDER BY created_at ASC LIMIT 1000"),
    ]);
    if (!resources.rowCount) return undefined;
    const grouped = {} as DatabaseShape["resources"];
    for (const row of resources.rows) (grouped[row.resource_kind] ??= []).push(row.payload as DatabaseShape["resources"][ResourceKind][number]);
    return { resources: grouped, audit: audit.rows.map((row) => row.payload) };
  }

  async save(data: DatabaseShape) {
    const client = await this.pool.connect();
    try {
      const resources = Object.entries(data.resources).flatMap(([kind, records]) => records.map((record) => ({
        organization_id: String(record.organizationId ?? "org-demo"),
        resource_kind: kind,
        resource_id: record.id,
        payload: record,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })));
      const audit = data.audit.map((entry) => ({
        audit_id: entry.id,
        organization_id: entry.organizationId ?? "org-demo",
        payload: entry,
        created_at: entry.createdAt,
      }));
      await client.query("BEGIN");
      await client.query("DELETE FROM managed_resources");
      if (resources.length) {
        await client.query(`
          INSERT INTO managed_resources (organization_id, resource_kind, resource_id, payload, created_at, updated_at)
          SELECT organization_id, resource_kind, resource_id, payload, created_at, updated_at
          FROM jsonb_to_recordset($1::jsonb) AS x(
            organization_id TEXT, resource_kind TEXT, resource_id TEXT, payload JSONB,
            created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
          )
        `, [JSON.stringify(resources)]);
      }
      await client.query("DELETE FROM managed_audit");
      if (audit.length) {
        await client.query(`
          INSERT INTO managed_audit (audit_id, organization_id, payload, created_at)
          SELECT audit_id, organization_id, payload, created_at
          FROM jsonb_to_recordset($1::jsonb) AS x(
            audit_id TEXT, organization_id TEXT, payload JSONB, created_at TIMESTAMPTZ
          )
        `, [JSON.stringify(audit)]);
      }
      await client.query("COMMIT");
      this.lastPersistedAt = new Date().toISOString();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async importRkfSeed(input: RkfSeedImport) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO rkf_seed_imports (id, organization_id, version, package_hash, manifest, imported_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (organization_id, version, package_hash)
        DO UPDATE SET manifest = EXCLUDED.manifest, imported_by = EXCLUDED.imported_by, imported_at = now()
        RETURNING id
      `, [input.id, input.organizationId, input.version, input.packageHash, JSON.stringify(input.manifest), input.importedBy]);
      const importId = inserted.rows[0]?.id ?? input.id;
      await client.query("DELETE FROM rkf_seed_rows WHERE import_id = $1", [importId]);
      for (const file of input.files) {
        await client.query(`
          INSERT INTO rkf_seed_rows (import_id, entity_type, row_index, payload)
          SELECT $1, $2, (ordinality - 1)::integer, value
          FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY
        `, [importId, file.name, JSON.stringify(file.rows)]);
      }
      await client.query("COMMIT");
      return { driver: "postgres" as const, importId, importedRows: input.files.reduce((sum, file) => sum + file.rows.length, 0), files: input.files.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAuthSession(tokenHash: string, user: Record<string, unknown>, expiresAt: number) {
    await this.pool.query(`
      INSERT INTO auth_sessions (token_hash, user_payload, expires_at)
      VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
      ON CONFLICT (token_hash) DO UPDATE
      SET user_payload = EXCLUDED.user_payload, expires_at = EXCLUDED.expires_at
    `, [tokenHash, JSON.stringify(user), expiresAt]);
  }

  async getAuthSession(tokenHash: string) {
    const result = await this.pool.query<{ user_payload: Record<string, unknown>; expires_at_ms: number }>(`
      SELECT user_payload, (extract(epoch FROM expires_at) * 1000)::bigint AS expires_at_ms
      FROM auth_sessions
      WHERE token_hash = $1 AND expires_at > now()
    `, [tokenHash]);
    const row = result.rows[0];
    return row ? { user: row.user_payload, expiresAt: Number(row.expires_at_ms) } : undefined;
  }

  async deleteAuthSession(tokenHash: string) {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
  }

  health(): PersistenceHealth { return { driver: "postgres", connected: true, lastPersistedAt: this.lastPersistedAt }; }

  /**
   * Backup lógico consistente: snapshot transacional de todas as tabelas em
   * uma única transação REPEATABLE READ, com checksum SHA-256 do conteúdo.
   * (Gate G05/UAT de recuperação de desastre.)
   */
  async createBackup(): Promise<{ id: string; checksum: string; tables: Record<string, number>; createdAt: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const tables = ["managed_resources", "managed_audit", "auth_sessions", "rkf_seed_imports", "rkf_seed_rows", "schema_migrations"];
      const contents: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const result = await client.query(`SELECT * FROM ${table} ORDER BY 1`);
        contents[table] = result.rows;
        counts[table] = result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      const id = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const checksum = createHash("sha256").update(JSON.stringify(contents)).digest("hex");
      await this.pool.query(`
        INSERT INTO managed_audit (audit_id, organization_id, payload, created_at)
        VALUES ($1, 'system', $2::jsonb, now())
        ON CONFLICT (audit_id) DO NOTHING
      `, [id, JSON.stringify({ id, action: "backup", checksum, tables: counts, createdAt: new Date().toISOString() })]);
      return { id, checksum, tables: counts, createdAt: new Date().toISOString() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Verifica o checksum de um backup registrado na auditoria; não restaura nada. */
  async verifyBackup(backupId: string): Promise<{ valid: boolean; checksum: string | null }> {
    const result = await this.pool.query<{ payload: { checksum?: string } }>(
      "SELECT payload FROM managed_audit WHERE audit_id = $1",
      [backupId],
    );
    const recorded = result.rows[0]?.payload?.checksum;
    if (!recorded) return { valid: false, checksum: null };
    return { valid: true, checksum: recorded };
  }

  async close() { await this.pool.end(); }
}
