import { describe, expect, it } from 'vitest';
import { parseGitHubRepoUrl } from './url.js';

describe('parseGitHubRepoUrl', () => {
  it('parses plain https repo URLs', () => {
    expect(parseGitHubRepoUrl('https://github.com/octocat/spoon-knife')).toEqual({
      owner: 'octocat',
      name: 'spoon-knife',
    });
  });

  it('trims surrounding whitespace and accepts case-insensitive host', () => {
    expect(parseGitHubRepoUrl('  https://GitHub.com/Octo/Cat-1.dev  ')).toEqual({
      owner: 'Octo',
      name: 'Cat-1.dev',
    });
  });

  it('strips an optional .git suffix', () => {
    expect(parseGitHubRepoUrl('https://github.com/octo/repo.git')).toEqual({
      owner: 'octo',
      name: 'repo',
    });
  });

  it('accepts deep tree/blob permalink paths and strips them', () => {
    expect(parseGitHubRepoUrl('https://github.com/octo/repo/tree/main/extra/deep')).toEqual({
      owner: 'octo',
      name: 'repo',
    });
    expect(parseGitHubRepoUrl('https://github.com/octo/repo/blob/main/src/index.ts')).toEqual({
      owner: 'octo',
      name: 'repo',
    });
  });

  it('rejects http (non-https)', () => {
    expect(parseGitHubRepoUrl('http://github.com/octo/repo')).toBeNull();
  });

  it('rejects localhost and IP hosts', () => {
    expect(parseGitHubRepoUrl('https://localhost/octo/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://127.0.0.1/octo/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://[::1]/octo/repo')).toBeNull();
  });

  it('rejects non-github hosts', () => {
    expect(parseGitHubRepoUrl('https://evil.com/x/y')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com.evil.io/octo/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://api.github.com/repos/octo/repo')).toBeNull();
  });

  it('rejects URLs with auth userinfo', () => {
    expect(parseGitHubRepoUrl('https://user:pass@github.com/octo/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://user@github.com/octo/repo')).toBeNull();
  });

  it('rejects garbage, empty owners/repos and traversal', () => {
    expect(parseGitHubRepoUrl('')).toBeNull();
    expect(parseGitHubRepoUrl('   ')).toBeNull();
    expect(parseGitHubRepoUrl('javascript:alert(1)')).toBeNull();
    expect(parseGitHubRepoUrl('not a url')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/octo')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/')).toBeNull();
    // Traversal-looking owners like '..' are not allowed as path segments.
    expect(parseGitHubRepoUrl('https://github.com/octo/repo%2F..%2F..')).toBeNull();
    // Query strings and fragments make it not a repository permalink.
    expect(parseGitHubRepoUrl('https://github.com/octo/repo?query=1')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/octo/repo#anchor')).toBeNull();
  });

  it('rejects owners/repositories containing path separators', () => {
    // 'some/owner/repo' cannot be a single owner segment; unknown extra segments count as garbage paths.
    expect(parseGitHubRepoUrl('https://github.com/some/owner/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/octo/repo/issues/12')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/octo/repo/releases/tag/v1')).toBeNull();
  });
});
