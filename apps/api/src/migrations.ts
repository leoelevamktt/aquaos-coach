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

const BASE_MIGRATIONS: Migration[] = [
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

/**
 * Projeções relacionais das entidades do manual §7.1. O payload original é
 * mantido para compatibilidade/auditoria enquanto as colunas de domínio são
 * preenchidas progressivamente pelos jobs de projeção.
 */
function normalizedTable(table: string, columns = "") {
  const optionalColumns = columns.replace(/\s+NOT NULL/gi, "");
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    ${optionalColumns ? `,${optionalColumns}` : ""}
  );
  CREATE INDEX IF NOT EXISTS ${table}_organization_idx ON ${table} (organization_id, updated_at DESC);`;
}

const NORMALIZED_MIGRATIONS: Migration[] = [
  { id: "0007_teams", description: "Teams/tenants relacionais", up: normalizedTable("rkf_teams", "name TEXT"), down: "DROP TABLE IF EXISTS rkf_teams CASCADE;" },
  { id: "0008_athlete_profile", description: "Perfis e calibrações de atleta", up: `${normalizedTable("rkf_athlete_profiles", "athlete_id TEXT NOT NULL, specialty TEXT, development_level TEXT, pool_length_m SMALLINT")}
${normalizedTable("rkf_athlete_calibrations", "athlete_id TEXT NOT NULL, baseline_hrv NUMERIC, baseline_resting_hr NUMERIC")}`, down: "DROP TABLE IF EXISTS rkf_athlete_calibrations CASCADE; DROP TABLE IF EXISTS rkf_athlete_profiles CASCADE;" },
  { id: "0009_training_dictionary", description: "Zonas e regras de fadiga por distância", up: `${normalizedTable("rkf_training_zones", "code TEXT NOT NULL, label TEXT")}
${normalizedTable("rkf_distance_fatigue_rules", "specialty TEXT NOT NULL, phase TEXT NOT NULL")}`, down: "DROP TABLE IF EXISTS rkf_distance_fatigue_rules CASCADE; DROP TABLE IF EXISTS rkf_training_zones CASCADE;" },
  { id: "0010_cycle_hierarchy", description: "Macrociclos, mesociclos e microciclos", up: `${normalizedTable("rkf_macrocycles", "model TEXT, starts_on DATE, ends_on DATE")}
${normalizedTable("rkf_mesocycles", "macrocycle_id TEXT, phase TEXT, sequence_no INTEGER")}
${normalizedTable("rkf_microcycles", "mesocycle_id TEXT, week_no INTEGER, volume_target_m INTEGER")}`, down: "DROP TABLE IF EXISTS rkf_microcycles CASCADE; DROP TABLE IF EXISTS rkf_mesocycles CASCADE; DROP TABLE IF EXISTS rkf_macrocycles CASCADE;" },
  { id: "0011_training_library", description: "Sessões e blocos de biblioteca", up: `${normalizedTable("rkf_training_sessions", "macrocycle_id TEXT, primary_zone TEXT, volume_m INTEGER")}
${normalizedTable("rkf_session_blocks", "session_id TEXT NOT NULL, component TEXT, order_no INTEGER, volume_m INTEGER")}`, down: "DROP TABLE IF EXISTS rkf_session_blocks CASCADE; DROP TABLE IF EXISTS rkf_training_sessions CASCADE;" },
  { id: "0012_prescriptions", description: "Prescrições e blocos adaptados", up: `${normalizedTable("rkf_session_prescriptions", "session_id TEXT, athlete_id TEXT, version INTEGER, status TEXT")}
${normalizedTable("rkf_prescription_blocks", "prescription_id TEXT NOT NULL, component TEXT, order_no INTEGER, volume_m INTEGER")}`, down: "DROP TABLE IF EXISTS rkf_prescription_blocks CASCADE; DROP TABLE IF EXISTS rkf_session_prescriptions CASCADE;" },
  { id: "0013_execution_response", description: "Execução e resposta do atleta", up: `${normalizedTable("rkf_session_executions", "athlete_id TEXT, session_id TEXT, date DATE, duration_minutes NUMERIC, rpe NUMERIC")}
${normalizedTable("rkf_athlete_responses", "athlete_id TEXT, date DATE, readiness NUMERIC, pain NUMERIC, sleep_minutes NUMERIC")}`, down: "DROP TABLE IF EXISTS rkf_athlete_responses CASCADE; DROP TABLE IF EXISTS rkf_session_executions CASCADE;" },
  { id: "0014_readiness_adaptation", description: "Readiness e decisões adaptativas", up: `${normalizedTable("rkf_readiness_scores", "athlete_id TEXT, date DATE, score NUMERIC, confidence NUMERIC")}
${normalizedTable("rkf_adaptation_decisions", "athlete_id TEXT, decision_class TEXT, volume_factor NUMERIC, coach_id TEXT")}`, down: "DROP TABLE IF EXISTS rkf_adaptation_decisions CASCADE; DROP TABLE IF EXISTS rkf_readiness_scores CASCADE;" },
  { id: "0015_device_sync", description: "Amostras opcionais e jobs de sincronização", up: `${normalizedTable("rkf_device_samples", "athlete_id TEXT, provider TEXT, captured_at TIMESTAMPTZ, metric TEXT, value NUMERIC")}
${normalizedTable("rkf_sync_jobs", "athlete_id TEXT, provider TEXT, direction TEXT, status TEXT, external_id TEXT")}`, down: "DROP TABLE IF EXISTS rkf_sync_jobs CASCADE; DROP TABLE IF EXISTS rkf_device_samples CASCADE;" },
  { id: "0016_audit_events", description: "Eventos de auditoria imutáveis", up: normalizedTable("rkf_audit_events", "actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT"), down: "DROP TABLE IF EXISTS rkf_audit_events CASCADE;" },
  { id: "0017_voice_pipeline", description: "Ingestões e extrações de voz versionadas", up: `${normalizedTable("rkf_voice_ingestions", "athlete_id TEXT, audio_hash TEXT, state TEXT")}
${normalizedTable("rkf_voice_extractions", "ingestion_id TEXT, version INTEGER, confidence NUMERIC, confirmed_by TEXT")}`, down: "DROP TABLE IF EXISTS rkf_voice_extractions CASCADE; DROP TABLE IF EXISTS rkf_voice_ingestions CASCADE;" },
  { id: "0018_session_results", description: "Resultados de sessão e séries", up: `${normalizedTable("rkf_session_results", "athlete_id TEXT, date DATE, event TEXT, comparable_key TEXT")}
${normalizedTable("rkf_set_results", "session_result_id TEXT, set_no INTEGER, zone TEXT")}`, down: "DROP TABLE IF EXISTS rkf_set_results CASCADE; DROP TABLE IF EXISTS rkf_session_results CASCADE;" },
  { id: "0019_repetition_splits", description: "Repetições e parciais", up: `${normalizedTable("rkf_repetition_results", "set_result_id TEXT, repetition_no INTEGER, distance_m INTEGER, time_seconds NUMERIC")}
${normalizedTable("rkf_split_results", "repetition_result_id TEXT, distance_m INTEGER, time_seconds NUMERIC")}`, down: "DROP TABLE IF EXISTS rkf_split_results CASCADE; DROP TABLE IF EXISTS rkf_repetition_results CASCADE;" },
  { id: "0020_context_snapshots", description: "Snapshots imutáveis de contexto", up: normalizedTable("rkf_session_context_snapshots", "session_id TEXT, athlete_id TEXT, snapshot_hash TEXT"), down: "DROP TABLE IF EXISTS rkf_session_context_snapshots CASCADE;" },
  { id: "0021_performance_evolution", description: "Benchmarks e avaliações de evolução", up: `${normalizedTable("rkf_performance_benchmarks", "athlete_id TEXT, comparable_key TEXT, best_time_seconds NUMERIC")}
${normalizedTable("rkf_evolution_assessments", "athlete_id TEXT, comparable_key TEXT, classification TEXT, confidence NUMERIC")}`, down: "DROP TABLE IF EXISTS rkf_evolution_assessments CASCADE; DROP TABLE IF EXISTS rkf_performance_benchmarks CASCADE;" },
  { id: "0022_training_ingestions", description: "Entrada de treino e assets originais", up: `${normalizedTable("rkf_training_ingestions", "athlete_id TEXT, channel TEXT, state TEXT, confidence NUMERIC")}
${normalizedTable("rkf_training_source_assets", "ingestion_id TEXT, filename TEXT, sha256 TEXT, mime_type TEXT")}`, down: "DROP TABLE IF EXISTS rkf_training_source_assets CASCADE; DROP TABLE IF EXISTS rkf_training_ingestions CASCADE;" },
  { id: "0023_training_extraction_review", description: "Extrações e itens de revisão humana", up: `${normalizedTable("rkf_training_extractions", "ingestion_id TEXT, version INTEGER, format TEXT, confidence NUMERIC")}
${normalizedTable("rkf_training_review_items", "ingestion_id TEXT, field_name TEXT, status TEXT, reviewer_id TEXT")}`, down: "DROP TABLE IF EXISTS rkf_training_review_items CASCADE; DROP TABLE IF EXISTS rkf_training_extractions CASCADE;" },
  { id: "0024_imported_training", description: "Treino externo separado da biblioteca RKF", up: `${normalizedTable("rkf_imported_training_sessions", "ingestion_id TEXT, athlete_id TEXT, date DATE, external_trainer TEXT")}
${normalizedTable("rkf_imported_training_blocks", "imported_session_id TEXT, order_no INTEGER, volume_m INTEGER, zone TEXT")}`, down: "DROP TABLE IF EXISTS rkf_imported_training_blocks CASCADE; DROP TABLE IF EXISTS rkf_imported_training_sessions CASCADE;" },
  { id: "0025_session_assignments", description: "Atribuição atleta/equipe/grupo", up: normalizedTable("rkf_athlete_session_assignments", "athlete_id TEXT, session_id TEXT, target_type TEXT, target_id TEXT"), down: "DROP TABLE IF EXISTS rkf_athlete_session_assignments CASCADE;" },
  { id: "0026_load_calculations", description: "Cálculos de carga em camadas", up: normalizedTable("rkf_load_calculations", "athlete_id TEXT, date DATE, prescribed_m INTEGER, executed_m INTEGER, internal_load NUMERIC, atl NUMERIC, ctl NUMERIC, tsb NUMERIC"), down: "DROP TABLE IF EXISTS rkf_load_calculations CASCADE;" },
  { id: "0027_goal_records", description: "Metas de performance normalizadas", up: normalizedTable("rkf_goal_records", "athlete_id TEXT, event TEXT, current_time_seconds NUMERIC, target_time_seconds NUMERIC, deadline DATE"), down: "DROP TABLE IF EXISTS rkf_goal_records CASCADE;" },
  { id: "0028_meet_entries", description: "Competições e inscrições", up: normalizedTable("rkf_meet_entries", "meet_id TEXT, athlete_id TEXT, event TEXT, seed_time_seconds NUMERIC, status TEXT"), down: "DROP TABLE IF EXISTS rkf_meet_entries CASCADE;" },
  { id: "0029_media_assets", description: "Assets de vídeo e documentos", up: `${normalizedTable("rkf_video_assets", "athlete_id TEXT, filename TEXT, sha256 TEXT, analysis_status TEXT")}
${normalizedTable("rkf_document_assets", "athlete_id TEXT, reference_type TEXT, reference_id TEXT, filename TEXT, sha256 TEXT")}`, down: "DROP TABLE IF EXISTS rkf_document_assets CASCADE; DROP TABLE IF EXISTS rkf_video_assets CASCADE;" },
  { id: "0030_privacy_retention", description: "Consentimentos e políticas de retenção LGPD", up: `${normalizedTable("rkf_consents", "athlete_id TEXT, purpose TEXT, granted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ")}
${normalizedTable("rkf_retention_policies", "resource_kind TEXT, retention_days INTEGER, deletion_mode TEXT")}`, down: "DROP TABLE IF EXISTS rkf_retention_policies CASCADE; DROP TABLE IF EXISTS rkf_consents CASCADE;" },
  { id: "0031_idempotency_outbox", description: "Idempotência de writes e outbox de eventos", up: `${normalizedTable("rkf_idempotency_keys", "key TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB, UNIQUE (organization_id, key)")}
${normalizedTable("rkf_event_outbox", "event_name TEXT NOT NULL, event_version TEXT NOT NULL, published_at TIMESTAMPTZ")}`, down: "DROP TABLE IF EXISTS rkf_event_outbox CASCADE; DROP TABLE IF EXISTS rkf_idempotency_keys CASCADE;" },
];

export const MIGRATIONS: Migration[] = [...BASE_MIGRATIONS, ...NORMALIZED_MIGRATIONS];
