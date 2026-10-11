import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Failure } from '../../packages/contracts/index.ts';

// ChatGPT loads this schema during app refresh. Keep the stable result envelope
// discoverable without repeating each tool's potentially large data projection.
// Application operations still validate every complete tool-specific result.
const PublishedResultEnvelope = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: z.unknown() }),
  Failure,
]);

export const PUBLISHED_RESULT_OUTPUT_SCHEMA = ToolSchema.shape.outputSchema.parse({
  ...z.toJSONSchema(PublishedResultEnvelope),
  type: 'object',
});
