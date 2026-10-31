import { Pool, type PoolClient } from 'pg';
import type {
  AnalysisJob,
  Contribution,
  Explanation,
  GraphSnapshot,
  LearnerProgress,
  Milestone,
  Mission,
  Repository,
  Snapshot,
} from '@atlas/contracts';
import type { Store } from '@atlas/contracts';

/**
 * Postgres-backed Store (TRD §6, §14: Postgres with JSONB + derived
 * metadata). Reads/writes whole JSON documents per row keyed by id; the
 * schema (infra/postgres/schema.sql) keeps one JSONB `data` column per
 * entity plus searchable key columns.
 */
export function createPgStore(connectionString: string): Store {
  const pool = new Pool({ connectionString });

  async function getJson<T>(client: PoolClient, table: string, idCol: string, id: string): Promise<T | null> {
    const res = await client.query(`SELECT data FROM ${table} WHERE ${idCol} = $1`, [id]);
    if (res.rows.length === 0) return null;
    return res.rows[0]!.data as T;
  }

  async function putJson(client: PoolClient, table: string, idCol: string, id: string, data: unknown) {
    await client.query(
      `INSERT INTO ${table} (${idCol}, data) VALUES ($1, $2)
       ON CONFLICT (${idCol}) DO UPDATE SET data = $2`,
      [id, JSON.stringify(data)],
    );
  }

  return {
    async getRepository(id) {
      const c = await pool.connect();
      try {
        return await getJson<Repository>(c, 'repositories', 'id', id);
      } finally {
        c.release();
      }
    },
    async getRepositoryBySlug(owner, name) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT data FROM repositories WHERE lower(data->>'owner') = $1 AND lower(data->>'name') = $2`,
          [owner.toLowerCase(), name.toLowerCase()],
        );
        return (res.rows[0]?.data as Repository) ?? null;
      } finally {
        c.release();
      }
    },
    async putRepository(repo) {
      const c = await pool.connect();
      try {
        await putJson(c, 'repositories', 'id', repo.id, repo);
      } finally {
        c.release();
      }
    },

    async getSnapshot(id) {
      const c = await pool.connect();
      try {
        return await getJson<Snapshot>(c, 'snapshots', 'id', id);
      } finally {
        c.release();
      }
    },
    async getSnapshotsForRepository(repositoryId) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT data FROM snapshots WHERE data->>'repositoryId' = $1 ORDER BY data->>'time' ASC`,
          [repositoryId],
        );
        return res.rows.map((r) => r.data as Snapshot);
      } finally {
        c.release();
      }
    },
    async getSnapshotBySha(repositoryId, sha) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT data FROM snapshots WHERE data->>'repositoryId' = $1 AND data->>'sha' LIKE $2`,
          [repositoryId, `${sha}%`],
        );
        return (res.rows[0]?.data as Snapshot) ?? null;
      } finally {
        c.release();
      }
    },
    async putSnapshot(snapshot) {
      const c = await pool.connect();
      try {
        await putJson(c, 'snapshots', 'id', snapshot.id, snapshot);
      } finally {
        c.release();
      }
    },
    async putSnapshots(list) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const s of list) await putJson(c, 'snapshots', 'id', s.id, s);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },

    async getMilestones(repositoryId) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT data FROM milestones WHERE data->>'repositoryId' = $1 ORDER BY rank ASC`,
          [repositoryId],
        );
        return res.rows.map((r) => r.data as Milestone);
      } finally {
        c.release();
      }
    },
    async putMilestones(list) {
      if (list.length === 0) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const m of list) await putJson(c, 'milestones', 'id', m.id, m);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },

    async getMissions(repoId) {
      const c = await pool.connect();
      try {
        const res = await c.query(`SELECT data FROM missions WHERE data->>'repoId' = $1`, [repoId]);
        return res.rows.map((r) => r.data as Mission);
      } finally {
        c.release();
      }
    },
    async getMission(id) {
      const c = await pool.connect();
      try {
        return await getJson<Mission>(c, 'missions', 'id', id);
      } finally {
        c.release();
      }
    },
    async putMissions(list) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const m of list) await putJson(c, 'missions', 'id', m.id, m);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },

    async getExplanation(key) {
      const c = await pool.connect();
      try {
        return await getJson<Explanation>(c, 'explanations', 'cache_key', key);
      } finally {
        c.release();
      }
    },
    async putExplanation(key, explanation) {
      const c = await pool.connect();
      try {
        await putJson(c, 'explanations', 'cache_key', key, explanation);
      } finally {
        c.release();
      }
    },

    async getJob(id) {
      const c = await pool.connect();
      try {
        return await getJson<AnalysisJob>(c, 'analysis_jobs', 'id', id);
      } finally {
        c.release();
      }
    },
    async putJob(job) {
      const c = await pool.connect();
      try {
        await putJson(c, 'analysis_jobs', 'id', job.id, job);
      } finally {
        c.release();
      }
    },

    async getProgress(userOrAnonymousId, missionId) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT data FROM learner_progress WHERE data->>'userOrAnonymousId' = $1 AND data->>'missionId' = $2`,
          [userOrAnonymousId, missionId],
        );
        return (res.rows[0]?.data as LearnerProgress) ?? null;
      } finally {
        c.release();
      }
    },
    async putProgress(p) {
      const c = await pool.connect();
      try {
        const res = await c.query(
          `SELECT id FROM learner_progress WHERE data->>'userOrAnonymousId' = $1 AND data->>'missionId' = $2`,
          [p.userOrAnonymousId, p.missionId],
        );
        if (res.rows.length > 0) {
          await c.query(`UPDATE learner_progress SET data = $2 WHERE id = $1`, [res.rows[0]!.id, JSON.stringify(p)]);
        } else {
          await c.query(`INSERT INTO learner_progress (id, data) VALUES ($1, $2)`, [p.id, JSON.stringify(p)]);
        }
      } finally {
        c.release();
      }
    },

    async getGraph(key) {
      const c = await pool.connect();
      try {
        return await getJson<GraphSnapshot>(c, 'graphs', 'cache_key', key);
      } finally {
        c.release();
      }
    },
    async putGraph(key, graph) {
      const c = await pool.connect();
      try {
        await putJson(c, 'graphs', 'cache_key', key, graph);
      } finally {
        c.release();
      }
    },

    async getContribution(id) {
      const c = await pool.connect();
      try {
        return await getJson<Contribution>(c, 'contributions', 'id', id);
      } finally {
        c.release();
      }
    },
    async putContribution(contribution) {
      const c = await pool.connect();
      try {
        await putJson(c, 'contributions', 'id', contribution.id, contribution);
      } finally {
        c.release();
      }
    },
  };
}
