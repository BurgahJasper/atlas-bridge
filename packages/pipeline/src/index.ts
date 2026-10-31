// Atlas Bridge pipeline package (TRD §4, §10.3).
export {
  createPipeline,
  type Pipeline,
  type PipelineOptions,
} from './pipeline.js';
export { createFixtureAwarePipeline } from './fixture-seed.js';
export { loadCuratedFixture, hasCuratedFixture } from './fixture-load.js';
export { buildTinyFixture, TINY_FIXTURE_URL } from './test-fixtures.js';
export {
  analyzeJob,
  localePair,
  pickBoundedFiles,
  isSelectablePath,
  isSourcePath,
} from './analysis.js';
export {
  createExplanationService,
  generateTimelineStory,
  fallbackTimelineStory,
  filterUnverifiedStory,
  buildHistoryBundle,
  type HistoryBundle,
} from './explanations.js';
export {
  createContributionService,
  computeGitOpsPlan,
  executeGitOpsPlan,
  branchFor,
} from './contribution.js';
export { diffLines } from './diff.js';
export { pickFocusMilestone, seedFocusMission, distractorsFor } from './mission-seed.js';
export {
  COMMIT_WINDOW,
  FILE_COUNT_LIMIT,
  FILE_BYTES_LIMIT,
  TREE_ENTRY_LIMIT,
  type PipelineContext,
} from './context.js';
