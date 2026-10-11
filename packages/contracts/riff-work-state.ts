import { z } from 'zod';

const Id=z.uuid();
const Timestamp=z.iso.datetime({offset:true});
const Failure=z.strictObject({ok:z.literal(false),error:z.strictObject({
  code:z.enum(['UNAUTHENTICATED','FORBIDDEN','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','UNAVAILABLE']),
  message:z.string().trim().min(1).max(500),retryable:z.boolean(),
  recovery:z.enum(['reauthorize','correct_input','reload','retry_same_request','contact_support']),
})});
const result=<T extends z.ZodType>(data:T)=>z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),data}),Failure]);

export const RiffWorkStateValue=z.enum(['active','saved','filmed']);
export const RiffWorkState=z.strictObject({
  job_id:Id,variant_id:Id,state:RiffWorkStateValue,
  version:z.number().int().positive().max(2_147_483_647),updated_at:Timestamp,
});
export const SetRiffWorkStateInput=z.strictObject({
  job_id:Id,variant_id:Id,state:RiffWorkStateValue,
  expected_version:z.number().int().min(0).max(2_147_483_646),request_id:Id,
});
export const SetRiffWorkStateOutput=result(z.strictObject({work_state:RiffWorkState}));
export const riffWorkStateContract={input:SetRiffWorkStateInput,output:SetRiffWorkStateOutput,
  scope:'projects:write',readOnly:false} as const;
export const riffWorkStateContracts={set_riff_work_state:riffWorkStateContract} as const;

export type RiffWorkState=z.infer<typeof RiffWorkState>;
export type RiffWorkStateValue=z.infer<typeof RiffWorkStateValue>;
export type SetRiffWorkStateInput=z.infer<typeof SetRiffWorkStateInput>;
export type SetRiffWorkStateOutput=z.infer<typeof SetRiffWorkStateOutput>;
