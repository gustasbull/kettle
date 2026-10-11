import type { CreatorTaskDefer } from '../../packages/application/creator-pipeline.ts';

type ExecutionContextLike = { waitUntil(task: Promise<unknown>): void };

/** Worker-only adapter. The database outbox, not this bounded task, is durable. */
export function createExecutionContextDefer(context: ExecutionContextLike): CreatorTaskDefer {
  return task => context.waitUntil(task.catch(() => undefined));
}
