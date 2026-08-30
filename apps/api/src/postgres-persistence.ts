import { Pool } from "pg";
import type { AuditRecord, DatabaseShape, ResourceKind } from "./managed-store.js";

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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS managed_resources (
        organization_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (organization_id, resource_kind, resource_id)
      );
      CREATE INDEX IF NOT EXISTS managed_resources_kind_idx
        ON managed_resources (organization_id, resource_kind, updated_at DESC);
      CREATE TABLE IF NOT EXISTS managed_audit (
        audit_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS managed_audit_org_idx
        ON managed_audit (organization_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_payload JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
      CREATE TABLE IF NOT EXISTS rkf_seed_imports (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        version TEXT NOT NULL,
        package_hash TEXT NOT NULL,
        manifest JSONB NOT NULL,
        imported_by TEXT NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (organization_id, version, package_hash)
      );
      CREATE TABLE IF NOT EXISTS rkf_seed_rows (
        import_id TEXT NOT NULL REFERENCES rkf_seed_imports(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (import_id, entity_type, row_index)
      );
      CREATE INDEX IF NOT EXISTS rkf_seed_rows_entity_idx
        ON rkf_seed_rows (import_id, entity_type);
    `);
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
  async close() { await this.pool.end(); }
}
