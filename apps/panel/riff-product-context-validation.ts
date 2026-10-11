import type { Project, SaveProjectInput } from '../../packages/contracts/index.ts';
import { isBusinessResultFlagCoherent,parseStrictCallToolResult } from './call-tool-result-validation.ts';

export type ProductDraft = {
  product: string;
  description: string;
  audience: string;
  goal: string;
  tone: string;
  language: string;
  duration_seconds: string;
  filming_constraints: string[];
};

export const emptyProductDraft = (description: string): ProductDraft => ({
  product: '', description, audience: '', goal: '', tone: '', language: '',
  duration_seconds: '', filming_constraints: [],
});

export const productDraftFromProject = (project: Project): ProductDraft => ({
  product: project.brief_version.brief.product,
  description: project.brief_version.brief.description ?? '',
  audience: project.brief_version.brief.audience,
  goal: project.brief_version.brief.goal,
  tone: project.brief_version.brief.tone,
  language: project.brief_version.brief.language,
  duration_seconds: String(project.brief_version.brief.duration_seconds),
  filming_constraints: [...project.brief_version.brief.filming_constraints],
});

export type ProductValidationResult =
  | { ok: true; input: SaveProjectInput }
  | { ok: false; errors: Partial<Record<keyof ProductDraft, string>> };

export function validateProductDraft(
  draft: ProductDraft,
  project: Project | null,
  requestId: string,
): ProductValidationResult {
  const errors: Partial<Record<keyof ProductDraft, string>> = {};
  const clean = (value: string) => value.trim();
  const placeholder = (value: string) => /^unknown(?:\s*[—-]\s*add a value)?$/i.test(clean(value));
  const required = (field: keyof ProductDraft, value: string, label: string, maximum: number) => {
    const normalized = clean(value);
    if (!normalized || placeholder(normalized)) errors[field] = `${label} is required.`;
    else if (normalized.length > maximum) errors[field] = `${label} must be ${maximum} characters or fewer.`;
    return normalized;
  };
  const product = required('product', draft.product, 'Product name', 120);
  const description = required('description', draft.description, 'Description', 4_000);
  const audience = required('audience', draft.audience, 'Audience', 1_000);
  const goal = required('goal', draft.goal, 'Main benefit', 1_000);
  const tone = required('tone', draft.tone, 'Content style', 200);
  const language = required('language', draft.language, 'Language', 35);
  const durationText = clean(draft.duration_seconds);
  const duration = /^\d+$/.test(durationText) ? Number(durationText) : Number.NaN;
  if (!Number.isInteger(duration) || duration < 5 || duration > 180) {
    errors.duration_seconds = 'Duration must be a whole number from 5 to 180 seconds.';
  }
  const filmingConstraints = draft.filming_constraints.map(clean);
  if (filmingConstraints.length > 20) errors.filming_constraints = 'Use at most 20 filming constraints.';
  else if (filmingConstraints.some(value => !value || placeholder(value))) {
    errors.filming_constraints = 'Remove empty filming constraints or add a value.';
  } else if (filmingConstraints.some(value => value.length > 500)) {
    errors.filming_constraints = 'Each filming constraint must be 500 characters or fewer.';
  }
  if (!uuid(requestId)) errors.product = errors.product ?? 'A safe save request could not be prepared.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      request_id: requestId,
      project_id: project?.id ?? null,
      expected_version: project?.current_version ?? 0,
      name: product,
      project_type: 'brand',
      brief: {
        product,
        description,
        audience,
        goal,
        tone,
        language,
        duration_seconds: duration,
        filming_constraints: filmingConstraints,
        facts: project ? structuredClone(project.brief_version.brief.facts) : [],
      },
    },
  };
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype) return;
  if (Object.values(Object.getOwnPropertyDescriptors(value))
    .some(descriptor => !('value' in descriptor) || !descriptor.enumerable)) return;
  return value as JsonObject;
};
const shape = (value: unknown, required: readonly string[], optional: readonly string[] = []) => {
  const item = object(value); if (!item) return;
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(item);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return;
  if (keys.some(key => !Object.getOwnPropertyDescriptor(item, key)?.enumerable)) return;
  if (!required.every(key => Object.hasOwn(item, key))) return;
  if (optional.some(key => Object.hasOwn(item, key) && item[key] === undefined)) return;
  return item;
};
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value));
const boundedText = (value: unknown, maximum: number) => typeof value === 'string'
  && value.trim().length > 0 && value.trim().length <= maximum;

function fact(value: unknown) {
  const item = shape(value, ['id', 'statement', 'source', 'user_confirmed']);
  const source = shape(item?.source, ['kind', 'captured_at'], item?.source && object(item.source)?.kind === 'url' ? ['url'] : []);
  if (!item || !source || !uuid(item.id) || !boundedText(item.statement, 1_000)
    || typeof item.user_confirmed !== 'boolean' || !timestamp(source.captured_at)) return false;
  if (source.kind === 'user') return Object.keys(source).length === 2;
  if (source.kind !== 'url' || typeof source.url !== 'string' || source.url.length > 2_048) return false;
  try {
    const parsed = new URL(source.url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function brief(value: unknown) {
  const item = shape(value,
    ['product', 'audience', 'goal', 'tone', 'language', 'duration_seconds', 'filming_constraints', 'facts'],
    ['description']);
  if (!item) return false;
  const filmingConstraints = strictArrayValues(item.filming_constraints);
  const facts = strictArrayValues(item.facts);
  if (!boundedText(item.product, 4_000) || !boundedText(item.audience, 1_000)
    || !boundedText(item.goal, 1_000) || !boundedText(item.tone, 200) || !boundedText(item.language, 35)
    || (item.description !== undefined && !boundedText(item.description, 4_000))
    || !Number.isInteger(item.duration_seconds) || Number(item.duration_seconds) < 5 || Number(item.duration_seconds) > 180
    || !filmingConstraints || filmingConstraints.length > 20
    || !facts || facts.length > 50) return false;
  for (const constraint of filmingConstraints) if (!boundedText(constraint, 500)) return false;
  const factIds = new Set<unknown>();
  for (const entry of facts) {
    if (!fact(entry)) return false;
    factIds.add(object(entry)?.id);
  }
  return factIds.size === facts.length;
}

function projectSnapshot(value: unknown): Project | undefined {
  const item = shape(value, ['id', 'name', 'project_type', 'current_version', 'created_at', 'updated_at', 'brief_version']);
  const version = shape(item?.brief_version, ['id', 'project_id', 'version', 'name', 'brief', 'created_at']);
  if (!item || !version || !uuid(item.id) || !boundedText(item.name, 120) || item.project_type !== 'brand'
    || !Number.isInteger(item.current_version) || Number(item.current_version) < 1
    || !timestamp(item.created_at) || !timestamp(item.updated_at) || !uuid(version.id) || !uuid(version.project_id)
    || !Number.isInteger(version.version) || Number(version.version) < 1 || !boundedText(version.name, 120)
    || !brief(version.brief) || !timestamp(version.created_at) || item.id !== version.project_id
    || item.current_version !== version.version || item.name !== version.name) return;
  return item as Project;
}

const errorCodes = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_ERROR', 'NOT_FOUND',
  'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'UNAVAILABLE']);
const recoveries = new Set(['reauthorize', 'correct_input', 'reload', 'retry_same_request', 'contact_support']);
function failure(value: unknown) {
  const result = shape(value, ['ok', 'error']);
  const error = shape(result?.error, ['code', 'message', 'retryable', 'recovery']);
  if (!result || result.ok !== false || !error || typeof error.code !== 'string' || !errorCodes.has(error.code)
    || !boundedText(error.message, 500) || typeof error.retryable !== 'boolean'
    || typeof error.recovery !== 'string' || !recoveries.has(error.recovery)) return;
  return { code: error.code, recovery: error.recovery };
}
function strictArrayValues(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.enumerable
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return;
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return;
  const result = new Array<unknown>(length);
  let sawLength = false;
  for (const key of keys) {
    if (key === 'length') {
      sawLength = true;
      continue;
    }
    if (typeof key !== 'string') return;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return;
    result[index] = descriptor.value;
  }
  return sawLength ? result : undefined;
}
function structured(raw: unknown) {
  const outer = parseStrictCallToolResult(raw);
  return outer ? { outer, result: outer.structuredContent } : undefined;
}
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    const values = strictArrayValues(value);
    if (!values) return;
    const result = new Array<unknown>(values.length);
    for (let index = 0; index < values.length; index += 1) result[index] = canonicalJson(values[index]);
    return result;
  }
  const item = object(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonicalJson(item[key])]));
}

export function parseProductSaveResult(raw: unknown, input: SaveProjectInput):
  | { status: 'saved'; project: Project; requestId: string }
  | { status: 'failure'; failure: { code: string; recovery: string } }
  | { status: 'malformed' } {
  const envelope = structured(raw);
  if (!envelope) return { status: 'malformed' };
  const { outer, result } = envelope;
  const parsedFailure = failure(result);
  if (parsedFailure) return isBusinessResultFlagCoherent(outer, false)
    ? { status: 'failure', failure: parsedFailure }
    : { status: 'malformed' };
  const success = shape(result, ['ok', 'data']);
  const data = shape(success?.data, ['project', 'request_id']);
  const saved = projectSnapshot(data?.project);
  if (!success || success.ok !== true || !isBusinessResultFlagCoherent(outer, true) || !data || !saved
    || data.request_id !== input.request_id || saved.current_version !== input.expected_version + 1
    || (input.project_id !== null && saved.id !== input.project_id) || saved.name !== input.name
    || saved.project_type !== input.project_type
    || JSON.stringify(canonicalJson(saved.brief_version.brief)) !== JSON.stringify(canonicalJson(input.brief))) {
    return { status: 'malformed' };
  }
  return { status: 'saved', project: saved, requestId: data.request_id as string };
}

export function parseProductGetResult(raw: unknown, projectId: string):
  | { status: 'loaded'; project: Project }
  | { status: 'failure'; failure: { code: string; recovery: string } }
  | { status: 'malformed' } {
  const envelope = structured(raw);
  if (!envelope) return { status: 'malformed' };
  const { outer, result } = envelope;
  const parsedFailure = failure(result);
  if (parsedFailure) return isBusinessResultFlagCoherent(outer, false)
    ? { status: 'failure', failure: parsedFailure }
    : { status: 'malformed' };
  const success = shape(result, ['ok', 'data']);
  const data = shape(success?.data, ['project']);
  const loaded = projectSnapshot(data?.project);
  if (!success || success.ok !== true || !isBusinessResultFlagCoherent(outer, true)
    || !data || !loaded || loaded.id !== projectId) {
    return { status: 'malformed' };
  }
  return { status: 'loaded', project: loaded };
}

export function productFailureMessage(code: string) {
  if (code === 'UNAUTHENTICATED') return 'Reconnect Riff in ChatGPT before saving this product context.';
  if (code === 'FORBIDDEN') return 'This account cannot save this product context. Check access or trial availability.';
  if (code === 'VALIDATION_ERROR') return 'Review the highlighted product brief fields, then confirm again.';
  if (code === 'VERSION_CONFLICT') return 'A newer saved version is available. Review your local edits and confirm again.';
  if (code === 'NOT_FOUND') return 'This saved product context is unavailable. Keep your local draft and reopen it from trusted saved work.';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'This save request no longer matches your draft. Change the intended edit, then confirm it again.';
  if (code === 'UNAVAILABLE') return 'Riff could not confirm this product save. Try the same save again safely.';
  return 'Riff could not verify that product context was saved. Your local draft is still here.';
}
