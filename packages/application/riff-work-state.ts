import { Id } from '../contracts/index.ts';
import { SetRiffWorkStateInput,SetRiffWorkStateOutput,type SetRiffWorkStateInput as WorkInput } from '../contracts/riff-work-state.ts';
import { failure,type IdentityVerifier } from './operations.ts';

export interface RiffWorkStateRepository { set(accountId:string,input:WorkInput):Promise<unknown> }

export function createRiffWorkStateOperations(verifier:IdentityVerifier,repository:RiffWorkStateRepository){
  return {async execute(credential:string|null,raw:unknown){
    if(!credential)return failure('UNAUTHENTICATED');
    let identity;try{identity=await verifier.verify(credential);}catch{return failure('UNAUTHENTICATED');}
    if(!identity||!Id.safeParse(identity.account_id).success)return failure('UNAUTHENTICATED');
    if(!identity.scopes.includes('projects:write'))return failure('FORBIDDEN');
    const input=SetRiffWorkStateInput.safeParse(raw);if(!input.success)return failure('VALIDATION_ERROR');
    try{return SetRiffWorkStateOutput.parse(await repository.set(identity.account_id,input.data));}
    catch{return failure('UNAVAILABLE');}
  }};
}
