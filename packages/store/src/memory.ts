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
 * In-memory Store (TRD §14 default: "Postgres metadata … TTL artifact store";
 * memory backend keeps the demo reproducible with zero infra). Durable
 * Postgres backend implements the same interface in pg.ts.
 */
export function createMemoryStore(): Store {
  const repos = new Map<string, Repository>();
  const reposBySlug = new Map<string, string>();
  const snapshots = new Map<string, Snapshot>();
  const snapshotsByRepo = new Map<string, string[]>();
  const milestones = new Map<string, Milestone[]>(); // by repositoryId
  const missions = new Map<string, Mission>();
  const missionsByRepo = new Map<string, string[]>();
  const explanations = new Map<string, Explanation>();
  const jobs = new Map<string, AnalysisJob>();
  const progress = new Map<string, LearnerProgress>(); // key: user+mission
  const contributions = new Map<string, Contribution>();
  const graphs = new Map<string, GraphSnapshot>();

  return {
    async getRepository(id) {
      return repos.get(id) ?? null;
    },
    async getRepositoryBySlug(owner, name) {
      const id = reposBySlug.get(`${owner.toLowerCase()}/${name.toLowerCase()}`);
      return id ? (repos.get(id) ?? null) : null;
    },
    async putRepository(repo) {
      repos.set(repo.id, repo);
      reposBySlug.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, repo.id);
    },

    async getSnapshot(id) {
      return snapshots.get(id) ?? null;
    },
    async getSnapshotsForRepository(repositoryId) {
      return (snapshotsByRepo.get(repositoryId) ?? [])
        .map((id) => snapshots.get(id))
        .filter((s): s is Snapshot => Boolean(s));
    },
    async getSnapshotBySha(repositoryId, sha) {
      return (
        (snapshotsByRepo.get(repositoryId) ?? [])
          .map((id) => snapshots.get(id))
          .filter((s): s is Snapshot => Boolean(s))
          .find((s) => s.sha.startsWith(sha)) ?? null
      );
    },
    async putSnapshot(snapshot) {
      snapshots.set(snapshot.id, snapshot);
      const list = snapshotsByRepo.get(snapshot.repositoryId) ?? [];
      if (!list.includes(snapshot.id)) list.push(snapshot.id);
      snapshotsByRepo.set(snapshot.repositoryId, list);
    },
    async putSnapshots(list) {
      for (const s of list) await this.putSnapshot(s);
    },

    async getMilestones(repositoryId) {
      return milestones.get(repositoryId) ?? [];
    },
    async putMilestones(list) {
      if (list.length === 0) return;
      milestones.set(list[0]!.repositoryId, list);
    },

    async getMissions(repoId) {
      return (missionsByRepo.get(repoId) ?? [])
        .map((id) => missions.get(id))
        .filter((m): m is Mission => Boolean(m));
    },
    async getMission(id) {
      return missions.get(id) ?? null;
    },
    async putMissions(list) {
      for (const m of list) {
        missions.set(m.id, m);
        const cur = missionsByRepo.get(m.repoId) ?? [];
        if (!cur.includes(m.id)) cur.push(m.id);
        missionsByRepo.set(m.repoId, cur);
      }
    },

    async getExplanation(cacheKey) {
      return explanations.get(cacheKey) ?? null;
    },
    async putExplanation(cacheKey, explanation) {
      explanations.set(cacheKey, explanation);
    },

    async getJob(id) {
      return jobs.get(id) ?? null;
    },
    async putJob(job) {
      jobs.set(job.id, job);
    },

    async getProgress(userOrAnonymousId, missionId) {
      return progress.get(`${userOrAnonymousId}:${missionId}`) ?? null;
    },
    async putProgress(p) {
      progress.set(`${p.userOrAnonymousId}:${p.missionId}`, p);
    },

    async getGraph(key) {
      return graphs.get(key) ?? null;
    },
    async putGraph(key, graph) {
      graphs.set(key, graph);
    },

    async getContribution(id) {
      return contributions.get(id) ?? null;
    },
    async putContribution(c) {
      contributions.set(c.id, c);
    },
  };
}
