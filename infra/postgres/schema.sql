-- Atlas Bridge Postgres schema (TRD §6, §14).
-- Repositories, snapshots, milestones, missions, explanations, analysis
-- jobs, learner progress and contributions are stored as consistent JSONB
-- documents matching @atlas/contracts entities exactly. The @atlas/store
-- pg backend owns lookups by slug / scope via `data->>` expressions on
-- these ids; migration stayed as the single unify boundary noted below.

-- NOTE (TRD §10.2 unification): table names below are canonical; do not
-- introduce extra tables outside packages/store without updating this file
-- and the corresponding store implementation in one change.

CREATE TABLE IF NOT EXISTS repositories (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
-- Repository-scoped listing (used by getSnapshotsForRepository via data->>'repositoryId')
CREATE INDEX IF NOT EXISTS snapshots_repository_idx
  ON snapshots ((data->>'repositoryId'));

CREATE TABLE IF NOT EXISTS milestones (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
-- Milestone ordering for /history lookups
CREATE INDEX IF NOT EXISTS milestones_repository_idx
  ON milestones ((data->>'repositoryId'), (data->>'rank'));

CREATE TABLE IF NOT EXISTS missions (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS missions_repository_idx
  ON missions ((data->>'repoId'));

CREATE TABLE IF NOT EXISTS explanations (
  cache_key TEXT PRIMARY KEY,
  data      JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS learner_progress (
  -- id is the composite "<userOrAnonymousId>:<missionId>" document key the
  -- store uses for getProgress lookups (data->> fields).
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

-- Per-milestone fact graphs, keyed "<repositoryId>:<sha>" (TRD §4.2 step 3).
CREATE TABLE IF NOT EXISTS graphs (
  cache_key TEXT PRIMARY KEY,
  data      JSONB NOT NULL
);
