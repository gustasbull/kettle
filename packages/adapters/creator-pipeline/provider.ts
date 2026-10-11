import { topicalMatchingText } from '../creator-scan/topical-context.ts';
import { z } from 'zod';
import { CreatorDnaView } from '../../contracts/creator-operations.ts';
import { CreatorAnalysis, ProfileScanRequest, ObservationProvenance, LightreelSeedReview,
  type ProfileObservation, type VideoObservation } from '../../contracts/creator-profile.ts';
import { RecommendationBatch, CreatorScriptSet, FilmingVariant, TimedFilmingSegment, CreatorJobProgress,
  CreatorAttemptError, CreatorRecommendationReuseSource, PipelineReference,
  type CreatorProgressProfile, type CreatorProgressVideoCard,
  type CreatorPipelineProvider, type CreatorProviderContext,
  type CreatorRecommendationReuseSource as CreatorRecommendationReuseSourceType } from '../../contracts/creator-pipeline.ts';
import { buildGroundedCreatorDna } from '../creator-scan/dna.ts';
import { characterizeFeed, characterizeProfile } from '../creator-scan/scrapecreators-characterization.ts';
import { boundedJson, type Fetch, type HttpEvidence } from './http.ts';
import { normalizeLiveTikTokScan, type ScanReceipt } from './live-scan.ts';
import { parseTikTokUrl } from './tiktok-url.ts';
import { readTikTokDetail } from './detail-json.ts';
import { readLightreelSubmission, readLightreelHistory } from './lightreel-json.ts';
import { readOpenAiResponse } from './openai-json.ts';
import { profileRequest, feedRequest, detailRequest, researchBody, historyRequest, scriptBody,
  ScrapeCreatorsCachePolicy, type ScrapeCreatorsCachePolicy as ScrapeCreatorsCachePolicyType } from './requests.ts';
import { readLightreelSeedReview, seedReviewBody } from './seed-review.ts';
import { receiptIds } from './ids.ts';
import { sanitizedScrape, sourceObservedAt } from './sanitize.ts';
import { observed, type CreatorLatencyObserver } from '../../application/creator-observability.ts';
import { trustedCatalogObservation } from '../../contracts/riff-videos.ts';

// Durable success receipt, not a parallel business/result schema.
const receipt = z.object({ id: z.uuid(), status: z.number().int().min(200).max(299),
  body: z.string().max(262144).refine(v => new TextEncoder().encode(v).length <= 262144), retrieved_at: z.iso.datetime(), latency_ms: z.number().int().nonnegative(),
  failure: z.null(), source_observed_at: z.iso.datetime().nullable() });
/** Error text is safe to persist. Any dispatched failure may have incurred cost; never retry here. */
export class CreatorProviderError extends CreatorAttemptError {
  constructor(readonly code: 'transport' | 'malformed' | 'schema_invalid' | 'permission' | 'unavailable',
    readonly status: number | null = null, readonly failure: HttpEvidence['failure'] = null) {
    const httpStatus=status!==null&&Number.isInteger(status)&&status>=100&&status<=599?status:null;
    const outcome=failure==='timeout'?{terminal_state:'needs_reconciliation' as const,failure_code:'timeout' as const,http_status:httpStatus}:
      failure==='network'?{terminal_state:'needs_reconciliation' as const,failure_code:'network' as const,http_status:httpStatus}:
      failure==='oversized'?{terminal_state:'failed' as const,failure_code:'oversized_response' as const,http_status:httpStatus}:
      failure==='malformed'||code==='malformed'?{terminal_state:'failed' as const,failure_code:'malformed_response' as const,http_status:httpStatus}:
      failure==='http'&&httpStatus!==null?{terminal_state:'failed' as const,
        failure_code:(httpStatus>=500?'http_5xx':httpStatus>=400?'http_4xx':'http_other') as 'http_5xx'|'http_4xx'|'http_other',http_status:httpStatus}:
      code==='permission'?{terminal_state:'failed' as const,failure_code:'permission' as const,http_status:httpStatus}:
      code==='unavailable'?{terminal_state:'failed' as const,failure_code:'unavailable' as const,http_status:httpStatus}:
      {terminal_state:'failed' as const,failure_code:'schema_invalid' as const,http_status:httpStatus};
    super(outcome);
  }
}
const ambiguousAttemptPattern=/^(?:creator_attempt_terminal:needs_reconciliation:(?:timeout|network|receipt_persistence_failed|unknown_after_dispatch):(?:null|[1-5]\d\d)|creator_attempt_needs_reconciliation|Workflow step failed: Error: creator_attempt_terminal:needs_reconciliation:(?:timeout|network|receipt_persistence_failed|unknown_after_dispatch):(null|[1-5]\d\d)(?:\n[^\r\n]{0,1000})?)$/;
const blockedAttemptPattern=/^(?:creator_attempt_terminal:failed:(?:http_4xx|http_5xx|http_other|malformed_response|schema_invalid|oversized_response|permission|unavailable):(null|[1-5]\d\d)|creator_job_blocked)$/;
const isAmbiguousAttempt=(error:unknown)=>error instanceof CreatorAttemptError?
  error.outcome.terminal_state==='needs_reconciliation':error instanceof Error&&ambiguousAttemptPattern.test(error.message);
export type CreatorPipelineAdapterOptions = {
  fetch: Fetch;
  credentials: { scrapeCreators: string; lightreel: string; openai?: string };
  /** Trusted canonical supplied video URL; never inferred from a profile or provider response. */
  seedUrl?: string;
  model: string; maxOutputTokens: number; region: string;
  cacheMaxAge: ScrapeCreatorsCachePolicyType;
  /** Server-only observations from this immutable recommendation job capture. */
  recommendationReuse?:CreatorRecommendationReuseSourceType;
  permission: z.infer<typeof ObservationProvenance>['permission'];
  /** Trusted server checks underlying source/model rights; the display view alone cannot establish them. */
  canProcessDna(dna: CreatorDnaView): boolean;
  /** Upper bound on known-ID history reads in this invocation; no retry of research POST. */
  maxHistoryReads?: number;
  timeouts?: { scrapeMs?: number; researchMs?: number; seedReviewMs?: number; modelMs?: number };
  telemetry?: CreatorLatencyObserver;
};
const seedReviewCaveat = 'Supplied video review, not whole-profile DNA. Reported access is a Lightreel claim, not independently verified video evidence.';
const truncate=(value:string|null,max:number)=>value===null?null:value.slice(0,max);
const progressProvenance=(value:{origin:'fixture'|'live';retrieved_at:string;source_observed_at:string|null;
  permission:{basis:string}})=>({origin:value.origin,retrieved_at:value.retrieved_at,
  source_observed_at:value.source_observed_at,permission_basis:value.permission.basis.slice(0,1000),limitations:[]});
const progressProfile=(value:ProfileObservation):CreatorProgressProfile=>({
  platform:'tiktok',native_id:value.profile.native_id,url:value.canonical_url,handle:value.handle,
  display_name:truncate(value.display_name,200),bio:truncate(value.bio,1000),follower_count:value.follower_count,
  ...(value.avatar_url?{avatar_url:value.avatar_url}:{}),provenance:progressProvenance(value.provenance),
});
const progressVideo=(value:VideoObservation):CreatorProgressVideoCard=>({
  platform:'tiktok',native_id:value.video.native_id,url:value.canonical_url,caption:truncate(value.caption,2000),
  published_at:value.published_at,duration_seconds:value.duration_seconds,
  ...(value.thumbnail_url?{thumbnail_url:value.thumbnail_url}:{}),metrics:{views:value.metrics.views,likes:value.metrics.likes,
    comments:value.metrics.comments,shares:value.metrics.shares,...(value.metrics.saves!==undefined?{saves:value.metrics.saves}:{})},
  provenance:progressProvenance(value.provenance),
});
const scanProgress=(scan:ReturnType<typeof normalizeLiveTikTokScan>):Extract<z.infer<typeof CreatorJobProgress>,{kind:'scan'}>=>{
  const seen=new Set<string>(),videos=[] as CreatorProgressVideoCard[];
  for(const observation of scan.video_observations){const key=`${observation.video.platform}:${observation.video.native_id}`;
    if(seen.has(key))continue;seen.add(key);videos.push(progressVideo(observation));if(videos.length===10)break;}
  return {kind:'scan',profile:scan.profile_observations[0]?progressProfile(scan.profile_observations[0]):null,videos,limitations:[]};
};
// Persisted legacy variants may omit these fields, while a new strict model
// response must always make an explicit structured choice for Paper Studio.
// Segment-level on-screen text remains available in the persisted contract,
// but the model dialect omits it because variant-level on_screen_text already
// carries that content and strict structured outputs cannot declare optionals.
const generatedTimedSegment = z.strictObject({
  part: TimedFilmingSegment.shape.part,
  start_seconds: TimedFilmingSegment.shape.start_seconds,
  end_seconds: TimedFilmingSegment.shape.end_seconds,
  spoken_text: TimedFilmingSegment.shape.spoken_text,
  filming_direction: TimedFilmingSegment.shape.filming_direction,
}).refine(segment => segment.end_seconds > segment.start_seconds, 'Timed segment must end after it starts');
const generatedVariant = FilmingVariant.omit({ id: true }).extend({
  timed_segments: z.array(generatedTimedSegment).min(1).max(10),
  caption: FilmingVariant.shape.caption.unwrap(),
  hashtags: FilmingVariant.shape.hashtags.unwrap(),
});
const modelOutput = z.strictObject({ variants: z.array(generatedVariant).min(2).max(3) });
const modelSchema = z.toJSONSchema(modelOutput) as Record<string, unknown>;
const RECOMMENDATION_FEED_REUSE_MAX_AGE_MS=7*24*60*60*1000;

export function createCreatorPipelineProvider(options: CreatorPipelineAdapterOptions): CreatorPipelineProvider {
  const parsedCachePolicy = ScrapeCreatorsCachePolicy.safeParse(options.cacheMaxAge);
  if (!parsedCachePolicy.success) throw new Error('Invalid ScrapeCreators cache policy');
  const cacheMaxAge = parsedCachePolicy.data;
  const parsedReuse=options.recommendationReuse===undefined?undefined:
    CreatorRecommendationReuseSource.safeParse(options.recommendationReuse);
  const recommendationReuse=parsedReuse?.success?parsedReuse.data:undefined;
  const permission = ObservationProvenance.shape.permission.parse(options.permission);
  const credentials = { ...options.credentials };
  if (typeof options.canProcessDna !== 'function') throw new CreatorProviderError('permission');
  if (permission.status !== 'approved' || !['store', 'display', 'model_processing'].every(p =>
    permission.permitted_uses.includes(p as 'store' | 'display' | 'model_processing'))) throw new CreatorProviderError('permission');
  const validCredential = (key: string | undefined) => typeof key === 'string' && key.trim().length > 0 && !/[\r\n]/.test(key);
  if (!validCredential(credentials.scrapeCreators) || !validCredential(credentials.lightreel) ||
    (credentials.openai !== undefined && !validCredential(credentials.openai))) throw new Error('Missing provider credential');
  const maxHistoryReads = options.maxHistoryReads ?? 0;
  if (!Number.isInteger(maxHistoryReads) || maxHistoryReads < 0 || maxHistoryReads > 3) throw new Error('Invalid history bound');
  if (!/^[A-Z]{2}$/.test(options.region)) throw new Error('Invalid region');
  // Validate model configuration without executing or reading environment variables.
  scriptBody(options.model, options.maxOutputTokens, {}, modelSchema);
  const seedUrl = options.seedUrl === undefined ? undefined : LightreelSeedReview.shape.url.parse(options.seedUrl);
  const timeouts = { scrape: options.timeouts?.scrapeMs ?? 30_000,
    research: options.timeouts?.researchMs ?? 180_000, seedReview: options.timeouts?.seedReviewMs ?? 540_000, model: options.timeouts?.modelMs ?? 60_000 };
  for (const n of Object.values(timeouts)) if (!Number.isInteger(n) || n < 1 || n > 600_000) throw new Error('Invalid timeout');
  const provenance = (r: ScanReceipt, endpoint: string, source_url: string) => ObservationProvenance.parse({
    provider: 'scrapecreators', endpoint, origin: 'live', retrieved_at: r.retrieved_at,
    source_observed_at: r.source_observed_at, source_url, permission, modalities: ['metadata'],
  });
  const checkDna = (raw: CreatorDnaView) => {
    const dna = CreatorDnaView.parse(raw);
    if (dna.contains_fixture_data || (dna.seed_review && dna.seed_review.origin !== 'live') || dna.evidence.some(e => e.origin !== 'live') || options.canProcessDna(dna) !== true) {
      throw new CreatorProviderError('permission');
    }
    return dna;
  };
  async function call(context: CreatorProviderContext, key: string,
    provider: 'scrapecreators' | 'lightreel' | 'openai',
    operation: 'profile' | 'feed' | 'research' | 'poll' | 'video' | 'generate',
    url: URL, body: string | undefined, decode: (body: string) => string, timeoutMs?: number) {
    const apiKey = provider === 'scrapecreators' ? credentials.scrapeCreators : provider === 'lightreel' ? credentials.lightreel : credentials.openai;
    if (!apiKey) throw new Error('Missing provider credential');
    const raw = await context.call(key, provider, operation, async () => {
      const r = await boundedJson(options.fetch, url, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(provider === 'scrapecreators' ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
          'Content-Type': 'application/json', Accept: 'application/json' }, body },
      { maxBytes: provider === 'scrapecreators' && operation === 'feed' ? 2_097_152 : 262_144,
        timeoutMs: timeoutMs ?? (operation === 'poll' ? Math.min(timeouts.research, 30_000) :
        provider === 'scrapecreators' ? timeouts.scrape : provider === 'lightreel' ? timeouts.research : timeouts.model) });
      const endpoint = provider === 'scrapecreators'
        ? operation === 'profile' ? 'scrapecreators_profile' : operation === 'feed' ? 'scrapecreators_feed' : 'scrapecreators_video'
        : provider === 'lightreel' ? operation === 'poll' ? 'lightreel_poll' : 'lightreel_research' : 'openai_responses';
      options.telemetry?.record({ stage: 'provider_http', clock: 'monotonic',
        status: r.failure === null ? 'ok' : r.failure === 'timeout' ? 'timeout' : 'error',
        duration_ms: r.latency_ms, provider, operation, endpoint,
        ...(r.status === null ? {} : { http_status: r.status }),
        request_bytes: body === undefined ? 0 : new TextEncoder().encode(body).length,
        response_bytes: new TextEncoder().encode(r.body).length });
      if (r.failure !== null) throw new CreatorProviderError('transport', r.status, r.failure);
      try {
        const source_observed_at = provider === 'scrapecreators' ? sourceObservedAt(r.body) : null;
        const sanitized = await observed(options.telemetry,
          { stage: 'sanitization', clock: 'monotonic', provider, operation }, async () => decode(r.body));
        return receipt.parse({ ...r, id: context.newId(), source_observed_at, body: sanitized });
      } catch(error) { if(error instanceof CreatorProviderError)throw error;throw new CreatorProviderError('schema_invalid', r.status); }
    });
    try { return receipt.parse(raw); } catch { return context.recordOutcome(key,{terminal_state:'failed',failure_code:'schema_invalid',http_status:null}); }
  }
  return {
    async scan(raw, context) {
      const request = ProfileScanRequest.parse(raw);
      if (request.max_pages > 2 || request.max_videos > 10) throw new Error('Pilot scan exceeds ten videos/two pages');
      let seedReview: z.infer<typeof LightreelSeedReview> | undefined;
      let seedReceipt: z.infer<typeof receipt> | undefined;
      let progress:Extract<z.infer<typeof CreatorJobProgress>,{kind:'scan'}>={kind:'scan',profile:null,videos:[],limitations:[]};
      if (seedUrl !== undefined) {
        if (!seedUrl.startsWith(request.supplied_url.replace(/\/$/,'') + '/video/')) throw new CreatorProviderError('permission');
        await context.checkpoint('scan:seed:start','reviewing_video',progress);
        seedReceipt = await call(context, 'seed-review', 'lightreel', 'research', new URL('https://api.lightreel.ai/v1/chat'),
          seedReviewBody(seedUrl), body => JSON.stringify(readLightreelSeedReview(body, seedUrl)), timeouts.seedReview);
        // Revalidate durable replay too. No callbacks/history reads or retry/resubmission path.
        let review:ReturnType<typeof readLightreelSeedReview>;
        try{review=readLightreelSeedReview(seedReceipt.body, seedUrl);}catch{
          return context.recordOutcome('seed-review',{terminal_state:'failed',failure_code:'schema_invalid',http_status:seedReceipt.status});
        }
        seedReview = LightreelSeedReview.parse({ url: seedUrl, provider: 'lightreel', conversation_id: review.conversationId,
          summary: review.answer.summary, access_basis: review.answer.access_basis,
          ...(review.answer.dimensions ? { dimensions: review.answer.dimensions } : {}),
          limitations: review.answer.limitations.length < 20 ? [seedReviewCaveat, ...review.answer.limitations] : review.answer.limitations,
          provenance: { provider: 'lightreel', endpoint: '/v1/chat', origin: 'live',
            retrieved_at: seedReceipt.retrieved_at, source_observed_at: null, source_url: seedUrl,
            permission, modalities: ['metadata'] } });
      }
      await context.checkpoint('scan:profile:start','reading_profile',progress);
      const profile = await call(context, 'profile', 'scrapecreators', 'profile',
        profileRequest(request.supplied_url, cacheMaxAge.profile), undefined,
        body => {
          const clean = sanitizedScrape(body, 'profile');
          if (characterizeProfile(clean).kind === 'malformed') throw new Error('Invalid profile');
          return clean;
        });
      const parsed = characterizeProfile(profile.body);
      if (parsed.kind !== 'available' || parsed.user.uniqueId.toLowerCase() !== parseTikTokUrl(request.supplied_url).handle.toLowerCase()) {
        return context.recordOutcome('profile',{terminal_state:'failed',failure_code:'unavailable',http_status:profile.status});
      }
      const normalizedScan=async(feedAttempts:readonly (ScanReceipt&{requestedCursor:string|null})[])=>{
        const deterministicIds=await receiptIds(profile.id,300);
        return normalizeLiveTikTokScan({id:deterministicIds(),created_at:profile.retrieved_at,request,
          profileAttempt:profile,feedAttempts,latency_ms:profile.latency_ms+feedAttempts.reduce((n,p)=>n+p.latency_ms,0),permission},deterministicIds);
      };
      progress=scanProgress(await normalizedScan([]));
      await context.checkpoint('scan:profile','reading_posts',progress);
      const pages: (ScanReceipt & { requestedCursor: string | null })[] = [];
      const catalogedNativeIds=new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < request.max_pages; page++) {
        const r = await call(context, `feed:${page}`, 'scrapecreators', 'feed',
          feedRequest(request.supplied_url, parsed.user.id, options.region, cursor), undefined,
          body => sanitizedScrape(body, 'feed'));
        pages.push({ ...r, requestedCursor: cursor });
        const replay = characterizeFeed({ profileBody: profile.body, attempts: pages,
          maxPages: request.max_pages, maxVideos: request.max_videos });
        if (replay.pages.length !== pages.length)return context.recordOutcome(`feed:${page}`,
          {terminal_state:'failed',failure_code:'schema_invalid',http_status:r.status});
        const normalized=await normalizedScan(pages);
        const nextProgress=scanProgress(normalized);
        if(nextProgress.videos.length>progress.videos.length){progress=nextProgress;
          const checkpointKey=`scan:feed:${page}`;
          const admitted=normalized.video_observations.filter(observation=>{
            const key=`${observation.video.platform}:${observation.video.native_id}`;
            if(catalogedNativeIds.has(key))return false;catalogedNativeIds.add(key);return true;
          });
          await context.checkpoint(checkpointKey,'reading_posts',progress);
          if(admitted.length)await context.ingestCatalog(checkpointKey,'own_profile',
            admitted.map(observation=>trustedCatalogObservation(observation,normalized.limitations)));
        }
        // A finite input replay ends here only when a valid next page can be requested.
        if (replay.stop !== 'replay_ended') break;
        cursor = replay.nextCursor;
      }
      await context.checkpoint('scan:analysis','building_analysis',progress);
      const newId = await receiptIds(profile.id, 300);
      const scan = normalizeLiveTikTokScan({ id: newId(), created_at: profile.retrieved_at, request,
        profileAttempt: profile, feedAttempts: pages, permission,
        latency_ms: profile.latency_ms + pages.reduce((n, p) => n + p.latency_ms, 0) }, newId);
      if (seedReceipt) {
        scan.limitations.push(seedReviewCaveat);
        scan.cost.attempts.unshift({ id: seedReceipt.id, provider: 'lightreel', outcome: 'succeeded',
          credits: null, usd: null, usd_basis: 'unknown', conversion_basis: null });
        scan.cost.latency_ms += seedReceipt.latency_ms;
      }
      const analysis=CreatorAnalysis.parse({ ...buildGroundedCreatorDna(scan, { id: newId(), created_at: profile.retrieved_at }, newId),
        ...(seedReview ? { seed_review: seedReview } : {}) });
      await context.checkpoint('scan:save','saving',progress);
      return analysis;
    },
    async recommend(raw, context) {
      const dna = checkDna(raw);
      await context.checkpoint('recommend:research:start','researching_formats',
        {kind:'recommendations',identities:[],references:[],limitations:[]});
      const query = researchBody({ profile: dna.profile, dna_version: dna.version,
        claims: dna.claims, limitations: dna.limitations, ...(dna.seed_review ? { supplied_video_review: dna.seed_review } : {}) });
      const research = await call(context, 'research', 'lightreel', 'research', new URL('https://api.lightreel.ai/v1/chat'), query,
        body => JSON.stringify(readLightreelSubmission(body)));
      let result = researchResult(research.body);
      let acceptedResearch = research;
      let resultReceipt=research;
      let resultKey='research';
      // No invented status protocol: inspect only documented assistant history for a known ID.
      for (let read = 0; result.urls === null && read < maxHistoryReads; read++) {
        const id = result.conversationId;
        const history = await call(context, `poll:${read}`, 'lightreel', 'poll', historyRequest(id), undefined,
          body => JSON.stringify(readLightreelHistory(body, id)));
        result = researchResult(history.body);
        resultReceipt=history;
        resultKey=`poll:${read}`;
        if(result.urls!==null)acceptedResearch=history;
      }
      if (result.urls === null)return context.recordOutcome(resultKey,
        {terminal_state:'failed',failure_code:'unavailable',http_status:resultReceipt.status});
      let candidates:Array<{url:string;nativeId:string}>;
      try {
        candidates=result.urls.map(url=>{const parsed=parseTikTokUrl(url);if(!parsed.videoId)throw new Error('Missing video ID');
          return {url:parsed.canonicalUrl,nativeId:parsed.videoId};});
      } catch { return context.recordOutcome(resultKey,
        {terminal_state:'failed',failure_code:'schema_invalid',http_status:acceptedResearch.status}); }
      if(candidates.length>3||new Set(candidates.map(candidate=>candidate.nativeId)).size!==candidates.length)
        return context.recordOutcome(resultKey,{terminal_state:'failed',failure_code:'schema_invalid',http_status:acceptedResearch.status});
      const identities=candidates.map(({url,nativeId})=>({platform:'tiktok' as const,
        native_id:nativeId,url,retrieved_at:acceptedResearch.retrieved_at,origin:'live' as const,
        permission_basis:permission.basis.slice(0,1000),limitations:[]}));
      let recommendationProgress:z.infer<typeof CreatorJobProgress>={kind:'recommendations',identities,references:[],limitations:[]};
      await context.checkpoint('recommend:identities','enriching_references',recommendationProgress);
      const references: RecommendationBatch['references'] = [];
      const observedViews = dna.evidence.flatMap(e => e.metrics?.views !== null && e.metrics?.views !== undefined && e.metrics.views > 0
        ? [e.metrics.views] : []).sort((a, b) => a - b);
      const medianViews = observedViews.length === 0 ? undefined : observedViews.length % 2 === 1
        ? observedViews[Math.floor(observedViews.length / 2)]!
        : (observedViews[observedViews.length / 2 - 1]! + observedViews[observedViews.length / 2]!) / 2;
      const referenceFromObservation=(o:VideoObservation)=>{
        const multiplier = medianViews !== undefined && o.metrics.views !== null
          ? Math.round((o.metrics.views / medianViews) * 10) / 10 : undefined;
        return PipelineReference.parse({id:o.id,platform:'tiktok',native_id:o.video.native_id,url:o.canonical_url,
          retrieved_at:o.provenance.retrieved_at,source_observed_at:o.provenance.source_observed_at,
          published_at:o.published_at,caption:o.caption,views:o.metrics.views,
          ...(o.thumbnail_url?{thumbnail_url:o.thumbnail_url}:{}),duration_seconds:o.duration_seconds,
          likes:o.metrics.likes,...(o.metrics.saves!==undefined?{saves:o.metrics.saves}:{}),
          ...(multiplier!==undefined&&medianViews!==undefined?{view_multiplier:multiplier,
            view_multiplier_basis:{method:'median_observed_profile_views' as const,
              baseline_views:medianViews,sample_size:observedViews.length}}:{}),
          origin:o.provenance.origin,permission_basis:o.provenance.permission.basis,
          limitations:['Caption and metadata only; no visual or pacing analysis.',
            'Views are an observation, not evidence of causal success or expected results.',
            ...(multiplier!==undefined?[`View multiplier compares observed views with the median of ${observedViews.length} displayed profile observation${observedViews.length===1?'':'s'}; it is not a performance prediction.`]:[]),
            o.provenance.source_observed_at?`Provider cache observation time: ${o.provenance.source_observed_at}.`:
              'Source observation time is unknown; retrieval time does not establish metric freshness.']});
      };
      const reusableObservation=(nativeId:string)=>{
        if(!recommendationReuse||cacheMaxAge.detail!=='7d'||recommendationReuse.project_id!==dna.project_id||
          recommendationReuse.dna_id!==dna.dna_id||recommendationReuse.snapshot_id!==dna.snapshot_id||
          recommendationReuse.dna_version!==dna.version)return undefined;
        const now=Date.parse(context.now());if(!Number.isFinite(now))return undefined;
        return [...recommendationReuse.video_observations].filter(observation=>{
          const observedAt=observation.provenance.source_observed_at;
          if(observation.video.platform!=='tiktok'||observation.video.native_id!==nativeId||
            observation.creator.platform!==dna.profile.platform||observation.creator.native_id!==dna.profile.native_id||
            observation.provenance.provider!=='scrapecreators'||observation.provenance.endpoint!=='/v3/tiktok/profile/videos'||
            observation.provenance.origin!=='live'||observation.provenance.permission.status!=='approved'||
            observation.provenance.permission.basis!==permission.basis||
            observation.provenance.permission.retention!==permission.retention||
            !['store','display','model_processing'].every(use=>observation.provenance.permission.permitted_uses.includes(use as 'store'|'display'|'model_processing'))||!observedAt)return false;
          const observed=Date.parse(observedAt),age=now-observed;
          if(!Number.isFinite(observed)||age<0||age>RECOMMENDATION_FEED_REUSE_MAX_AGE_MS)return false;
          try{const parsed=parseTikTokUrl(observation.canonical_url);
            return parsed.videoId===nativeId&&parsed.canonicalUrl===observation.canonical_url&&
              PipelineReference.safeParse(referenceFromObservation(observation)).success;
          }catch{return false;}
        }).sort((a,b)=>b.provenance.source_observed_at!.localeCompare(a.provenance.source_observed_at!)||
          b.provenance.retrieved_at.localeCompare(a.provenance.retrieved_at)||b.id.localeCompare(a.id))[0];
      };
      const settled=await Promise.allSettled(candidates.map(async({url,nativeId})=>{
        const reused=reusableObservation(nativeId);
        if(reused)return {observation:reused,reference:referenceFromObservation(reused),reused:true};
        const r = await call(context, `video:${nativeId}`, 'scrapecreators', 'video',
          detailRequest(url, options.region, cacheMaxAge.detail), undefined,
          body => {
            const clean = sanitizedScrape(body, 'video');
            // Identity check before storing a success; provenance is assigned below from receipt metadata.
            readTikTokDetail(clean, url, context.newId(), provenance({ id: context.newId(), status: 200,
              body: '', failure: null, latency_ms: 0, retrieved_at: context.now(), source_observed_at: null }, '/v2/tiktok/video', url));
            return clean;
          });
        let o:ReturnType<typeof readTikTokDetail>['observation'];
        try{o=readTikTokDetail(r.body, url, r.id, provenance(r, '/v2/tiktok/video', url)).observation;}
        catch{return context.recordOutcome(`video:${nativeId}`,{terminal_state:'failed',failure_code:'schema_invalid',http_status:r.status});}
        return {observation:o,reference:referenceFromObservation(o),reused:false};
      }));
      const firstAmbiguous=settled.find(result=>result.status==='rejected'&&isAmbiguousAttempt(result.reason));
      const firstDefinite=settled.find(result=>result.status==='rejected');
      let checkpointFailure:unknown;
      for(let index=0;index<settled.length;index++){
        const result=settled[index]!;
        if(result.status==='rejected')break;
        references.push(result.value.reference);
        recommendationProgress={...recommendationProgress,references:[...recommendationProgress.references,progressVideo(result.value.observation)]};
        try {const checkpointKey=`recommend:detail:${candidates[index]!.nativeId}`;
          await context.checkpoint(checkpointKey,'enriching_references',recommendationProgress);
          if(!result.value.reused)await context.ingestCatalog(checkpointKey,'discovered_reference',[
            trustedCatalogObservation(result.value.observation,result.value.reference.limitations)]);}
        catch(error){checkpointFailure=error;break;}
      }
      if(firstAmbiguous&&firstAmbiguous.status==='rejected')throw firstAmbiguous.reason;
      if(isAmbiguousAttempt(checkpointFailure))throw checkpointFailure;
      if(firstDefinite&&firstDefinite.status==='rejected'){
        const error=firstDefinite.reason;
        if(error instanceof CreatorProviderError)throw new CreatorProviderError(error.code,error.status,error.failure);
        if(error instanceof Error&&blockedAttemptPattern.test(error.message))
          throw new Error(error.message);
        throw new CreatorProviderError('unavailable');
      }
      if(checkpointFailure)throw checkpointFailure;
      const batch=buildRecommendations(dna, references, { newId: await receiptIds(acceptedResearch.id, 5), now: () => acceptedResearch.retrieved_at });
      await context.checkpoint('recommend:save','saving',recommendationProgress);
      return batch;
    },
    async generate(input, context) {
      // Missing backend access must fail before any durable reservation or HTTP request.
      if (!credentials.openai) throw new Error('Missing OpenAI provider credential');
      const dna = checkDna(input.dna);
      const batch = RecommendationBatch.parse(input.batch);
      const idea = batch.ideas.find(i => i.id === input.idea_id);
      if (!idea || batch.dna_id !== dna.dna_id || batch.dna_version !== dna.version || batch.contains_fixture_data ||
        batch.references.some(r => r.origin !== 'live')) throw new Error('Selection or DNA lineage mismatch');
      const references = idea.reference_ids.map(referenceId => batch.references.find(reference => reference.id === referenceId)!);
      const body = scriptBody(options.model, options.maxOutputTokens,
        { idea, references, dna: { version: dna.version, claims: dna.claims, limitations: dna.limitations } }, modelSchema);
      const r = await call(context, 'generate', 'openai', 'generate', new URL('https://api.openai.com/v1/responses'), body,
        raw => {
          const response = readOpenAiResponse(raw);
          const output = modelOutput.parse(response.output);
          if (new Set(output.variants.map(v => v.label)).size !== output.variants.length ||
            output.variants.some(v => v.reference_ids.some(id => !idea.reference_ids.includes(id)))) throw new Error('Invalid grounding');
          return JSON.stringify({ ...response, output });
        });
      let output:z.infer<typeof modelOutput>;
      try{output=modelOutput.parse(JSON.parse(r.body).output);}catch{
        return context.recordOutcome('generate',{terminal_state:'failed',failure_code:'schema_invalid',http_status:r.status});
      }
      // Revalidate after durable replay too; recorded output remains untrusted.
      if (output.variants.some(v => v.reference_ids.some(id => !idea.reference_ids.includes(id))))
        return context.recordOutcome('generate',{terminal_state:'failed',failure_code:'schema_invalid',http_status:r.status});
      const newId = await receiptIds(r.id, 4);
      return CreatorScriptSet.parse({ id: newId(), batch_id: batch.id, idea_id: idea.id,
        dna_id: dna.dna_id, dna_version: dna.version, version: 1, created_at: r.retrieved_at,
        variants: output.variants.map(v => ({ ...v, id: newId() })), idea, references, contains_fixture_data: false,
        limitations: ['AI-generated proposals grounded in the selected evidence; human review required.',
          'Proposed visuals and pacing are filming instructions, not observed reference features or performance predictions.'] });
    },
  };
}
const researchResult = (body: string) => z.object({ conversationId: z.string().regex(/^[\w-]{1,200}$/),
  urls: z.array(z.string()).max(3).nullable() }).parse(JSON.parse(body));

function buildRecommendations(dna: CreatorDnaView, references: RecommendationBatch['references'], context: Pick<CreatorProviderContext, 'now' | 'newId'>) {
  const topical = dna.claims.filter(c => c.dimension === 'topics' || c.dimension === 'audience');
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter(w =>
    !['this','that','with','from','content','audience','inferred','topics','captions','about','their'].includes(w)) ?? []);
  const ideas: RecommendationBatch['ideas'] = [];
  for (const ref of references) {
    const tokens = words(ref.caption ?? '');
    const claim = topical.find(c => [...words(topicalMatchingText(c))].some(w => tokens.has(w)));
    const review = dna.seed_review;
    const reviewMatch = review && ['video_access_reported','transcript_or_caption_only'].includes(review.access_basis) &&
      [...words(review.summary)].some(w => tokens.has(w));
    const savedClaim = claim ?? topical[0] ?? dna.claims[0];
    const captionEvidence = ref.caption === null ? 'Reference caption unavailable.'
      : `Observed reference caption: “${ref.caption.slice(0,1800)}”`;
    ideas.push({ id: context.newId(), title: `Reference-led variation ${ideas.length + 1}`,
      concept: (claim ? `Create an original video exploring your stated topic: ${claim.statement}` :
        reviewMatch ? `Create an original video exploring this supplied-video topic: ${review.summary}` :
        savedClaim ? `Create an original take on the selected reference for this saved creator context: ${savedClaim.statement}` :
        'Create an original creator-led take on this selected reference. Confirm the subject fits before filming.').slice(0,3000),
      creator_fit: (claim ? `Proposed fit based on DNA v${dna.version} (${claim.basis}): ${claim.statement}` :
        reviewMatch ? `Proposed fit based on supplied video review, not whole profile: ${review.summary}. Access basis: ${review.access_basis}; provider report, not independent verification.` :
        savedClaim ? `Proposed fit based on saved DNA v${dna.version} (${savedClaim.basis}): ${savedClaim.statement}` :
        'Lightreel selected this reference for the captured creator context, but no saved topical claim independently confirms fit.').slice(0,3000),
      evidence_summary: (`Lightreel selected this public reference for the saved creator context. ${captionEvidence} ` +
        `${ref.views === null ? 'Views unavailable.' : `Observed views: ${ref.views}; no performance prediction.`}`).slice(0,3000),
      execution: 'Choose one concrete example from your own experience. State the problem, demonstrate your proposed change, and ask a relevant question. These are filming proposals, not observed reference structure.',
      reference_ids: [ref.id], limitations: [
        'Lightreel provider-selected relevance is grounded selection context, not independently verified semantic fit.',
        ...(claim ? ['Topic overlap is a lexical baseline, not a validated semantic relevance score.'] : []),
        savedClaim?.uncertainty ?? 'No saved DNA claim independently confirms the proposed creator fit.',
        'No measured audience demographics, visual analysis or causal performance claim.'] });
  }
  return RecommendationBatch.parse({ id: context.newId(), dna_id: dna.dna_id, dna_version: dna.version,
    created_at: context.now(), references, ideas, contains_fixture_data: false,
    limitations: ['Bounded Lightreel discovery with at most three ScrapeCreators metadata enrichments.',
      'Suggestions are testable proposals; human review should assess relevance.',
      ...(ideas.length ? [] : ['Lightreel returned no usable public references for this bounded search.'])] });
}
