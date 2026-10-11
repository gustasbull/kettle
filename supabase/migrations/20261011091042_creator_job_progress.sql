-- Safe, append-only creator-job progress. No provider allowance or receipt state is changed here.
drop trigger creator_job_history on public.creator_jobs;

alter table public.creator_jobs add column stage text default 'accepted'
  check(stage in ('accepted','reviewing_video','reading_profile','reading_posts','building_analysis','researching_formats','enriching_references','saving'));
alter table public.creator_jobs add column progress jsonb;
update public.creator_jobs set
  stage=case when state='succeeded' then 'saving' else 'accepted' end,
  progress=case kind
    when 'scan' then '{"kind":"scan","profile":null,"videos":[],"limitations":[]}'::jsonb
    when 'recommendations' then '{"kind":"recommendations","identities":[],"references":[],"limitations":[]}'::jsonb
    else '{"kind":"scripts","limitations":[]}'::jsonb end;
alter table public.creator_jobs alter column stage set not null;
alter table public.creator_jobs alter column progress set not null;

alter table public.creator_job_events add column stage text;
alter table public.creator_job_events add column progress jsonb;
update public.creator_job_events e set
  stage=case when e.state='succeeded' then 'saving' else 'accepted' end,
  progress=case j.kind
    when 'scan' then '{"kind":"scan","profile":null,"videos":[],"limitations":[]}'::jsonb
    when 'recommendations' then '{"kind":"recommendations","identities":[],"references":[],"limitations":[]}'::jsonb
    else '{"kind":"scripts","limitations":[]}'::jsonb end
from public.creator_jobs j where j.id=e.job_id;
alter table public.creator_job_events alter column stage set not null;
alter table public.creator_job_events alter column progress set not null;

create table public.creator_job_checkpoints (
  job_id uuid not null references public.creator_jobs(id),
  key text not null check(length(key) between 1 and 200 and key ~ '^[a-z0-9][a-z0-9:_-]{0,199}$'),
  stage text not null check(stage in ('accepted','reviewing_video','reading_profile','reading_posts','building_analysis','researching_formats','enriching_references','saving')),
  progress jsonb not null check(jsonb_typeof(progress)='object' and octet_length(progress::text)<=131072),
  revision integer not null check(revision>0), created_at timestamptz not null default now(),
  primary key(job_id,key), unique(job_id,revision),
  foreign key(job_id,revision) references public.creator_job_events(job_id,revision)
);
alter table public.creator_job_checkpoints enable row level security;
revoke all on public.creator_job_checkpoints from public,anon,authenticated,service_role;
grant select on public.creator_job_checkpoints to service_role;

create function public.kettle_creator_empty_progress(p_kind text) returns jsonb language sql immutable security invoker set search_path='' as $$
 select case p_kind when 'scan' then '{"kind":"scan","profile":null,"videos":[],"limitations":[]}'::jsonb
  when 'recommendations' then '{"kind":"recommendations","identities":[],"references":[],"limitations":[]}'::jsonb
  else '{"kind":"scripts","limitations":[]}'::jsonb end;
$$;

create function public.kettle_jsonb_exact_keys(p_value jsonb,p_required text[],p_optional text[] default '{}'::text[])
returns boolean language sql immutable security invoker set search_path='' as $$
 select jsonb_typeof(p_value)='object'
  and not exists(select 1 from unnest(p_required) k where not p_value ? k)
  and not exists(select 1 from jsonb_object_keys(p_value) k where not (k=any(p_required) or k=any(p_optional)));
$$;

create function public.kettle_creator_stage_rank(p_kind text,p_stage text) returns integer language sql immutable security invoker set search_path='' as $$
 select case p_kind
  when 'scan' then case p_stage when 'accepted' then 0 when 'reviewing_video' then 1 when 'reading_profile' then 2 when 'reading_posts' then 3 when 'building_analysis' then 4 when 'saving' then 5 end
  when 'recommendations' then case p_stage when 'accepted' then 0 when 'researching_formats' then 1 when 'enriching_references' then 2 when 'saving' then 3 end
  when 'scripts' then case p_stage when 'accepted' then 0 when 'building_analysis' then 1 when 'saving' then 2 end end;
$$;

create function public.kettle_creator_progress_valid(p_kind text,p_progress jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; p jsonb;
begin
 if jsonb_typeof(p_progress)<>'object' or p_progress->>'kind' is distinct from p_kind
   or octet_length(p_progress::text)>131072 then return false; end if;
 if p_kind='scan' then
  if not public.kettle_jsonb_exact_keys(p_progress,array['kind','profile','videos','limitations'])
    or jsonb_typeof(p_progress->'videos')<>'array' or jsonb_array_length(p_progress->'videos')>10
    or jsonb_typeof(p_progress->'limitations')<>'array' or jsonb_array_length(p_progress->'limitations')>20 then return false; end if;
  if p_progress->'profile'<>'null'::jsonb and not public.kettle_jsonb_exact_keys(p_progress->'profile',
    array['platform','native_id','url','handle','display_name','bio','follower_count','provenance'],array['avatar_url']) then return false; end if;
  for v in select value from jsonb_array_elements(p_progress->'videos') loop
   if not public.kettle_jsonb_exact_keys(v,array['platform','native_id','url','caption','published_at','duration_seconds','metrics','provenance'],array['thumbnail_url'])
    or not public.kettle_jsonb_exact_keys(v->'metrics',array['views','likes','comments','shares'],array['saves']) then return false; end if;
  end loop;
 elsif p_kind='recommendations' then
  if not public.kettle_jsonb_exact_keys(p_progress,array['kind','identities','references','limitations'])
    or jsonb_typeof(p_progress->'identities')<>'array' or jsonb_array_length(p_progress->'identities')>3
    or jsonb_typeof(p_progress->'references')<>'array' or jsonb_array_length(p_progress->'references')>3
    or jsonb_typeof(p_progress->'limitations')<>'array' or jsonb_array_length(p_progress->'limitations')>20 then return false; end if;
  for v in select value from jsonb_array_elements(p_progress->'identities') loop
   if not public.kettle_jsonb_exact_keys(v,array['platform','native_id','url','retrieved_at','origin','permission_basis','limitations']) then return false; end if;
  end loop;
  for v in select value from jsonb_array_elements(p_progress->'references') loop
   if not public.kettle_jsonb_exact_keys(v,array['platform','native_id','url','caption','published_at','duration_seconds','metrics','provenance'],array['thumbnail_url'])
    or not public.kettle_jsonb_exact_keys(v->'metrics',array['views','likes','comments','shares'],array['saves']) then return false; end if;
  end loop;
  for v,p in select r.value,i.value from jsonb_array_elements(p_progress->'references') with ordinality r(value,n)
   left join jsonb_array_elements(p_progress->'identities') with ordinality i(value,n) using(n) loop
   if p is null or (v->>'platform',v->>'native_id',v->>'url') is distinct from (p->>'platform',p->>'native_id',p->>'url') then return false; end if;
  end loop;
 elsif p_kind='scripts' then
  if not public.kettle_jsonb_exact_keys(p_progress,array['kind','limitations'])
    or jsonb_typeof(p_progress->'limitations')<>'array' or jsonb_array_length(p_progress->'limitations')>20 then return false; end if;
 else return false; end if;
 -- All progress provenance is a strict display projection, never a provider receipt.
 for p in select value from jsonb_path_query(p_progress,'strict $.**.provenance') provenance(value) loop
  if not public.kettle_jsonb_exact_keys(p,array['origin','retrieved_at','source_observed_at','permission_basis','limitations']) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;

create function public.kettle_creator_progress_advances(p_kind text,p_old jsonb,p_new jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare n integer; old_len integer; new_len integer;
begin
 if not public.kettle_creator_progress_valid(p_kind,p_new) or p_old=p_new then return false; end if;
 if p_kind='scan' then
  if p_old->'profile'<>'null'::jsonb and p_new->'profile' is distinct from p_old->'profile' then return false; end if;
  foreach n in array array[0,1] loop
   old_len:=jsonb_array_length(case n when 0 then p_old->'videos' else p_old->'limitations' end);
   new_len:=jsonb_array_length(case n when 0 then p_new->'videos' else p_new->'limitations' end);
   if new_len<old_len then return false; end if;
   if exists(select 1 from generate_series(0,old_len-1) i where
     (case n when 0 then p_new->'videos' else p_new->'limitations' end)->i is distinct from
     (case n when 0 then p_old->'videos' else p_old->'limitations' end)->i) then return false; end if;
  end loop;
 elsif p_kind='recommendations' then
  foreach n in array array[0,1,2] loop
   old_len:=jsonb_array_length(case n when 0 then p_old->'identities' when 1 then p_old->'references' else p_old->'limitations' end);
   new_len:=jsonb_array_length(case n when 0 then p_new->'identities' when 1 then p_new->'references' else p_new->'limitations' end);
   if new_len<old_len then return false; end if;
   if exists(select 1 from generate_series(0,old_len-1) i where
     (case n when 0 then p_new->'identities' when 1 then p_new->'references' else p_new->'limitations' end)->i is distinct from
     (case n when 0 then p_old->'identities' when 1 then p_old->'references' else p_old->'limitations' end)->i) then return false; end if;
  end loop;
 else
  old_len:=jsonb_array_length(p_old->'limitations');new_len:=jsonb_array_length(p_new->'limitations');
  if new_len<old_len or exists(select 1 from generate_series(0,old_len-1) i where p_new->'limitations'->i is distinct from p_old->'limitations'->i) then return false; end if;
 end if;
 return true;
end; $$;

create or replace function public.kettle_creator_job_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.stage<>'accepted' or new.progress<>public.kettle_creator_empty_progress(new.kind) then raise exception 'invalid creator job initial progress'; end if;
 else
  if old.state in ('succeeded','failed','needs_reconciliation') or new.input is distinct from old.input
    or new.captured is distinct from old.captured or new.request_id<>old.request_id or new.account_id<>old.account_id
    or new.project_id<>old.project_id or new.kind<>old.kind or new.id<>old.id or new.created_at<>old.created_at
    or new.revision<>old.revision+1 then raise exception 'immutable creator job or invalid transition'; end if;
  if old.state='running' and new.state='running' then
   if new.result is distinct from old.result
     or new.message is distinct from old.message or new.stage is not distinct from old.stage and new.progress is not distinct from old.progress
     then raise exception 'immutable creator job or invalid transition'; end if;
  elsif not ((old.state='queued' and new.state in ('running','failed','needs_reconciliation'))
    or (old.state='running' and new.state in ('succeeded','failed','needs_reconciliation'))) or
    new.stage is distinct from old.stage or new.progress is distinct from old.progress then
   raise exception 'immutable creator job or invalid transition';
  end if;
 end if;
 insert into public.creator_job_events(job_id,revision,state,result,message,stage,progress)
 values(new.id,new.revision,new.state,new.result,new.message,new.stage,new.progress);
 return new;
end; $$;
create trigger creator_job_history after insert or update on public.creator_jobs for each row execute function public.kettle_creator_job_history();

create or replace function public.kettle_start_creator_job(p_account_id uuid,p_input jsonb,p_kind text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype; parent public.creator_jobs%rowtype; stored jsonb; captured jsonb; pid uuid; req uuid:=(p_input->>'request_id')::uuid; url text;
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;
 if not found then return public.kettle_error('FORBIDDEN'); end if;
 select * into j from public.creator_jobs where account_id=p_account_id and request_id=req;
 if found then
  if j.kind<>p_kind or j.input<>p_input then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
  return public.kettle_get_creator_job(p_account_id,jsonb_build_object('job_id',j.id));
 end if;
 if req is null then return public.kettle_error('VALIDATION_ERROR'); end if;
 if p_kind='scan' then
  pid:=(p_input->>'project_id')::uuid;captured:=jsonb_build_object('scan',p_input->'scan');
  if p_input ? 'seed_url' then captured:=captured||jsonb_build_object('seed_url',p_input->'seed_url'); end if;
 elsif p_kind='recommendations' then
  stored:=public.kettle_get_creator_dna(p_account_id,jsonb_build_object('dna_id',p_input->>'dna_id'));
  if stored->>'ok'<>'true' then return stored; end if;stored:=stored->'data';
  if (stored#>>'{analysis,dna,version}')::integer is distinct from (p_input->>'expected_version')::integer then return public.kettle_error('VERSION_CONFLICT'); end if;
  pid:=(stored->>'project_id')::uuid;captured:=jsonb_build_object('stored',stored);
 elsif p_kind='scripts' then
  select * into parent from public.creator_jobs where account_id=p_account_id and kind='recommendations' and state='succeeded' and result#>>'{batch,id}'=p_input->>'batch_id';
  if not found then return public.kettle_error('NOT_FOUND'); end if;
  if not exists(select 1 from jsonb_array_elements(parent.result#>'{batch,ideas}') i where i->>'id'=p_input->>'idea_id') then return public.kettle_error('NOT_FOUND'); end if;
  pid:=parent.project_id;captured:=jsonb_build_object('stored',parent.captured->'stored','batch',parent.result->'batch','idea_id',p_input->>'idea_id');
  if p_input ? 'variants' then captured:=captured||jsonb_build_object('variants',p_input->'variants'); end if;
 else return public.kettle_error('VALIDATION_ERROR'); end if;
 perform 1 from public.projects where id=pid and account_id=p_account_id;if not found then return public.kettle_error('NOT_FOUND'); end if;
 url:=public.kettle_creator_profile_url(captured);
 if not public.kettle_creator_project_authorized(p_account_id,pid,url) then return public.kettle_error('FORBIDDEN'); end if;
 if p_kind in ('scan','recommendations') and exists(select 1 from public.creator_pipeline_allowances al where al.account_id=p_account_id and al.profile_url=url and al.riff_managed)
   and exists(select 1 from public.creator_jobs existing where existing.account_id=p_account_id and existing.project_id=pid and existing.kind=p_kind)
   then return public.kettle_error('FORBIDDEN'); end if;
 insert into public.creator_jobs(account_id,project_id,kind,input,captured,request_id,stage,progress)
 values(p_account_id,pid,p_kind,p_input,captured,req,'accepted',public.kettle_creator_empty_progress(p_kind)) returning * into j;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end; $$;

create or replace function public.kettle_finish_creator_job(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype; s text:=p_input->>'state'; r jsonb:=nullif(p_input->'result','null'::jsonb); m text:=p_input->>'message';
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN'); end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;if not found then return public.kettle_error('NOT_FOUND'); end if;
 if s is null or s not in ('succeeded','failed','needs_reconciliation') or length(m)>1000 or
   (s='succeeded' and (r is null or r->>'kind' is distinct from j.kind)) or (s<>'succeeded' and r is not null)
   then return public.kettle_error('VALIDATION_ERROR'); end if;
 if j.state in ('succeeded','failed','needs_reconciliation') then
  if j.state<>s or j.result is distinct from r or j.message is distinct from m then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
 elsif j.state='queued' and s='succeeded' then return public.kettle_error('VALIDATION_ERROR');
 elsif s='succeeded' and exists(select 1 from public.creator_attempts a left join public.creator_attempt_receipts ar on (ar.job_id,ar.key)=(a.job_id,a.key) where a.job_id=j.id and ar.job_id is null)
  then return public.kettle_error('FORBIDDEN');
 elsif s='succeeded' and j.stage<>'saving' then return public.kettle_error('VALIDATION_ERROR');
 else update public.creator_jobs set state=s,result=r,message=m,revision=revision+1,updated_at=now() where id=j.id returning * into j; end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end; $$;

create function public.kettle_checkpoint_creator_job(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.creator_jobs%rowtype;c public.creator_job_checkpoints%rowtype;k text:=p_input->>'key';s text:=p_input->>'stage';p jsonb:=p_input->'progress';expected integer;
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN'); end if;
 if jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>5
  or not (p_input ?& array['job_id','key','expected_revision','stage','progress']) then return public.kettle_error('VALIDATION_ERROR'); end if;
 begin expected:=(p_input->>'expected_revision')::integer;exception when others then return public.kettle_error('VALIDATION_ERROR');end;
 if k is null or k!~'^[a-z0-9][a-z0-9:_-]{0,199}$' or expected is null or expected<1 then return public.kettle_error('VALIDATION_ERROR'); end if;
 select cp.* into c from public.creator_job_checkpoints cp join public.creator_jobs owned on owned.id=cp.job_id and owned.account_id=p_account_id
  where cp.job_id=(p_input->>'job_id')::uuid and cp.key=k;
 if found then
  if c.stage is distinct from s or c.progress is distinct from p then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
  select * into j from public.creator_jobs where id=c.job_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('status','replay','checkpoint',jsonb_build_object(
   'key',c.key,'stage',c.stage,'progress',c.progress,'revision',c.revision,'created_at',c.created_at),'revision',j.revision));
 end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;
 if not found then return public.kettle_error('NOT_FOUND'); end if;
 if j.state<>'running' then return public.kettle_error('FORBIDDEN'); end if;
 if j.revision<>expected then return public.kettle_error('VERSION_CONFLICT'); end if;
 if public.kettle_creator_stage_rank(j.kind,s) is null or public.kettle_creator_stage_rank(j.kind,s)<public.kettle_creator_stage_rank(j.kind,j.stage)
   or (j.kind='scan' and s='reviewing_video' and not (j.captured ? 'seed_url'))
   or not public.kettle_creator_progress_valid(j.kind,p) then return public.kettle_error('VALIDATION_ERROR'); end if;
 if s=j.stage and not public.kettle_creator_progress_advances(j.kind,j.progress,p) then return public.kettle_error('VALIDATION_ERROR'); end if;
 if s<>j.stage and j.progress<>p and not public.kettle_creator_progress_advances(j.kind,j.progress,p) then return public.kettle_error('VALIDATION_ERROR'); end if;
 update public.creator_jobs set stage=s,progress=p,revision=revision+1,updated_at=now() where id=j.id returning * into j;
 insert into public.creator_job_checkpoints(job_id,key,stage,progress,revision) values(j.id,k,s,p,j.revision) returning * into c;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status','stored','checkpoint',jsonb_build_object(
  'key',c.key,'stage',c.stage,'progress',c.progress,'revision',c.revision,'created_at',c.created_at),'revision',j.revision));
exception when invalid_text_representation or numeric_value_out_of_range then return public.kettle_error('VALIDATION_ERROR');
end; $$;

create function public.kettle_get_creator_job_status(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype;
begin
 if jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>1 or not p_input ? 'job_id' then return public.kettle_error('VALIDATION_ERROR'); end if;
 perform 1 from public.accounts where id=p_account_id and state='active';if not found then return public.kettle_error('FORBIDDEN'); end if;
 select owned.* into j from public.creator_jobs owned join public.projects project on (project.id,project.account_id)=(owned.project_id,owned.account_id)
  where owned.id=(p_input->>'job_id')::uuid and owned.account_id=p_account_id;
 if not found then return public.kettle_error('NOT_FOUND'); end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status',jsonb_build_object(
  'id',j.id,'kind',j.kind,'state',j.state,'stage',j.stage,'revision',j.revision,'created_at',j.created_at,
  'updated_at',j.updated_at,'progress',j.progress,'terminal_result_available',j.state='succeeded' and j.result is not null)));
exception when invalid_text_representation then return public.kettle_error('VALIDATION_ERROR');
end; $$;

revoke all on function public.kettle_creator_empty_progress(text),public.kettle_jsonb_exact_keys(jsonb,text[],text[]),
 public.kettle_creator_stage_rank(text,text),public.kettle_creator_progress_valid(text,jsonb),public.kettle_creator_progress_advances(text,jsonb,jsonb),
 public.kettle_checkpoint_creator_job(uuid,jsonb),public.kettle_get_creator_job_status(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.kettle_creator_empty_progress(text),public.kettle_jsonb_exact_keys(jsonb,text[],text[]),
 public.kettle_creator_stage_rank(text,text),public.kettle_creator_progress_valid(text,jsonb),public.kettle_creator_progress_advances(text,jsonb,jsonb),
 public.kettle_checkpoint_creator_job(uuid,jsonb),public.kettle_get_creator_job_status(uuid,jsonb) to service_role;
