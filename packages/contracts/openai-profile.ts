import { z } from 'zod';
import { Id } from './index.ts';

/** Standard ChatGPT profile result. Keep this deliberately smaller than account state. */
export const OpenAIProfile = z.strictObject({
  id: Id,
  name: z.string().trim().min(1).max(120),
});

export type OpenAIProfile = z.infer<typeof OpenAIProfile>;
