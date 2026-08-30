/**
 * Migrations versionadas e idempotentes do RKF Coach. Cada migration registra
 * a própria execução em schema_migrations; nenhuma roda duas vezes. O rollback
 * é declarado por down para evidência de recuperação (gate G05).
 */

export type Migration = {
  id: string;
  description: string;
  up: string;
  down?: string;
};

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_managed_resources",
    description: "Coleções gerenciáveis em JSONB por organização",
    up: `CREATE TABLE IF NOT EXISTS managed_resources (
      organization_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (organization_id, resource_kind, resource_id)
    );
    CREATE INDEX IF NOT EXISTS managed_resources_kind_idx
      ON managed_resources (organization_id, resource_kind, updated_at DESC);`,
    down: "DROP TABLE IF EXISTS managed_resources;",
  },
  {
    id: "0002_managed_audit",
    description: "Trilha de auditoria imutável por organização",
    up: `CREATE TABLE IF NOT EXISTS managed_audit (
      audit_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS managed_audit_org_idx
      ON managed_audit (organization_id, created_at DESC);`,
    down: "DROP TABLE IF EXISTS managed_audit;",
  },
  {
    id: "0003_auth_sessions",
    description: "Sessões autenticadas com hash do token e expiração",
    up: `CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);`,
    down: "DROP TABLE IF EXISTS auth_sessions;",
  },
  {
    id: "0004_rkf_seed_imports",
    description: "Importações transacionais da seed RKF V5.1",
    up: `CREATE TABLE IF NOT EXISTS rkf_seed_imports (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      version TEXT NOT NULL,
      package_hash TEXT NOT NULL,
      manifest JSONB NOT NULL,
      imported_by TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, version, package_hash)
    );`,
    down: "DROP TABLE IF EXISTS rkf_seed_imports;",
  },
  {
    id: "0005_rkf_seed_rows",
    description: "Linhas da seed preservadas por arquivo e índice",
    up: `CREATE TABLE IF NOT EXISTS rkf_seed_rows (
      import_id TEXT NOT NULL REFERENCES rkf_seed_imports(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY (import_id, entity_type, row_index)
    );
    CREATE INDEX IF NOT EXISTS rkf_seed_rows_entity_idx
      ON rkf_seed_rows (import_id, entity_type);`,
    down: "DROP TABLE IF EXISTS rkf_seed_rows;",
  },
  {
    id: "0006_auth_sessions_purge",
    description: "Rotina de expurgo de sessões vencidas (retenção mínima de credenciais)",
    up: `CREATE OR REPLACE FUNCTION purge_expired_auth_sessions() RETURNS void AS $$
      DELETE FROM auth_sessions WHERE expires_at <= now();
    $$ LANGUAGE sql;`,
    down: "DROP FUNCTION IF EXISTS purge_expired_auth_sessions();",
  },
];
