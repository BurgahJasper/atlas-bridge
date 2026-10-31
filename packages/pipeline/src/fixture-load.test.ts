import { describe, expect, it } from 'vitest';
import { hasCuratedFixture, loadCuratedFixture } from './fixture-load.js';

describe('curated fixture loader (TRD §10.1.2)', () => {
  it('loads the in-repo sample fixture from disk', () => {
    const fixture = loadCuratedFixture('sample');
    expect(fixture).not.toBeNull();
    expect(fixture?.repository.owner).toBe('sample-org');
    expect(fixture?.repository.name).toBe('sample-repo');
    expect(fixture?.milestones.length).toBeGreaterThan(0);
    expect(hasCuratedFixture('sample')).toBe(true);
  });

  it('fails gracefully for unknown or malformed fixtures', () => {
    expect(loadCuratedFixture('does-not-exist')).toBeNull();
    expect(hasCuratedFixture('does-not-exist')).toBe(false);
    expect(loadCuratedFixture('../')).toBeNull(); // directory traversal -> null
  });

  it('validates the real curated fixture shape when it has been generated', () => {
    const fixture = loadCuratedFixture('octokit-request-js');
    if (fixture === null) {
      // The seed script (`npm run seed`) generates this file; until then the
      // pipeline simply falls back to the live GitHub client.
      expect(hasCuratedFixture('octokit-request-js')).toBe(false);
      return;
    }
    expect(fixture.repository.owner).toBe('octokit');
    expect(fixture.commits.length).toBeGreaterThan(0);
    expect(fixture.trees).toBeTruthy();
  });
});
