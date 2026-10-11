import { test } from 'node:test';
import assert from 'node:assert/strict';

test('waitUntil is called as an ExecutionContext method and does not block the caller', async () => {
  const module = await import('../apps/worker/deferred-dispatch.ts');
  const captured: Promise<unknown>[] = [];
  const context = {
    waitUntil(this: unknown, task: Promise<unknown>) {
      assert.equal(this, context);
      captured.push(task);
    },
  };
  let release!: () => void;
  const task = new Promise<void>(resolve => { release = resolve; });
  const defer = module.createExecutionContextDefer(context);
  assert.equal(defer(task), undefined);
  assert.equal(captured.length, 1);
  release();
  await captured[0];
});

test('background rejection is contained in the registered task', async () => {
  const module = await import('../apps/worker/deferred-dispatch.ts');
  let captured!: Promise<unknown>;
  const context = { waitUntil(task: Promise<unknown>) { captured = task; } };
  module.createExecutionContextDefer(context)(Promise.reject(new Error('workflow unavailable')));
  await assert.doesNotReject(captured);
});
