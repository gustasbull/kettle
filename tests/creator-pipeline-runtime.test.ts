import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorWorkflowStepOptions } from '../apps/worker/creator-workflow-policy.ts';

test('provider steps remain zero-retry while checkpoint persistence uses durable non-provider retries',()=>{
 assert.deepEqual(creatorWorkflowStepOptions('provider:feed:0'),
  {retries:{limit:0,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 assert.deepEqual(creatorWorkflowStepOptions('checkpoint:scan:feed:0'),
  {retries:{limit:2,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 assert.deepEqual(creatorWorkflowStepOptions('save-result'),
  {retries:{limit:2,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 for(const unsafe of ['checkpoint:','provider:../secret','unknown-step','checkpoint:contains space'])
  assert.throws(()=>creatorWorkflowStepOptions(unsafe),/Invalid creator workflow step/);
});
