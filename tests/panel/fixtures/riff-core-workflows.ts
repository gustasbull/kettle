import { CreatorJobStatusView, CreatorJobView } from '../../../packages/contracts/creator-pipeline.ts';
import { Project } from '../../../packages/contracts/index.ts';
import { RiffWorkState } from '../../../packages/contracts/riff-work-state.ts';
import {
  discoveryCatalogFixture,
  pipelineFixture,
} from '../../../apps/panel/creator-pipeline/fixtures.ts';
import { riffHomeStructuredOutput } from '../../../apps/panel/riff-home/index.ts';
import { riffDiscoveryCatalogStructuredOutput } from '../../../apps/panel/creator-pipeline-validation.ts';

export const PAPER_CURRENT = Object.freeze({
  file_id: '01M39TTB7DKFHZY2JVDMAEDZ81',
  page_id: 'p-5-0',
  artboard_id: 'Z9H-0',
  token_hash: '17cc259e',
});

type PaperFixture<T> = Readonly<{
  origin: 'fixture';
  contains_fixture_data: true;
  fixture_id: `paper-current-${string}-v1`;
  paper_node: string;
  value: T;
}>;

function fixture<T>(id: string, paperNode: string, value: T): PaperFixture<T> {
  return Object.freeze({
    origin: 'fixture' as const,
    contains_fixture_data: true as const,
    fixture_id: `paper-current-${id}-v1` as const,
    paper_node: paperNode,
    value,
  });
}

const accountEnvelope = (id: string, displayName: string, onboardingSeenAt: string | null | undefined) => ({
  ok: true,
  data: {
    account: {
      id,
      display_name: displayName,
      state: 'active',
      preferred_language: 'en',
      created_at: '2026-10-11T12:00:00Z',
      ...(onboardingSeenAt !== undefined ? { onboarding_seen_at: onboardingSeenAt } : {}),
    },
    entitlements: { status: 'not_configured' },
    usage: { status: 'not_configured', reset_at: null },
  },
});

const parsedAccount = (id: string, displayName: string, onboardingSeenAt: string | null) => {
  const parsed = riffHomeStructuredOutput(accountEnvelope(id, displayName, onboardingSeenAt));
  if (parsed.status !== 'ready') throw new Error('Expected an authored account fixture to pass the public Home parser');
  return parsed.account;
};

const accountA = parsedAccount(
  '00000000-0000-4000-8000-000000000001',
  'Authored Creator A',
  '2026-10-11T12:00:00Z',
);
const accountFirst = parsedAccount(
  '00000000-0000-4000-8000-000000000001',
  'Authored Creator A',
  null,
);
const accountB = parsedAccount(
  '00000000-0000-4000-8000-000000000002',
  'Authored Creator B',
  '2026-10-11T12:00:00Z',
);

const malformedMarkerInput = accountEnvelope(
  '00000000-0000-4000-8000-000000000001',
  'Authored Creator A',
  undefined,
);
const malformedMarkerResult = riffHomeStructuredOutput(malformedMarkerInput);
if (malformedMarkerResult.status !== 'error') throw new Error('Expected the missing onboarding marker to fail closed in the public Home parser');

const parsedCatalogPage = (count: number) => {
  const parsed = riffDiscoveryCatalogStructuredOutput({
    content: [],
    structuredContent: { ok: true, data: discoveryCatalogFixture(count) },
    isError: false,
    _meta: {},
  });
  if (!parsed?.ok) throw new Error('Expected an authored catalog fixture to pass the public catalog parser');
  return parsed.data;
};

const recent = (index: number, platform: 'tiktok' | 'instagram' = 'tiktok') => ({
  id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
  title: `Authored recent ${index}`,
  stage: index % 2 ? 'Analysis' : 'Studio',
  platform,
});

const status = (
  scenario: 'video-analysis' | 'scan' | 'ideas' | 'scripts',
  stage: 'reviewing_video' | 'reading_profile' | 'building_analysis' | 'researching_formats',
) => {
  const job = pipelineFixture(scenario);
  return CreatorJobStatusView.parse({
    id: job.id,
    kind: job.kind,
    state: 'running',
    stage,
    revision: job.revision,
    created_at: job.created_at,
    updated_at: job.updated_at,
    progress: job.progress,
    terminal_result_available: false,
  });
};

const project = Project.parse({
  id: '00000000-0000-4000-8000-000000000201',
  name: 'Authored desk light',
  project_type: 'brand',
  current_version: 1,
  created_at: '2026-10-11T12:00:00Z',
  updated_at: '2026-10-11T12:00:00Z',
  brief_version: {
    id: '00000000-0000-4000-8000-000000000202',
    project_id: '00000000-0000-4000-8000-000000000201',
    version: 1,
    name: 'Authored desk light',
    created_at: '2026-10-11T12:00:00Z',
    brief: {
      product: 'Authored desk light',
      description: 'A fixture-only adjustable light for a small desk.',
      audience: 'People working at compact desks',
      goal: 'Show the visible before and after',
      tone: 'Warm and practical',
      language: 'English',
      duration_seconds: 22,
      filming_constraints: ['Film beside a window'],
      facts: [],
    },
  },
});

const studioBase = pipelineFixture('studio-complete');
if (studioBase.result?.kind !== 'scripts') throw new Error('Expected a parsed scripts fixture');
const studioCandidate = structuredClone(studioBase);
if (studioCandidate.result?.kind !== 'scripts') throw new Error('Expected scripts fixture clone');
studioCandidate.result.scripts.variants[0]!.caption = 'Authored fixture caption for the completed desk change.';
studioCandidate.result.scripts.variants[0]!.hashtags = ['#DeskSetup', '#FixtureOnly'];
const studio = CreatorJobView.parse(studioCandidate);
if (studio.result?.kind !== 'scripts') throw new Error('Expected parsed scripts fixture');
const missingOptionalCandidate = structuredClone(studio);
if (missingOptionalCandidate.result?.kind !== 'scripts') throw new Error('Expected scripts fixture clone');
delete missingOptionalCandidate.result.scripts.variants[0]!.caption;
delete missingOptionalCandidate.result.scripts.variants[0]!.hashtags;
const studioMissingOptional = CreatorJobView.parse(missingOptionalCandidate);
const studioLegacy = pipelineFixture('scripts');
const variant = studio.result.scripts.variants[0]!;
const workState = (state: 'active' | 'saved' | 'filmed', version: number) => RiffWorkState.parse({
  job_id: studio.id,
  variant_id: variant.id,
  state,
  version,
  updated_at: `2026-10-11T12:0${version}:00Z`,
});

/**
 * Authored Paper CURRENT values for browser acceptance only. Production entries
 * must never import this module or substitute these values for authenticated data.
 */
export const riffCoreWorkflowFixtures = Object.freeze({
  accounts: Object.freeze({
    first: fixture('account-first', '13QH-0', accountFirst),
    returning: fixture('account-returning', '13I0-0', accountA),
    malformedMarker: fixture('account-malformed-marker', '13I0-0', {
      input: malformedMarkerInput,
      result: malformedMarkerResult,
    }),
    accountB: fixture('account-b', 'ZZL-0', accountB),
  }),
  home: Object.freeze({
    empty: fixture('home-empty', '13I0-0', []),
    loading: fixture('home-loading', '13I0-0', { status: 'loading' as const }),
    error: fixture('home-error', '13I0-0', { status: 'error' as const, message: 'Authored recents could not load.' }),
    recents: fixture('home-recents', '13I0-0', [recent(1), recent(2, 'instagram'), recent(3), recent(4)]),
  }),
  jobs: Object.freeze({
    fetch: fixture('job-fetch', '14TG-0', status('video-analysis', 'reviewing_video')),
    analyze: fixture('job-analyze', '14QY-0', status('video-analysis', 'building_analysis')),
    profile: fixture('job-profile', '14R1-0', status('scan', 'reading_profile')),
    product: fixture('job-product', '14R4-0', { description: 'Authored product description', pending: true }),
    discovery: fixture('job-discovery', '14UK-0', status('ideas', 'researching_formats')),
  }),
  scans: Object.freeze({
    videoFull: fixture('scan-video-full', 'XOP-0', pipelineFixture('video-analysis')),
    videoPartial: fixture('scan-video-partial', 'YB3-0', pipelineFixture('partial-video-analysis')),
    tiktok: fixture('scan-tiktok', 'YX9-0', pipelineFixture('scan')),
    instagram: fixture('scan-instagram', 'Z1G-0', pipelineFixture('instagram-profile')),
  }),
  product: Object.freeze({
    draft: fixture('product-draft', '14R4-0', { description: 'Authored product description' }),
    validated: fixture('product-validated', '13WO-0', project),
    saveReceipt: fixture('product-save-receipt', '13WO-0', {
      project, request_id: '00000000-0000-4000-8000-000000000203', expected_version: 0,
    }),
    conflict: fixture('product-conflict', '13WO-0', { code: 'VERSION_CONFLICT', expected_version: 1 }),
  }),
  recommendations: Object.freeze({
    fourLibraries: fixture('recommendations-four-libraries', '135S-0/140H-0/146B-0/14C5-0', pipelineFixture('three-ideas')),
  }),
  catalog: Object.freeze({
    loading: fixture('catalog-loading', '135S-0', { status: 'loading' as const }),
    empty: fixture('catalog-empty', '135S-0', { status: 'ready' as const, page: parsedCatalogPage(0) }),
    error: fixture('catalog-error', '135S-0', { status: 'error' as const, message: 'Authored catalog unavailable.', retryable: true }),
    one: fixture('catalog-one', '135S-0', { status: 'ready' as const, page: parsedCatalogPage(1) }),
    five: fixture('catalog-five', '135S-0', { status: 'ready' as const, page: parsedCatalogPage(5) }),
    eight: fixture('catalog-eight', '135S-0', { status: 'ready' as const, page: parsedCatalogPage(8) }),
  }),
  scripts: Object.freeze({
    threeVariants: fixture('scripts-three-variants', 'Y3P-0', pipelineFixture('three-variants')),
    segments: fixture('scripts-segments', 'Q0G-0/TMD-0/TOF-0', studio),
    legacy: fixture('scripts-legacy', 'Y3P-0', studioLegacy),
    missingOptional: fixture('scripts-missing-optional', 'Y3P-0', studioMissingOptional),
  }),
  workState: Object.freeze({
    active: fixture('work-state-active', 'YBB-0', workState('active', 1)),
    saved: fixture('work-state-saved', 'YBB-0', workState('saved', 2)),
    filmed: fixture('work-state-filmed', 'YBB-0', workState('filmed', 3)),
    replay: fixture('work-state-replay', 'YBB-0', workState('saved', 2)),
    stale: fixture('work-state-stale', 'YBB-0', { code: 'VERSION_CONFLICT', current: workState('saved', 2) }),
    foreign: fixture('work-state-foreign', 'YBB-0', { code: 'NOT_FOUND', account: accountB.id }),
  }),
  host: Object.freeze({
    fake: fixture('host-fake', 'Z9H-0', { calls: [], requests: [], opens: [] }),
    timeout: fixture('host-timeout', 'Z9H-0', { settle: 'never' as const }),
    late: fixture('host-late', 'Z9H-0', { settle: 'after-account-switch' as const }),
    hostile: fixture('host-hostile', 'Z9H-0', {
      text: '<img src=x onerror=globalThis.__riffExecuted=true><svg><script>globalThis.__riffExecuted=true</script></svg>\u202E' + 'UnbrokenHostileValue'.repeat(4),
      url: 'javascript:globalThis.__riffExecuted=true',
      secret: 'Bearer should-never-render',
    }),
  }),
});

export function allRiffCoreFixtures(): PaperFixture<unknown>[] {
  const groups = Object.values(riffCoreWorkflowFixtures) as Array<Record<string, PaperFixture<unknown>>>;
  return groups.flatMap(group => Object.values(group));
}
