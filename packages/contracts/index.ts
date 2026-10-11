import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0' as const;
export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
export const HttpUrl = z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
}, 'Use an HTTP(S) URL without embedded credentials');

export const Fact = z.strictObject({
  id: Id,
  statement: text(1000),
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('user'), captured_at: Timestamp }),
    z.strictObject({ kind: z.literal('url'), url: HttpUrl, captured_at: Timestamp }),
  ]),
  user_confirmed: z.boolean(),
});
export const Brief = z.strictObject({
  product: text(4000),
  audience: text(1000),
  goal: text(1000),
  tone: text(200),
  language: text(35),
  duration_seconds: z.number().int().min(5).max(180),
  filming_constraints: z.array(text(500)).max(20),
  facts: z.array(Fact).max(50).refine(
    (facts) => new Set(facts.map((fact) => fact.id)).size === facts.length,
    'Fact IDs must be unique within a brief',
  ),
});

export const Account = z.strictObject({
  id: Id, display_name: text(120), state: z.enum(['active', 'suspended']),
  preferred_language: text(35), created_at: Timestamp, onboarding_seen_at: Timestamp.nullable(),
});
export const BriefVersion = z.strictObject({
  id: Id, project_id: Id, version: z.number().int().positive(),
  name: text(120), brief: Brief, created_at: Timestamp,
});
export const Project = z.strictObject({
  id: Id, name: text(120), project_type: z.literal('brand'),
  current_version: z.number().int().positive(),
  created_at: Timestamp, updated_at: Timestamp, brief_version: BriefVersion,
}).refine((project) => project.id === project.brief_version.project_id
  && project.current_version === project.brief_version.version
  && project.name === project.brief_version.name, 'Project snapshot must match its brief version');

export const ErrorCode = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_ERROR', 'NOT_FOUND',
  'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const OperationError = z.strictObject({
  code: ErrorCode, message: text(500), retryable: z.boolean(),
  recovery: z.enum(['reauthorize', 'correct_input', 'reload', 'retry_same_request', 'contact_support']),
});
export const Failure = z.strictObject({ ok: z.literal(false), error: OperationError });
export type Failure = z.infer<typeof Failure>;
export const result = <T extends z.ZodType>(data: T) => z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data }), Failure,
]);
export const GetAccountStateInput = z.strictObject({});
export const GetAccountStateOutput = result(z.strictObject({
  account: Account,
  entitlements: z.strictObject({ status: z.literal('not_configured') }),
  usage: z.strictObject({ status: z.literal('not_configured'), reset_at: z.null() }),
}));
export const MarkRiffOnboardingSeenInput = z.strictObject({});
export const MarkRiffOnboardingSeenOutput = result(z.strictObject({ onboarding_seen_at: Timestamp }));
export const GetProjectInput = z.strictObject({ project_id: Id });
export const GetProjectOutput = result(z.strictObject({ project: Project }));
export const SaveProjectInput = z.strictObject({
  request_id: Id,
  project_id: Id.nullable(),
  expected_version: z.number().int().min(0).max(2147483646),
  name: text(120),
  project_type: z.literal('brand'),
  brief: Brief,
}).refine((input) => input.project_id === null ? input.expected_version === 0 : input.expected_version > 0,
  'Creation requires project_id null and expected_version 0; update requires ID and positive version');
export const SaveProjectOutput = result(z.strictObject({ project: Project, request_id: Id }));
export type SaveProjectInput = z.infer<typeof SaveProjectInput>;
export type Project = z.infer<typeof Project>;
export type Account = z.infer<typeof Account>;

// Registration metadata is shared now; product handlers are deliberately not registered yet.
export const toolContracts = {
  get_account_state: { input: GetAccountStateInput, output: GetAccountStateOutput, scope: 'account:read', readOnly: true },
  mark_riff_onboarding_seen: {
    input: MarkRiffOnboardingSeenInput,
    output: MarkRiffOnboardingSeenOutput,
    scope: 'account:read',
    readOnly: false,
  },
  get_project: { input: GetProjectInput, output: GetProjectOutput, scope: 'projects:read', readOnly: true },
  save_project: { input: SaveProjectInput, output: SaveProjectOutput, scope: 'projects:write', readOnly: false },
} as const;
