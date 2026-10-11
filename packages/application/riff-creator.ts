import { z } from 'zod';
import { StoredCreatorJob, publicCreatorJob } from './creator-pipeline.ts';
import { failure, type IdentityVerifier } from './operations.ts';
import {
  CanonicalRiffCreatorSource,
  ListRiffWorkOutput,
  StartRiffCreatorInput,
  StartRiffCreatorOutput,
  riffCreatorContracts,
  type CanonicalRiffCreatorSource as CanonicalSource,
  type ListRiffWorkInput,
  type RiffCreatorOperation,
  type StartRiffCreatorInput as CreatorStartInput,
} from '../contracts/riff-creator.ts';
import { Id, Project, result } from '../contracts/index.ts';
import { observed, type CreatorLatencyObserver } from './creator-observability.ts';

export interface RiffCreatorRepository {
  find(accountId: string, input: CreatorStartInput, telemetry?: CreatorLatencyObserver): Promise<unknown>;
  start(accountId: string, input: CreatorStartInput, source: CanonicalSource, telemetry?: CreatorLatencyObserver): Promise<unknown>;
  list(accountId: string, input: ListRiffWorkInput, telemetry?: CreatorLatencyObserver): Promise<unknown>;
}
export type RiffCreatorSourceResolver = (value: string) => Promise<CanonicalSource>;
export type RiffCreatorSourceClassifier = (value: string) => 'canonical' | 'short' | 'invalid';
export type RiffCreatorDispatch = (jobId: string, accountId: string, telemetry?: CreatorLatencyObserver) => void;

const StoredRiffCreatorOutput = result(z.strictObject({
  project: Project,
  job: StoredCreatorJob,
  source: CanonicalRiffCreatorSource,
}));

function projectStored(value: z.infer<typeof StoredRiffCreatorOutput>, accountId: string, input: CreatorStartInput) {
  if (!value.ok) return failure(value.error.code);
  const { project, job, source } = value.data;
  if (job.account_id !== accountId || job.request_id !== input.request_id || job.project_id !== project.id
    || job.kind !== 'scan') return failure('UNAVAILABLE');
  try {
    return StartRiffCreatorOutput.parse({
      ok: true,
      data: { project, job: publicCreatorJob(job), source },
    });
  } catch {
    return failure('UNAVAILABLE');
  }
}

/** High-level authenticated start. Account ownership is accepted only from the verifier. */
export function createRiffCreatorOperations(
  verifier: IdentityVerifier,
  repository: RiffCreatorRepository,
  resolveSource: RiffCreatorSourceResolver,
  dispatch: RiffCreatorDispatch,
  isEnabled: () => boolean = () => true,
  telemetry?: CreatorLatencyObserver,
  classifySource: RiffCreatorSourceClassifier = () => 'short',
) {
  return { async execute(
    operation: RiffCreatorOperation,
    credential: string | null,
    rawInput: unknown,
  ): Promise<z.infer<typeof StartRiffCreatorOutput> | z.infer<typeof ListRiffWorkOutput>> {
    if (!credential) return failure('UNAUTHENTICATED');
    let identity;
    try { identity = await verifier.verify(credential); }
    catch { return failure('UNAUTHENTICATED'); }
    if (!identity || !Id.safeParse(identity.account_id).success) return failure('UNAUTHENTICATED');
    const contract = riffCreatorContracts[operation];
    if (!identity.scopes.includes(contract.scope)) return failure('FORBIDDEN');
    if (operation === 'list_riff_work') {
      const parsedList = riffCreatorContracts.list_riff_work.input.safeParse(rawInput);
      if (!parsedList.success) return failure('VALIDATION_ERROR');
      try { return ListRiffWorkOutput.parse(await observed(telemetry,
        { stage: 'application_operation', clock: 'monotonic', operation: 'list' },
        () => repository.list(identity.account_id, parsedList.data))); }
      catch { return failure('UNAVAILABLE'); }
    }
    const parsed = StartRiffCreatorInput.safeParse(rawInput);
    if (!parsed.success) return failure('VALIDATION_ERROR');
    const requestTelemetry = telemetry?.scope?.({ request_id: parsed.data.request_id }) ?? telemetry;
    if (operation === 'get_riff_creator_start') {
      try {
        return projectStored(
          StoredRiffCreatorOutput.parse(await observed(requestTelemetry,
            { stage: 'application_operation', clock: 'monotonic', operation: 'find' },
            () => repository.find(identity.account_id, parsed.data, requestTelemetry))),
          identity.account_id,
          parsed.data,
        );
      } catch {
        return failure('UNAVAILABLE');
      }
    }
    if (!isEnabled()) return failure('UNAVAILABLE');

    try {
      const classification = classifySource(parsed.data.source_url);
      if (classification === 'invalid') return failure('VALIDATION_ERROR');
      if (classification === 'short') {
        const existing = StoredRiffCreatorOutput.parse(await observed(requestTelemetry,
          { stage: 'application_operation', clock: 'monotonic', operation: 'find' },
          () => repository.find(identity.account_id, parsed.data, requestTelemetry)));
        if (existing.ok || existing.error.code !== 'NOT_FOUND') {
          const projected = projectStored(existing, identity.account_id, parsed.data);
          if (projected.ok && projected.data.job.state === 'queued') {
            const jobTelemetry = requestTelemetry?.scope?.({ job_id: projected.data.job.id }) ?? requestTelemetry;
            try { dispatch(projected.data.job.id, identity.account_id, jobTelemetry); } catch { /* durable queued intent */ }
          }
          return projected;
        }
      }

      let source: CanonicalSource;
      try { source = CanonicalRiffCreatorSource.parse(await observed(requestTelemetry,
        { stage: 'application_operation', clock: 'monotonic', operation: 'start' },
        () => resolveSource(parsed.data.source_url))); }
      catch (error) {
        return failure((error as { code?: string })?.code === 'SOURCE_UNAVAILABLE' ? 'UNAVAILABLE' : 'VALIDATION_ERROR');
      }
      const stored = StoredRiffCreatorOutput.parse(await repository.start(identity.account_id, parsed.data, source, requestTelemetry));
      const projected = projectStored(stored, identity.account_id, parsed.data);
      if (projected.ok && JSON.stringify(projected.data.source) !== JSON.stringify(source)) return failure('UNAVAILABLE');
      if (projected.ok && projected.data.job.state === 'queued') {
        const jobTelemetry = requestTelemetry?.scope?.({ job_id: projected.data.job.id }) ?? requestTelemetry;
        try { dispatch(projected.data.job.id, identity.account_id, jobTelemetry); } catch { /* reconciler retries durable intent */ }
      }
      return projected;
    } catch {
      return failure('UNAVAILABLE');
    }
  } };
}
