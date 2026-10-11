import { z } from 'zod';
import { CreatorJobView } from './creator-pipeline.ts';
import { CreatorUrl } from './creator-profile.ts';
import { Id, Project, result } from './index.ts';
import { RiffWorkState } from './riff-work-state.ts';

const SourceUrl = z.url().max(2_048).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash;
}, 'Use an HTTPS source URL without credentials, a custom port, or a fragment');

export const StartRiffCreatorInput = z.strictObject({
  request_id: Id,
  source_url: SourceUrl,
});

export const CanonicalRiffCreatorSource = z.strictObject({
  platform: z.literal('tiktok'),
  kind: z.enum(['profile', 'video']),
  handle: z.string().trim().min(1).max(100).regex(/^[\w.]+$/),
  canonical_url: CreatorUrl,
  profile_url: CreatorUrl,
  video_url: CreatorUrl.nullable(),
}).superRefine((source, context) => {
  const profile = new URL(source.profile_url);
  const expectedProfile = `https://www.tiktok.com/@${source.handle}`;
  if (source.profile_url !== expectedProfile || profile.pathname !== `/@${source.handle}`) {
    context.addIssue({ code: 'custom', message: 'Canonical profile and handle must agree' });
  }
  if (source.kind === 'profile') {
    if (source.video_url !== null || source.canonical_url !== source.profile_url) {
      context.addIssue({ code: 'custom', message: 'Profile source must use its profile URL' });
    }
  } else if (!source.video_url || source.canonical_url !== source.video_url
    || !new RegExp(`^/@${source.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/video/\\d{1,30}$`).test(new URL(source.video_url).pathname)) {
    context.addIssue({ code: 'custom', message: 'Video source must belong to its canonical profile' });
  }
});

export const StartRiffCreatorOutput = result(z.strictObject({
  project: Project,
  job: CreatorJobView,
  source: CanonicalRiffCreatorSource,
}));

export const ListRiffWorkInput = z.strictObject({
  limit: z.number().int().min(1).max(20).optional(),
});
export const RiffWorkSummary = z.strictObject({
  project_id: Id,
  project_name: z.string().trim().min(1).max(120),
  job_id: Id,
  kind: CreatorJobView.shape.kind,
  state: CreatorJobView.shape.state,
  updated_at: CreatorJobView.shape.updated_at,
  source: CanonicalRiffCreatorSource,
  variant_id: Id.nullable().default(null),
  work_state: RiffWorkState.nullable().default(null),
}).superRefine((work,context)=>{
  if((work.variant_id===null)!==(work.work_state===null))
    context.addIssue({code:'custom',message:'Recent variant and work state must be present together'});
  if(work.work_state&&(work.kind!=='scripts'||work.state!=='succeeded'
    ||work.work_state.job_id.toLowerCase()!==work.job_id.toLowerCase()
    ||work.work_state.variant_id.toLowerCase()!==work.variant_id?.toLowerCase()))
    context.addIssue({code:'custom',message:'Recent work state must match its successful script job and variant'});
});
export const ListRiffWorkOutput = result(z.strictObject({
  work: z.array(RiffWorkSummary).max(20),
}));

export const riffCreatorContracts = {
  start_riff_creator: {
    input: StartRiffCreatorInput,
    output: StartRiffCreatorOutput,
    scope: 'projects:write',
    readOnly: false,
  },
  get_riff_creator_start: {
    input: StartRiffCreatorInput,
    output: StartRiffCreatorOutput,
    scope: 'projects:read',
    readOnly: true,
  },
  list_riff_work: {
    input: ListRiffWorkInput,
    output: ListRiffWorkOutput,
    scope: 'projects:read',
    readOnly: true,
  },
} as const;

export type StartRiffCreatorInput = z.infer<typeof StartRiffCreatorInput>;
export type CanonicalRiffCreatorSource = z.infer<typeof CanonicalRiffCreatorSource>;
export type StartRiffCreatorOutput = z.infer<typeof StartRiffCreatorOutput>;
export type ListRiffWorkInput = z.infer<typeof ListRiffWorkInput>;
export type RiffWorkSummary = z.infer<typeof RiffWorkSummary>;
export type ListRiffWorkOutput = z.infer<typeof ListRiffWorkOutput>;
export type RiffCreatorOperation = keyof typeof riffCreatorContracts;
