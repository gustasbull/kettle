import test from 'node:test';
import assert from 'node:assert/strict';
import { Project, SaveProjectInput } from '../../packages/contracts/index.ts';
import {
  emptyProductDraft,
  parseProductGetResult,
  parseProductSaveResult,
  productFailureMessage,
  validateProductDraft,
} from '../../apps/panel/riff-product-context-validation.ts';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nextRequestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const createdAt = '2026-10-11T10:00:00Z';

function completeDraft() {
  return {
    ...emptyProductDraft('Blocks distracting sites so a person can focus on one task.'),
    product: 'FocusNest',
    audience: 'Freelancers who get distracted online.',
    goal: 'Fewer distractions and more focused work.',
    tone: 'Relatable distractions and simple product demos.',
    language: 'en',
    duration_seconds: '20',
    filming_constraints: ['One person', 'Home desk'],
  };
}

function project(input: ReturnType<typeof successfulInput>, version = 1, description = true) {
  const brief = { ...input.brief } as Record<string, unknown>;
  if (!description) delete brief.description;
  return Project.parse({
    id: projectId,
    name: input.name,
    project_type: 'brand',
    current_version: version,
    created_at: createdAt,
    updated_at: createdAt,
    brief_version: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      project_id: projectId,
      version,
      name: input.name,
      brief,
      created_at: createdAt,
    },
  });
}

function successfulInput() {
  const parsed = validateProductDraft(completeDraft(), null, requestId);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected valid draft');
  return parsed.input;
}

test('validation builds the exact create and update contracts without inferred facts', () => {
  const create = validateProductDraft(completeDraft(), null, requestId);
  assert.equal(create.ok, true);
  if (!create.ok) return;
  assert.deepEqual(create.input, {
    request_id: requestId,
    project_id: null,
    expected_version: 0,
    name: 'FocusNest',
    project_type: 'brand',
    brief: {
      product: 'FocusNest',
      description: 'Blocks distracting sites so a person can focus on one task.',
      audience: 'Freelancers who get distracted online.',
      goal: 'Fewer distractions and more focused work.',
      tone: 'Relatable distractions and simple product demos.',
      language: 'en',
      duration_seconds: 20,
      filming_constraints: ['One person', 'Home desk'],
      facts: [],
    },
  });
  assert.ok(SaveProjectInput.safeParse(create.input).success);
  assert.doesNotMatch(JSON.stringify(create.input), /Unknown/);

  const saved = project(create.input);
  saved.brief_version.brief.facts.push({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    statement: 'User supplied fact',
    source: { kind: 'user', captured_at: createdAt },
    user_confirmed: true,
  });
  const updateDraft = completeDraft();
  updateDraft.goal = 'Updated user-confirmed benefit';
  const update = validateProductDraft(updateDraft, saved, nextRequestId);
  assert.equal(update.ok, true);
  if (!update.ok) return;
  assert.equal(update.input.project_id, projectId);
  assert.equal(update.input.expected_version, 1);
  assert.equal(update.input.name, update.input.brief.product);
  assert.deepEqual(update.input.brief.facts, saved.brief_version.brief.facts,
    'an update preserves only facts from the trusted saved snapshot');
});

test('the editor requires a real description and enforces every persisted bound', () => {
  const cases: Array<[string, ReturnType<typeof completeDraft>, string]> = [
    ['product', { ...completeDraft(), product: 'Unknown' }, 'product'],
    ['description', { ...completeDraft(), description: ' ' }, 'description'],
    ['audience', { ...completeDraft(), audience: '' }, 'audience'],
    ['goal', { ...completeDraft(), goal: '' }, 'goal'],
    ['tone', { ...completeDraft(), tone: '' }, 'tone'],
    ['language', { ...completeDraft(), language: '' }, 'language'],
    ['duration low', { ...completeDraft(), duration_seconds: '4' }, 'duration_seconds'],
    ['duration high', { ...completeDraft(), duration_seconds: '181' }, 'duration_seconds'],
    ['duration decimal', { ...completeDraft(), duration_seconds: '20.5' }, 'duration_seconds'],
    ['constraint empty', { ...completeDraft(), filming_constraints: [' '] }, 'filming_constraints'],
    ['constraint long', { ...completeDraft(), filming_constraints: ['x'.repeat(501)] }, 'filming_constraints'],
    ['too many constraints', { ...completeDraft(), filming_constraints: Array.from({ length: 21 }, () => 'Tripod') }, 'filming_constraints'],
  ];
  for (const [label, draft, field] of cases) {
    const result = validateProductDraft(draft, null, requestId);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.ok(result.errors[field as keyof typeof result.errors], label);
  }
});

test('strict save parsing requires a matching successful receipt and complete saved snapshot', () => {
  const input = successfulInput();
  const saved = project(input);
  const valid = parseProductSaveResult({ structuredContent: {
    ok: true,
    data: { project: saved, request_id: requestId },
  } }, input);
  assert.equal(valid.status, 'saved');
  const reorderedBrief = Object.fromEntries(Object.entries(saved.brief_version.brief).reverse());
  const reordered = {
    ...saved,
    brief_version: { ...saved.brief_version, brief: reorderedBrief },
  };
  assert.equal(parseProductSaveResult({ structuredContent: {
    ok: true, data: { project: reordered, request_id: requestId },
  } }, input).status, 'saved', 'JSON object key order is not part of the receipt contract');

  for (const raw of [
    { structuredContent: { ok: true, data: { project: saved, request_id: nextRequestId } } },
    { structuredContent: { ok: true, data: { project: { ...saved, name: 'Other' }, request_id: requestId } } },
    { structuredContent: { ok: true, data: { project: saved, request_id: requestId, extra: true } } },
    { structuredContent: { ok: true, data: { project: saved, request_id: requestId } }, isError: true },
    { structuredContent: { ok: true, data: {} } },
  ]) assert.equal(parseProductSaveResult(raw, input).status, 'malformed');

  const failure = parseProductSaveResult({ structuredContent: { ok: false, error: {
    code: 'UNAVAILABLE', message: 'private transport detail', retryable: true, recovery: 'retry_same_request',
  } } }, input);
  assert.deepEqual(failure, { status: 'failure', failure: { code: 'UNAVAILABLE', recovery: 'retry_same_request' } });
});

test('save and get require a strict CallToolResult envelope', () => {
  const input = successfulInput();
  const saved = project(input);
  const saveContent = { ok: true, data: { project: saved, request_id: requestId } };
  const getContent = { ok: true, data: { project: saved } };
  assert.equal(parseProductSaveResult({
    content: [{ type: 'text', text: 'Product context saved.', annotations: { audience: ['assistant'], priority: 1 } }],
    structuredContent: saveContent, isError: false, _meta: { trace: { sampled: false } },
  }, input).status, 'saved');
  assert.equal(parseProductGetResult({
    content: [{ type: 'resource_link', name: 'project', uri: 'ui://riff/project', mimeType: 'application/json' }],
    structuredContent: getContent, isError: false, _meta: {},
  }, projectId).status, 'loaded');

  const accessor = Object.defineProperty({}, 'structuredContent', { get: () => saveContent, enumerable: true });
  const inherited = Object.assign(Object.create({ inherited: true }), { structuredContent: saveContent });
  const hiddenOuter = Object.defineProperty({ structuredContent: saveContent }, 'hidden', { value: true });
  const hiddenStructured = Object.defineProperty({}, 'structuredContent', { value: saveContent, enumerable: false });
  const symbolOuter = { structuredContent: saveContent, [Symbol('smuggled')]: true };
  const innerHidden = Object.defineProperty({ ...saveContent }, 'hidden', { value: true });
  const innerSymbol = { ...saveContent, [Symbol('smuggled')]: true };
  const malformedSave = [
    saveContent,
    {},
    { content: [] },
    { structuredContent: saveContent, extra: true },
    { structuredContent: saveContent, isError: 'false' },
    { structuredContent: saveContent, isError: undefined },
    { structuredContent: saveContent, content: {} },
    { structuredContent: saveContent, content: undefined },
    { structuredContent: saveContent, content: [{ type: 'text' }] },
    { structuredContent: saveContent, content: [{ type: 'unknown', text: 'no' }] },
    { structuredContent: saveContent, _meta: [] },
    { structuredContent: saveContent, _meta: undefined },
    { structuredContent: saveContent, _meta: Object.create({ inherited: true }) },
    accessor,
    inherited,
    hiddenOuter,
    hiddenStructured,
    symbolOuter,
    { structuredContent: innerHidden },
    { structuredContent: innerSymbol },
  ];
  for (const raw of malformedSave) assert.equal(parseProductSaveResult(raw, input).status, 'malformed');

  const getAccessor = Object.defineProperty({}, 'structuredContent', { get: () => getContent, enumerable: true });
  const getSymbol = { structuredContent: getContent, [Symbol('smuggled')]: true };
  const getHidden = Object.defineProperty({ structuredContent: getContent }, 'hidden', { value: true });
  const malformedGet = [
    getContent,
    {},
    { structuredContent: getContent, extra: true },
    { structuredContent: getContent, isError: 0 },
    { structuredContent: getContent, isError: undefined },
    { structuredContent: getContent, content: [Object.defineProperty({ type: 'text', text: 'read' }, 'hidden', { value: true })] },
    getAccessor,
    getSymbol,
    getHidden,
  ];
  for (const raw of malformedGet) assert.equal(parseProductGetResult(raw, projectId).status, 'malformed');
});

test('strict get parsing accepts historical snapshots but only for the trusted project ID', () => {
  const input = successfulInput();
  const historical = project(input, 1, false);
  const loaded = parseProductGetResult({ structuredContent: { ok: true, data: { project: historical } } }, projectId);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.equal(loaded.project.brief_version.brief.description, undefined);
  assert.equal(parseProductGetResult({ structuredContent: { ok: true, data: { project: historical } } },
    'ffffffff-ffff-4fff-8fff-ffffffffffff').status, 'malformed');
  assert.equal(parseProductGetResult({ structuredContent: { ok: true, data: { project: historical, extra: true } } },
    projectId).status, 'malformed');
});

test('product failures are specific, safe, and distinguish retry from reconciliation', () => {
  assert.match(productFailureMessage('UNAUTHENTICATED'), /Reconnect Riff.*product context/i);
  assert.match(productFailureMessage('FORBIDDEN'), /cannot save this product context/i);
  assert.match(productFailureMessage('VALIDATION_ERROR'), /product brief/i);
  assert.match(productFailureMessage('VERSION_CONFLICT'), /newer saved version/i);
  assert.match(productFailureMessage('NOT_FOUND'), /saved product context.*unavailable/i);
  assert.match(productFailureMessage('IDEMPOTENCY_CONFLICT'), /change.*confirm/i);
  assert.match(productFailureMessage('UNAVAILABLE'), /same save/i);
});
