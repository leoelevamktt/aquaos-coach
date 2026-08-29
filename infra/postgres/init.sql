CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'coach', 'athlete')),
  athlete_id TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  birth_date DATE,
  primary_stroke TEXT,
  level TEXT,
  group_ids JSONB NOT NULL DEFAULT '[]',
  avatar_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  sport_context TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  pool_id TEXT,
  blocks JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  workout_template_id TEXT NOT NULL REFERENCES workout_templates(id),
  workout_version INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  athlete_overrides JSONB NOT NULL DEFAULT '[]',
  published_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE IF NOT EXISTS completed_workouts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  prescription_id TEXT,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  distance_meters INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  completed_steps INTEGER NOT NULL,
  total_steps INTEGER NOT NULL,
  average_heart_rate INTEGER,
  average_pace_seconds_per_100m INTEGER,
  rpe NUMERIC,
  source TEXT NOT NULL,
  external_id TEXT,
  raw_payload JSONB,
  UNIQUE (organization_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS wellness_checkins (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  date DATE NOT NULL,
  sleep_hours NUMERIC,
  fatigue NUMERIC,
  soreness NUMERIC,
  pain NUMERIC,
  note TEXT,
  UNIQUE (athlete_id, date)
);

CREATE TABLE IF NOT EXISTS load_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  date DATE NOT NULL,
  value NUMERIC NOT NULL,
  acute NUMERIC NOT NULL,
  chronic NUMERIC NOT NULL,
  components JSONB NOT NULL,
  explanation TEXT NOT NULL,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (athlete_id, provider)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES device_connections(id),
  provider TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  external_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organizations (id, name) VALUES ('org-demo', 'Natação Performance') ON CONFLICT DO NOTHING;
