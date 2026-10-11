/** Offline only: fictional provider responses exercise live-adapter code paths, not real provider evidence. */
import type { CreatorProviderContext } from '../../packages/contracts/creator-pipeline.ts';
import type { CreatorPipelineAdapterOptions } from '../../packages/adapters/creator-pipeline/provider.ts';
import { normalizedFixtureInput } from './normalized-fixture.ts';
import { creatorScriptsFixture } from './pipeline-fixtures.ts';
import { fictionalVideo } from './fixtures.ts';
import { scrapeCreatorsOfficialShapeFixture } from './scrapecreators-official-shape-fixture.ts';
export function fakeGuard() {
  let id = 1000;
  const successes = new Map<string, unknown>();
  const started = new Set<string>();
  const calls: { key: string; provider: string; operation: string }[] = [];
  const checkpointValues = new Map<string,string>();
  const checkpoints: {key:string;stage:string;progress:unknown}[]=[];
  const context: CreatorProviderContext = {
    now: () => '2026-10-09T12:00:00.000Z',
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12,'0')}`,
    async checkpoint(key,stage,progress){
      const value=JSON.stringify({stage,progress}),existing=checkpointValues.get(key);
      if(existing!==undefined){if(existing!==value)throw new Error('Synthetic checkpoint conflict');return;}
      checkpointValues.set(key,value);checkpoints.push({key,stage,progress:structuredClone(progress)});
    },
    async call(key, provider, operation, execute) {
      if (successes.has(key)) return structuredClone(successes.get(key));
      if (started.has(key)) throw new Error('Synthetic guard: reconciliation required');
      started.add(key); calls.push({ key, provider, operation });
      const result = await execute();
      successes.set(key, structuredClone(result)); return result;
    },
  };
  return { context, calls, successes, checkpoints };
}
export function providerHttpFixture() {
  const input = normalizedFixtureInput();
  const video = fictionalVideo();
  const official = scrapeCreatorsOfficialShapeFixture();
  const http: { url: string; init: RequestInit }[] = [];
  const options: CreatorPipelineAdapterOptions = {
    credentials: { scrapeCreators: 'synthetic-sc', lightreel: 'synthetic-lr', openai: 'synthetic-oa' },
    model: 'explicit-fixture-model', maxOutputTokens: 2000, region: 'US', maxHistoryReads: 0,
    cacheMaxAge: { profile: '1d', detail: '7d' },
    permission: { status: 'approved', basis: 'Synthetic unit-test permission, not real authorization.',
      permitted_uses: ['store', 'display', 'model_processing'], retention: 'Test process only' },
    canProcessDna: () => true, // Test stub only. Production must resolve captured source rights.
    fetch: async (url, init) => {
      http.push({ url, init });
      const u = new URL(url);
      if (u.pathname === '/v1/tiktok/profile') return new Response(input.profileAttempt.body);
      if (u.pathname === '/v3/tiktok/profile/videos') return Response.json(official.feed);
      if (u.hostname === 'api.lightreel.ai') return Response.json({ conversationId: 'synthetic-chat', answer: {
        urls: [`https://www.tiktok.com/@fictional_kettle_creator/video/${video.aweme_id}`] } });
      if (u.pathname === '/v2/tiktok/video') return Response.json(official.detail);
      if (u.hostname === 'api.openai.com') {
        const body = JSON.parse(init.body as string);
        const grounding = JSON.parse(body.input[0].content[0].text);
        const variants = creatorScriptsFixture().variants.map(({ id: _id, ...v }) => ({ ...v,
          timed_segments: [
            { part: 'hook', start_seconds: 0, end_seconds: 3, spoken_text: v.hook,
              filming_direction: v.opening_visual },
            { part: 'main_content', start_seconds: 3, end_seconds: 15, spoken_text: v.script,
              filming_direction: v.shots.join(' ') },
            { part: 'cta', start_seconds: 15, end_seconds: 20, spoken_text: v.cta,
              filming_direction: v.pacing },
          ],
          caption: 'One practical desk change, shown step by step.', hashtags: ['#desktips'],
          reference_ids: grounding.idea.reference_ids }));
        return Response.json({ id: 'resp-synthetic', status: 'completed', output: [{ type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify({ variants }) }] }], usage: { input_tokens: 100, output_tokens: 200 } });
      }
      throw new Error('Unexpected fixture URL');
    },
  };
  return { options, input, http };
}
