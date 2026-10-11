import { topicalMatchingText } from '../creator-scan/topical-context.ts';
import { z } from 'zod';
import { CreatorDnaView } from '../../contracts/creator-operations.ts';
import { CreatorAnalysis, ProfileScanRequest, ObservationProvenance, LightreelSeedReview } from '../../contracts/creator-profile.ts';
import { RecommendationBatch, CreatorScriptSet, FilmingVariant, TimedFilmingSegment,
  type CreatorPipelineProvider, type CreatorProviderContext } from '../../contracts/creator-pipeline.ts';
import { buildGroundedCreatorDna } from '../creator-scan/dna.ts';
import { characterizeFeed, characterizeProfile } from '../creator-scan/scrapecreators-characterization.ts';
import { boundedJson, type Fetch, type HttpEvidence } from './http.ts';
import { normalizeLiveTikTokScan, type ScanReceipt } from './live-scan.ts';
import { parseTikTokUrl } from './tiktok-url.ts';
import { readTikTokDetail } from './detail-json.ts';
import { readLightreelSubmission, readLightreelHistory } from './lightreel-json.ts';
import { readOpenAiResponse } from './openai-json.ts';
import { profileRequest, feedRequest, detailRequest, researchBody, historyRequest, scriptBody } from './requests.ts';
import { readLightreelSeedReview, seedReviewBody } from './seed-review.ts';
import { receiptIds } from './ids.ts';
import { sanitizedScrape, sourceObservedAt } from './sanitize.ts';

// Durable success receipt, not a parallel business/result schema.
const receipt = z.object({ id: z.uuid(), status: z.number().int().min(200).max(299),
  body: z.string().max(262144).refine(v => new TextEncoder().encode(v).length <= 262144), retrieved_at: z.iso.datetime(), latency_ms: z.number().int().nonnegative(),
  failure: z.null(), source_observed_at: z.iso.datetime().nullable() });
/** Error text is safe to persist. Any dispatched failure may have incurred cost; never retry here. */
export class CreatorProviderError extends Error {
  constructor(readonly code: 'transport' | 'malformed' | 'permission' | 'unavailable',
    readonly status: number | null = null, readonly failure: HttpEvidence['failure'] = null) {
    const safeCode = ['transport','malformed','permission','unavailable'].includes(code) ? code : 'malformed';
    const safeFailure = failure && ['timeout','network','oversized','malformed','http'].includes(failure) ? `_${failure}` : '';
    const safeStatus = status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? `_${status}` : '';
    super(`creator_provider_${safeCode}${safeFailure}${safeStatus}`);
  }
}
export type CreatorPipelineAdapterOptions = {
  fetch: Fetch;
  credentials: { scrapeCreators: string; lightreel: string; openai?: string };
  /** Trusted canonical supplied video URL; never inferred from a profile or provider response. */
  seedUrl?: string;
  model: string; maxOutputTokens: number; region: string;
  permission: z.infer<typeof ObservationProvenance>['permission'];
  /** Trusted server checks underlying source/model rights; the display view alone cannot establish them. */
  canProcessDna(dna: CreatorDnaView): boolean;
  /** Upper bound on known-ID history reads in this invocation; no retry of research POST. */
  maxHistoryReads?: number;
  timeouts?: { scrapeMs?: number; researchMs?: number; seedReviewMs?: number; modelMs?: number };
};
const seedReviewCaveat = 'Supplied video review, not whole-profile DNA. Reported access is a Lightreel claim, not independently verified video evidence.';
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

export function createCreatorPipelineProvider(options: CreatorPipelineAdapterOptions): CreatorPipelineProvider {
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
      if (r.failure !== null) throw new CreatorProviderError('transport', r.status, r.failure);
      try {
        const source_observed_at = provider === 'scrapecreators' ? sourceObservedAt(r.body) : null;
        return receipt.parse({ ...r, id: context.newId(), source_observed_at, body: decode(r.body) });
      } catch { throw new CreatorProviderError('malformed', r.status, 'malformed'); }
    });
    try { return receipt.parse(raw); } catch { throw new CreatorProviderError('malformed'); }
  }
  return {
    async scan(raw, context) {
      const request = ProfileScanRequest.parse(raw);
      if (request.max_pages > 2 || request.max_videos > 10) throw new Error('Pilot scan exceeds ten videos/two pages');
      let seedReview: z.infer<typeof LightreelSeedReview> | undefined;
      let seedReceipt: z.infer<typeof receipt> | undefined;
      if (seedUrl !== undefined) {
        if (!seedUrl.startsWith(request.supplied_url.replace(/\/$/,'') + '/video/')) throw new CreatorProviderError('permission');
        seedReceipt = await call(context, 'seed-review', 'lightreel', 'research', new URL('https://api.lightreel.ai/v1/chat'),
          seedReviewBody(seedUrl), body => JSON.stringify(readLightreelSeedReview(body, seedUrl)), timeouts.seedReview);
        // Revalidate durable replay too. No callbacks/history reads or retry/resubmission path.
        const review = readLightreelSeedReview(seedReceipt.body, seedUrl);
        seedReview = LightreelSeedReview.parse({ url: seedUrl, provider: 'lightreel', conversation_id: review.conversationId,
          summary: review.answer.summary, access_basis: review.answer.access_basis,
          ...(review.answer.dimensions ? { dimensions: review.answer.dimensions } : {}),
          limitations: review.answer.limitations.length < 20 ? [seedReviewCaveat, ...review.answer.limitations] : review.answer.limitations,
          provenance: { provider: 'lightreel', endpoint: '/v1/chat', origin: 'live',
            retrieved_at: seedReceipt.retrieved_at, source_observed_at: null, source_url: seedUrl,
            permission, modalities: ['metadata'] } });
      }
      const profile = await call(context, 'profile', 'scrapecreators', 'profile', profileRequest(request.supplied_url), undefined,
        body => {
          const clean = sanitizedScrape(body, 'profile');
          if (characterizeProfile(clean).kind === 'malformed') throw new Error('Invalid profile');
          return clean;
        });
      const parsed = characterizeProfile(profile.body);
      if (parsed.kind !== 'available' || parsed.user.uniqueId.toLowerCase() !== parseTikTokUrl(request.supplied_url).handle.toLowerCase()) {
        throw new CreatorProviderError('unavailable');
      }
      const pages: (ScanReceipt & { requestedCursor: string | null })[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < request.max_pages; page++) {
        const r = await call(context, `feed:${page}`, 'scrapecreators', 'feed', feedRequest(request.supplied_url, options.region, cursor), undefined,
          body => sanitizedScrape(body, 'feed'));
        pages.push({ ...r, requestedCursor: cursor });
        const replay = characterizeFeed({ profileBody: profile.body, attempts: pages,
          maxPages: request.max_pages, maxVideos: request.max_videos });
        if (replay.pages.length !== pages.length) throw new CreatorProviderError('malformed');
        // A finite input replay ends here only when a valid next page can be requested.
        if (replay.stop !== 'replay_ended') break;
        cursor = replay.nextCursor;
      }
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
      return CreatorAnalysis.parse({ ...buildGroundedCreatorDna(scan, { id: newId(), created_at: profile.retrieved_at }, newId),
        ...(seedReview ? { seed_review: seedReview } : {}) });
    },
    async recommend(raw, context) {
      const dna = checkDna(raw);
      const query = researchBody({ profile: dna.profile, dna_version: dna.version,
        claims: dna.claims, limitations: dna.limitations, ...(dna.seed_review ? { supplied_video_review: dna.seed_review } : {}) });
      const research = await call(context, 'research', 'lightreel', 'research', new URL('https://api.lightreel.ai/v1/chat'), query,
        body => JSON.stringify(readLightreelSubmission(body)));
      let result = researchResult(research.body);
      // No invented status protocol: inspect only documented assistant history for a known ID.
      for (let read = 0; result.urls === null && read < maxHistoryReads; read++) {
        const id = result.conversationId;
        const history = await call(context, `poll:${read}`, 'lightreel', 'poll', historyRequest(id), undefined,
          body => JSON.stringify(readLightreelHistory(body, id)));
        result = researchResult(history.body);
      }
      if (result.urls === null) throw new CreatorProviderError('unavailable');
      const references: RecommendationBatch['references'] = [];
      const observedViews = dna.evidence.flatMap(e => e.metrics?.views !== null && e.metrics?.views !== undefined && e.metrics.views > 0
        ? [e.metrics.views] : []).sort((a, b) => a - b);
      const medianViews = observedViews.length === 0 ? undefined : observedViews.length % 2 === 1
        ? observedViews[Math.floor(observedViews.length / 2)]!
        : (observedViews[observedViews.length / 2 - 1]! + observedViews[observedViews.length / 2]!) / 2;
      for (const url of result.urls) {
        const nativeId = parseTikTokUrl(url).videoId!;
        const r = await call(context, `video:${nativeId}`, 'scrapecreators', 'video', detailRequest(url, options.region), undefined,
          body => {
            const clean = sanitizedScrape(body, 'video');
            // Identity check before storing a success; provenance is assigned below from receipt metadata.
            readTikTokDetail(clean, url, context.newId(), provenance({ id: context.newId(), status: 200,
              body: '', failure: null, latency_ms: 0, retrieved_at: context.now(), source_observed_at: null }, '/v2/tiktok/video', url));
            return clean;
          });
        const { observation: o } = readTikTokDetail(r.body, url, r.id, provenance(r, '/v2/tiktok/video', url));
        const multiplier = medianViews !== undefined && o.metrics.views !== null
          ? Math.round((o.metrics.views / medianViews) * 10) / 10 : undefined;
        references.push({ id: o.id, platform: 'tiktok', native_id: o.video.native_id, url: o.canonical_url,
          retrieved_at: o.provenance.retrieved_at, published_at: o.published_at,
          caption: o.caption, views: o.metrics.views,
          ...(o.thumbnail_url ? { thumbnail_url: o.thumbnail_url } : {}),
          duration_seconds: o.duration_seconds, likes: o.metrics.likes,
          ...(o.metrics.saves !== undefined ? { saves: o.metrics.saves } : {}),
          ...(multiplier !== undefined && medianViews !== undefined ? { view_multiplier: multiplier,
            view_multiplier_basis: { method: 'median_observed_profile_views' as const,
              baseline_views: medianViews, sample_size: observedViews.length } } : {}),
          origin: 'live', permission_basis: permission.basis,
          limitations: ['Caption and metadata only; no visual or pacing analysis.',
            'Views are an observation, not evidence of causal success or expected results.',
            ...(multiplier !== undefined ? [`View multiplier compares observed views with the median of ${observedViews.length} displayed profile observation${observedViews.length === 1 ? '' : 's'}; it is not a performance prediction.`] : []),
            o.provenance.source_observed_at ? `Provider cache observation time: ${o.provenance.source_observed_at}.` : 'Source observation time is unknown; retrieval time does not establish metric freshness.'] });
      }
      return buildRecommendations(dna, references, { newId: await receiptIds(research.id, 5), now: () => research.retrieved_at });
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
      const output = modelOutput.parse(JSON.parse(r.body).output);
      // Revalidate after durable replay too; recorded output remains untrusted.
      if (output.variants.some(v => v.reference_ids.some(id => !idea.reference_ids.includes(id)))) throw new Error('Invalid grounding');
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
