-- Append-only sanitized terminal outcomes for already-reserved provider attempts.
create table public.creator_attempt_outcomes (
 job_id uuid not null,
 key text not null,
 provider text not null,
 operation text not null,
 terminal_state text not null check(terminal_state in ('failed','needs_reconciliation')),
 failure_code text not null check(failure_code in ('http_4xx','http_5xx','http_other','malformed_response','schema_invalid',
  'oversized_response','permission','unavailable','timeout','network','receipt_persistence_failed','unknown_after_dispatch')),
 http_status integer check(http_status between 100 and 599),
 observed_at timestamptz not null default now(),
 recorded_at timestamptz not null default now(),
 primary key(job_id,key), foreign key(job_id,key) references public.creator_attempts(job_id,key),
 check((terminal_state='failed' and failure_code in ('http_4xx','http_5xx','http_other','malformed_response','schema_invalid','oversized_response','permission','unavailable')) or
       (terminal_state='needs_reconciliation' and failure_code in ('timeout','network','receipt_persistence_failed','unknown_after_dispatch'))),
 check((failure_code='http_4xx' and http_status between 400 and 499) or
       (failure_code='http_5xx' and http_status between 500 and 599) or
       (failure_code='http_other' and http_status between 100 and 399 and http_status not between 200 and 299) or
       failure_code not in ('http_4xx','http_5xx','http_other'))
);
alter table public.creator_attempt_outcomes enable row level security;
revoke all on public.creator_attempt_outcomes from public,anon,authenticated,service_role;
grant select on public.creator_attempt_outcomes to service_role;

create function public.kettle_record_creator_attempt_outcome(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.creator_jobs%rowtype;a public.creator_attempts%rowtype;o public.creator_attempt_outcomes%rowtype;
 k text:=p_input->>'key';s text:=p_input->>'terminal_state';c text:=p_input->>'failure_code';h integer;
begin
 if jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>5 or
  not (p_input ?& array['job_id','key','terminal_state','failure_code','http_status']) then return public.kettle_error('VALIDATION_ERROR'); end if;
 begin h:=case when p_input->'http_status'='null'::jsonb then null else (p_input->>'http_status')::integer end;
 exception when others then return public.kettle_error('VALIDATION_ERROR');end;
 if k is null or k!~'^[A-Za-z0-9_:-]{1,200}$' or s not in ('failed','needs_reconciliation') or
  not ((s='failed' and c in ('http_4xx','http_5xx','http_other','malformed_response','schema_invalid','oversized_response','permission','unavailable')) or
       (s='needs_reconciliation' and c in ('timeout','network','receipt_persistence_failed','unknown_after_dispatch'))) or
  (h is not null and h not between 100 and 599) or (c='http_4xx' and (h is null or h not between 400 and 499)) or
  (c='http_5xx' and (h is null or h not between 500 and 599)) or
  (c='http_other' and (h is null or h not between 100 and 399 or h between 200 and 299))
  then return public.kettle_error('VALIDATION_ERROR');end if;
 perform 1 from public.accounts where id=p_account_id and state='active' for update;
 if not found then return public.kettle_error('FORBIDDEN');end if;
 begin select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;
 exception when invalid_text_representation then return public.kettle_error('VALIDATION_ERROR');end;
 if not found then return public.kettle_error('NOT_FOUND');end if;
 select * into a from public.creator_attempts where job_id=j.id and key=k for update;
 if not found then return public.kettle_error('NOT_FOUND');end if;
 select * into o from public.creator_attempt_outcomes where job_id=j.id and key=k;
 if found then
  if o.terminal_state is distinct from s or o.failure_code is distinct from c or o.http_status is distinct from h
   then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('status','replay','outcome',jsonb_build_object(
   'provider',o.provider,'operation',o.operation,'terminal_state',o.terminal_state,'failure_code',o.failure_code,
   'http_status',o.http_status,'observed_at',o.observed_at,'recorded_at',o.recorded_at)));
 end if;
 if j.state<>'running' then return public.kettle_error('FORBIDDEN');end if;
 if exists(select 1 from public.creator_attempt_receipts r where (r.job_id,r.key)=(j.id,k)) and
  (s='needs_reconciliation' or c not in ('schema_invalid','permission','unavailable'))
  then return public.kettle_error('FORBIDDEN');end if;
 insert into public.creator_attempt_outcomes(job_id,key,provider,operation,terminal_state,failure_code,http_status)
  values(j.id,k,a.provider,a.operation,s,c,h) returning * into o;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status','recorded','outcome',jsonb_build_object(
  'provider',o.provider,'operation',o.operation,'terminal_state',o.terminal_state,'failure_code',o.failure_code,
  'http_status',o.http_status,'observed_at',o.observed_at,'recorded_at',o.recorded_at)));
end;$$;

create or replace function public.kettle_reserve_creator_attempt(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype;a public.creator_attempts%rowtype;b public.creator_pipeline_budget%rowtype;
 g public.riff_creator_run_grants%rowtype;riff_managed boolean;o public.creator_attempt_outcomes%rowtype;
 k text:=p_input->>'key';provider text:=p_input->>'provider';op text:=p_input->>'operation';ceiling bigint:=(p_input->>'ceiling_microusd')::bigint;receipt jsonb;
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN');end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;if not found then return public.kettle_error('NOT_FOUND');end if;
 if k is null or length(k) not between 1 and 200 or ceiling is null or ceiling<0 or provider is null or op is null or not
  ((provider='scrapecreators' and op in ('profile','feed','video')) or (provider='lightreel' and op in ('research','poll')) or (provider='openai' and op='generate')) then return public.kettle_error('VALIDATION_ERROR');end if;
 select * into a from public.creator_attempts where job_id=j.id and key=k;
 if found then
  if a.provider<>provider or a.operation<>op or a.ceiling_microusd<>ceiling then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
  select * into o from public.creator_attempt_outcomes where job_id=j.id and key=k;
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('status',case when o.terminal_state='failed' then 'definite_failure' else 'needs_reconciliation' end,
   'outcome',jsonb_build_object('provider',o.provider,'operation',o.operation,'terminal_state',o.terminal_state,'failure_code',o.failure_code,
    'http_status',o.http_status,'observed_at',o.observed_at,'recorded_at',o.recorded_at)));end if;
  select ar.receipt into receipt from public.creator_attempt_receipts ar where ar.job_id=j.id and ar.key=k;
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('status','replay','receipt',receipt));end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('status','ambiguous'));
 end if;
 if j.state<>'running' then return public.kettle_error('FORBIDDEN');end if;
 select al.riff_managed into riff_managed from public.creator_pipeline_allowances al where al.account_id=p_account_id and al.profile_url=public.kettle_creator_profile_url(j.captured) and al.enabled and al.expires_at>now();
 if not found then return public.kettle_error('FORBIDDEN');end if;
 if riff_managed then select rg.* into g from public.riff_creator_project_grants pg join public.riff_creator_run_grants rg on (rg.id,rg.account_id)=(pg.grant_id,pg.account_id)
  where pg.account_id=p_account_id and pg.project_id=j.project_id and pg.profile_url=public.kettle_creator_profile_url(j.captured) and rg.state='consumed' and rg.expires_at>now() for update of rg;
  if not found then return public.kettle_error('FORBIDDEN');end if;end if;
 if (select count(*) from public.creator_attempts where job_id=j.id)>=32 then return public.kettle_error('FORBIDDEN');end if;
 if riff_managed and provider='openai' then return public.kettle_error('FORBIDDEN');end if;
 if ceiling>0 then select * into b from public.creator_pipeline_budget where id=1 for update;
  if not found or ceiling>b.limit_microusd-b.reserved_microusd then return public.kettle_error('FORBIDDEN');end if;end if;
 if riff_managed then
  if provider='scrapecreators' then update public.riff_creator_run_grants set scrapecreators_remaining=scrapecreators_remaining-1 where id=g.id and scrapecreators_remaining>=1;
  elsif provider='lightreel' then update public.riff_creator_run_grants set lightreel_remaining=lightreel_remaining-1 where id=g.id and lightreel_remaining>=1;
  else return public.kettle_error('FORBIDDEN');end if;if not found then return public.kettle_error('FORBIDDEN');end if;
 elsif ceiling=0 then if provider not in ('scrapecreators','lightreel') then return public.kettle_error('FORBIDDEN');end if;
  update public.creator_provider_trials t set remaining_units=t.remaining_units-1 where t.provider=p_input->>'provider' and t.enabled and t.expires_at>now() and t.remaining_units>=1;
  if not found then return public.kettle_error('FORBIDDEN');end if;end if;
 if ceiling>0 then update public.creator_pipeline_budget set reserved_microusd=reserved_microusd+ceiling where id=1;end if;
 insert into public.creator_attempts(job_id,key,provider,operation,ceiling_microusd) values(j.id,k,provider,op,ceiling);
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status','acquired'));
end;$$;

create or replace function public.kettle_complete_creator_attempt(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype;existing jsonb;r jsonb:=p_input->'receipt';k text:=p_input->>'key';
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN');end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;if not found then return public.kettle_error('NOT_FOUND');end if;
 if r is null or r='null'::jsonb or octet_length(r::text)>307200 then return public.kettle_error('VALIDATION_ERROR');end if;
 perform 1 from public.creator_attempts where job_id=j.id and key=k;if not found then return public.kettle_error('NOT_FOUND');end if;
 if exists(select 1 from public.creator_attempt_outcomes where job_id=j.id and key=k) then return public.kettle_error('FORBIDDEN');end if;
 select receipt into existing from public.creator_attempt_receipts where job_id=j.id and key=k;
 if found then if existing<>r then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
 else if j.state<>'running' then return public.kettle_error('FORBIDDEN');end if;insert into public.creator_attempt_receipts(job_id,key,receipt) values(j.id,k,r);end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status','completed','receipt',r));
end;$$;

create or replace function public.kettle_finish_creator_job(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype;s text:=p_input->>'state';r jsonb:=nullif(p_input->'result','null'::jsonb);m text:=p_input->>'message';
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN');end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;if not found then return public.kettle_error('NOT_FOUND');end if;
 if s is null or s not in ('succeeded','failed','needs_reconciliation') or length(m)>1000 or (s='succeeded' and (r is null or r->>'kind' is distinct from j.kind)) or (s<>'succeeded' and r is not null) then return public.kettle_error('VALIDATION_ERROR');end if;
 if j.state in ('succeeded','failed','needs_reconciliation') then if j.state<>s or j.result is distinct from r or j.message is distinct from m then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
 elsif j.state='queued' and s='succeeded' then return public.kettle_error('VALIDATION_ERROR');
 elsif s='succeeded' and (exists(select 1 from public.creator_attempts a left join public.creator_attempt_receipts ar on (ar.job_id,ar.key)=(a.job_id,a.key) where a.job_id=j.id and ar.job_id is null)
   or exists(select 1 from public.creator_attempt_outcomes o where o.job_id=j.id)) then return public.kettle_error('FORBIDDEN');
 elsif s='succeeded' and j.stage<>'saving' then return public.kettle_error('VALIDATION_ERROR');
 else update public.creator_jobs set state=s,result=r,message=m,revision=revision+1,updated_at=now() where id=j.id returning * into j;end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end;$$;

create function public.kettle_reconcile_creator_job(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.creator_jobs%rowtype;s text;m text;
begin
 if jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>1 or not p_input?'job_id' then return public.kettle_error('VALIDATION_ERROR');end if;
 perform 1 from public.accounts where id=p_account_id and state='active' for update;if not found then return public.kettle_error('FORBIDDEN');end if;
 begin select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;
 exception when invalid_text_representation then return public.kettle_error('VALIDATION_ERROR');end;
 if not found then return public.kettle_error('NOT_FOUND');end if;
 if j.state in ('succeeded','failed','needs_reconciliation') then return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));end if;
 if j.state='queued' or not exists(select 1 from public.creator_attempts where job_id=j.id) or
  exists(select 1 from public.creator_attempt_outcomes where job_id=j.id and terminal_state='needs_reconciliation') or
  exists(select 1 from public.creator_attempts a left join public.creator_attempt_receipts r on (r.job_id,r.key)=(a.job_id,a.key)
    left join public.creator_attempt_outcomes o on (o.job_id,o.key)=(a.job_id,a.key) where a.job_id=j.id and r.job_id is null and o.job_id is null)
 then s:='needs_reconciliation';m:='Workflow stopped with unresolved provider work.';
 else s:='failed';m:='Workflow ended without a durable product result.';end if;
 update public.creator_jobs set state=s,result=null,message=m,revision=revision+1,updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end;$$;

create function public.kettle_list_creator_attempt_reconciliation(p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare after_time timestamptz;before_time timestamptz;row_limit integer;provider_name text:=p_input->>'provider';
begin
 if jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>4 or
  not (p_input?&array['provider','attempted_after','attempted_before','limit']) then return public.kettle_error('VALIDATION_ERROR');end if;
 begin after_time:=(p_input->>'attempted_after')::timestamptz;before_time:=(p_input->>'attempted_before')::timestamptz;row_limit:=(p_input->>'limit')::integer;
 exception when others then return public.kettle_error('VALIDATION_ERROR');end;
 if provider_name<>'scrapecreators' or after_time>=before_time or row_limit not between 1 and 100 then return public.kettle_error('VALIDATION_ERROR');end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(x) order by x.attempted_at,x.operation) from (
  select a.operation,a.created_at attempted_at,o.terminal_state,o.failure_code,o.http_status,o.observed_at
  from public.creator_attempts a left join public.creator_attempt_receipts r on (r.job_id,r.key)=(a.job_id,a.key)
   left join public.creator_attempt_outcomes o on (o.job_id,o.key)=(a.job_id,a.key)
  where a.provider=provider_name and a.created_at>=after_time and a.created_at<before_time and r.job_id is null
   and (o.job_id is null or o.terminal_state='needs_reconciliation') order by a.created_at,a.job_id,a.key limit row_limit
 )x),'[]'::jsonb)));
end;$$;

revoke all on function public.kettle_record_creator_attempt_outcome(uuid,jsonb),public.kettle_reconcile_creator_job(uuid,jsonb),
 public.kettle_list_creator_attempt_reconciliation(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.kettle_record_creator_attempt_outcome(uuid,jsonb),public.kettle_reconcile_creator_job(uuid,jsonb),
 public.kettle_list_creator_attempt_reconciliation(jsonb) to service_role;
