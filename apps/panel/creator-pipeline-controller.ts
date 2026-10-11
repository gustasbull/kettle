import type { z } from 'zod';
import { CreatorJobOutput, GetCreatorJobInput, type CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { StartRiffCreatorOutput } from '../../packages/contracts/riff-creator.ts';

type Selection = z.infer<typeof GetCreatorJobInput>;
export interface CreatorPipelineObserver {
  loading(): void;
  job(job: CreatorJobView, status: { refreshing: boolean; canRefresh: boolean; notice?: string }): void;
  cleared(reason: 'reauthorize' | 'unavailable' | 'invalid' | 'connection'): void;
}
export interface CreatorPipelineLimits {
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxPolls?: number;
  pollWindowMs?: number;
  performance?: { start(stage: 'poll_observation' | 'panel_render'): (status: 'ok' | 'error' | 'timeout' | 'rejected') => void };
}

/** Structured public data only. Neither model text nor private metadata is a fallback. */
export function creatorJobStructuredOutput(raw: unknown): z.infer<typeof CreatorJobOutput> | undefined {
  const envelope = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const job = CreatorJobOutput.safeParse(envelope.structuredContent);
  if (job.success) return envelope.isError === true && job.data.ok ? undefined : job.data;
  const started = StartRiffCreatorOutput.safeParse(envelope.structuredContent);
  if (!started.success || !started.data.ok || envelope.isError === true) return undefined;
  return CreatorJobOutput.parse({ ok: true, data: { job: started.data.data.job } });
}
export function creatorJobText(raw: unknown): string {
  return JSON.stringify(CreatorJobOutput.parse(raw));
}
const active = (job: CreatorJobView) => job.state === 'queued' || job.state === 'running';

/** Read-only observation of persisted jobs. No start/provider/generation capability. */
export function createCreatorPipelineController(
  observer: CreatorPipelineObserver,
  readJob: (input: Selection, signal: AbortSignal) => Promise<unknown>,
  limits: CreatorPipelineLimits = {},
) {
  const timeoutMs = limits.timeoutMs ?? 10_000;
  const pollIntervalMs = limits.pollIntervalMs ?? 2_000;
  const maxPollIntervalMs = limits.maxPollIntervalMs ?? 15_000;
  // Forty-two capped exponential polls span about 586 seconds, exceeding the
  // current provider's 540-second SLA while remaining bounded.
  const maxPolls = limits.maxPolls ?? 42;
  const pollWindowMs = limits.pollWindowMs ?? 600_000;
  if (![timeoutMs, pollIntervalMs, maxPollIntervalMs, pollWindowMs].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 0) throw new Error('Invalid observation limits');
  let selection: Selection | undefined;
  let job: CreatorJobView | undefined;
  let connected = false, tools = false, blocked = false, disposed = false;
  let epoch = 0, polls = 0, started = 0;
  let paused = false;
  let pending: AbortController | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  const stopPoll = () => { clearTimeout(pollTimer); pollTimer = undefined; };
  const stopInitial = () => { clearTimeout(initialTimer); initialTimer = undefined; };
  function invalidate() { epoch++; pending?.abort(); pending = undefined; stopPoll(); }
  function clear(reason: Parameters<CreatorPipelineObserver['cleared']>[0]) {
    invalidate(); stopInitial(); job = undefined; blocked = true; observer.cleared(reason);
  }
  function publish(notice?: string) {
    if (job && connected) {
      const finish = limits.performance?.start('panel_render');
      observer.job(job, { refreshing: !!pending, canRefresh: tools, ...(notice ? { notice } : {}) });
      finish?.('ok');
    }
  }
  function loading() {
    stopInitial(); observer.loading();
    initialTimer = setTimeout(() => clear('connection'), timeoutMs);
  }
  function schedule() {
    stopPoll();
    if (disposed || blocked || paused || !connected || !tools || !job || !active(job) || pending) return;
    if (polls >= maxPolls || Date.now() - started >= pollWindowMs) {
      publish('Automatic updates paused. Refresh or reopen in chat to check this saved job.'); return;
    }
    const delay = Math.min(maxPollIntervalMs, Math.round(pollIntervalMs * (1.6 ** polls)));
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      if (Date.now() - started >= pollWindowMs) {
        publish('Automatic updates paused. Refresh or reopen in chat to check this saved job.'); return;
      }
      polls++;
      void refresh(true);
    }, Math.min(delay, Math.max(1, pollWindowMs - (Date.now() - started))));
  }
  function apply(raw: unknown, refreshing: boolean): 'ok' | 'error' | 'rejected' {
    const parsed = CreatorJobOutput.safeParse(raw);
    if (!parsed.success) { clear('invalid'); return 'rejected'; }
    const result = parsed.data;
    if (!result.ok) {
      if (result.error.code === 'UNAVAILABLE' && refreshing && job) {
        paused = true; publish('Updates paused. Refresh or reopen in chat to try again.'); return 'error';
      }
      clear(result.error.code === 'UNAUTHENTICATED' ? 'reauthorize' : 'unavailable'); return 'error';
    }
    const next = result.data.job;
    if (!selection || selection.job_id !== next.id || (job &&
        (next.project_id !== job.project_id || next.kind !== job.kind || next.created_at !== job.created_at))) {
      clear('invalid'); return 'rejected';
    }
    if (job && next.revision < job.revision) {
      paused = true; publish('An older response was ignored. Refresh or reopen in chat.'); return 'rejected';
    }
    if (job && ((next.revision === job.revision && JSON.stringify(next) !== JSON.stringify(job)) ||
        (!active(job) && active(next)))) { clear('invalid'); return 'rejected'; }
    job = next; stopInitial(); publish(); schedule();
    return 'ok';
  }
  async function refresh(automatic = false) {
    if (disposed || blocked || !connected || !tools || !job || !selection || pending) return;
    stopPoll();
    if (!automatic) paused = false;
    const input = { ...selection }, requestEpoch = ++epoch;
    const abort = new AbortController(); pending = abort; publish();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const finishObservation = limits.performance?.start('poll_observation');
    try {
      const output = await Promise.race([
        readJob(input, abort.signal),
        new Promise<never>((_resolve, reject) => {
          abort.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
          timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
        }),
      ]);
      if (disposed || requestEpoch !== epoch) { finishObservation?.('rejected'); return; }
      pending = undefined;
      const outcome = apply(output, true);
      finishObservation?.(outcome);
    } catch {
      if (disposed || requestEpoch !== epoch) { finishObservation?.('rejected'); return; }
      pending = undefined;
      if (timedOut) { finishObservation?.('timeout'); paused = true; publish('Updates timed out. Refresh or reopen in chat to try again.'); }
      else { finishObservation?.('error'); clear('connection'); }
    } finally { clearTimeout(timer); }
  }
  loading();
  return {
    refresh: () => refresh(false),
    connected(supportsReads: boolean) {
      if (disposed || blocked) return;
      connected = true; tools = supportsReads; publish(); schedule();
    },
    receiveInput(raw: unknown) {
      if (disposed || blocked) return;
      const parsed = GetCreatorJobInput.safeParse(raw);
      if (!parsed.success) { clear('invalid'); return; }
      invalidate();
      if (selection?.job_id !== parsed.data.job_id) {
        job = undefined; polls = 0; started = Date.now(); paused = false;
      }
      selection = parsed.data;
      if (job) { publish(); schedule(); } else loading();
    },
    receiveResult(raw: unknown) {
      if (disposed || blocked) return;
      invalidate(); apply(raw, false);
    },
    connectionFailed() { if (!disposed && !blocked) clear('connection'); },
    dispose() {
      if (disposed) return;
      disposed = true; invalidate(); stopInitial(); job = undefined; selection = undefined;
    },
  };
}
