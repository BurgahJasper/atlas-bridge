# Atlas Bridge infrastructure

Backing services only — Atlas Bridge v1 apps run on the host (TRD §10.2).
Compose ships Postgres 16 (fact store) and Redis 7 (reserved for the v1.5
distributed queue; analysis runs on an in-process queue today, TRD §4/§10.2).

## Pull up Postgres (+ optional Redis)

```bash
cd infra
docker compose up -d
```

## Apply the schema

The schema (`postgres/schema.sql`) is auto-applied on first container start
via the `docker-entrypoint-initdb.d` hook. To apply it manually to a running
database:

```bash
psql -h localhost -U atlasbridge -d atlasbridge -f postgres/schema.sql
# password: atlasbridge (dev only; override POSTGRES_PASSWORD for real runs)
```

## Point the worker at Postgres

```bash
DATABASE_URL=postgresql://atlasbridge:atlasbridge@localhost:5432/atlasbridge \
npm run dev:worker
```

No `DATABASE_URL` → the in-memory store is used (demo/local mode).

## Redis

Not wired for v1. Reserved for the distributed analysis queue in v1.5
(TRD §10.2 phase A); `REDIS_URL` is already part of the shared env contract
(`.env.example`) so nothing needs to move when the queue ships.

## Resets

`docker compose down -v` wipes the `pgdata` volume. All Atlas Bridge data is
derived from GitHub facts and can be rebuilt with re-analysis — nothing here
is the only copy.
