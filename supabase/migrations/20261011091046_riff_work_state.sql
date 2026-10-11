-- Durable, account-owned Riff script work state. Provider execution and spend are unchanged.
create table public.riff_work_states (
  job_id uuid not null,
  variant_id uuid not null,
  account_id uuid not null references public.accounts(id),
  state text not null check (state in ('active','saved','filmed')),
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id,variant_id),
  unique (job_id,variant_id,account_id),
  foreign key (job_id,account_id) references public.creator_jobs(id,account_id)
);

create table public.riff_work_state_events (
  job_id uuid not null,
  variant_id uuid not null,
  account_id uuid not null,
  version integer not null check (version > 0),
  from_state text check (from_state in ('active','saved','filmed')),
  to_state text not null check (to_state in ('active','saved','filmed')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (job_id,variant_id,version),
  unique (account_id,request_id),
  foreign key (job_id,variant_id,account_id) references public.riff_work_states(job_id,variant_id,account_id),
  check ((version=1 and from_state is null and to_state in ('saved','filmed'))
    or (version>1 and from_state is not null and from_state<>to_state))
);

create table public.riff_work_state_receipts (
  account_id uuid not null references public.accounts(id),
  request_id uuid not null,
  job_id uuid not null,
  variant_id uuid not null,
  input jsonb not null check (jsonb_typeof(input)='object' and octet_length(input::text)<=16384),
  output jsonb not null check ((jsonb_typeof(output)='object' and octet_length(output::text)<=16384
    and jsonb_typeof(output->'ok')='boolean' and output->'ok'='true'::jsonb
    and jsonb_typeof(output->'data')='object'
    and jsonb_typeof(output#>'{data,work_state}')='object') is true),
  created_at timestamptz not null default now(),
  primary key (account_id,request_id),
  foreign key (job_id,variant_id,account_id) references public.riff_work_states(job_id,variant_id,account_id)
);

create index riff_work_states_recent on public.riff_work_states(account_id,updated_at desc,job_id,variant_id);

alter table public.riff_work_states enable row level security;
alter table public.riff_work_state_events enable row level security;
alter table public.riff_work_state_receipts enable row level security;
revoke all on public.riff_work_states,public.riff_work_state_events,public.riff_work_state_receipts
  from public,anon,authenticated,service_role;
grant select on public.riff_work_states to service_role;

create function public.kettle_riff_work_state_append_only() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Riff work-state history is append-only';
end;
$$;
create trigger riff_work_state_events_append_only before update or delete on public.riff_work_state_events
  for each row execute function public.kettle_riff_work_state_append_only();
create trigger riff_work_state_receipts_append_only before update or delete on public.riff_work_state_receipts
  for each row execute function public.kettle_riff_work_state_append_only();

create function public.kettle_set_riff_work_state(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_job public.creator_jobs%rowtype;
  v_current public.riff_work_states%rowtype;
  v_receipt public.riff_work_state_receipts%rowtype;
  v_job_id uuid;
  v_variant_id uuid;
  v_request_id uuid;
  v_state text;
  v_expected_numeric numeric;
  v_expected integer;
  v_version integer;
  v_updated_at timestamptz;
  v_output jsonb;
begin
  if public.kettle_jsonb_exact_keys(p_input,array['job_id','variant_id','state','expected_version','request_id']) is not true
    or jsonb_typeof(p_input->'job_id') is distinct from 'string'
    or jsonb_typeof(p_input->'variant_id') is distinct from 'string'
    or jsonb_typeof(p_input->'state') is distinct from 'string'
    or jsonb_typeof(p_input->'expected_version') is distinct from 'number'
    or jsonb_typeof(p_input->'request_id') is distinct from 'string'
    or p_input->>'job_id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    or p_input->>'variant_id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    or p_input->>'request_id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
  then return public.kettle_error('VALIDATION_ERROR'); end if;

  begin
    v_job_id:=(p_input->>'job_id')::uuid;
    v_variant_id:=(p_input->>'variant_id')::uuid;
    v_request_id:=(p_input->>'request_id')::uuid;
    v_expected_numeric:=(p_input->>'expected_version')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.kettle_error('VALIDATION_ERROR');
  end;
  v_state:=p_input->>'state';
  if v_state not in ('active','saved','filmed') or v_expected_numeric<0
    or v_expected_numeric>2147483646 or trunc(v_expected_numeric)<>v_expected_numeric
  then return public.kettle_error('VALIDATION_ERROR'); end if;
  v_expected:=v_expected_numeric::integer;

  perform 1 from public.accounts where id=p_account_id and state='active' for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;

  select * into v_job from public.creator_jobs
    where id=v_job_id and account_id=p_account_id for update;
  if not found or v_job.kind<>'scripts' or v_job.state<>'succeeded'
    or jsonb_typeof(v_job.result) is distinct from 'object'
    or v_job.result->>'kind' is distinct from 'scripts'
    or jsonb_typeof(v_job.result#>'{scripts,variants}') is distinct from 'array'
    or jsonb_array_length(v_job.result#>'{scripts,variants}')=0
    or exists (select 1 from jsonb_array_elements(v_job.result#>'{scripts,variants}') item
      where jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$')
  then return public.kettle_error('NOT_FOUND'); end if;
  if (select count(*) from jsonb_array_elements(v_job.result#>'{scripts,variants}')) <>
       (select count(distinct (item->>'id')::uuid) from jsonb_array_elements(v_job.result#>'{scripts,variants}') item)
    or not exists (select 1 from jsonb_array_elements(v_job.result#>'{scripts,variants}') item
      where (item->>'id')::uuid=v_variant_id)
  then return public.kettle_error('NOT_FOUND'); end if;

  select * into v_current from public.riff_work_states
    where job_id=v_job_id and variant_id=v_variant_id for update;
  select * into v_receipt from public.riff_work_state_receipts
    where account_id=p_account_id and request_id=v_request_id for update;
  if found then
    if v_receipt.input=p_input then return v_receipt.output; end if;
    return public.kettle_error('IDEMPOTENCY_CONFLICT');
  end if;

  if not found then null; end if;
  if v_current.job_id is null then
    if v_expected<>0 or v_state='active' then return public.kettle_error(case when v_expected<>0 then 'VERSION_CONFLICT' else 'VALIDATION_ERROR' end); end if;
    v_version:=1;
    insert into public.riff_work_states(job_id,variant_id,account_id,state,version)
      values(v_job_id,v_variant_id,p_account_id,v_state,v_version) returning updated_at into v_updated_at;
    insert into public.riff_work_state_events(job_id,variant_id,account_id,version,from_state,to_state,request_id)
      values(v_job_id,v_variant_id,p_account_id,v_version,null,v_state,v_request_id);
  else
    if v_current.version<>v_expected then return public.kettle_error('VERSION_CONFLICT'); end if;
    if v_current.state=v_state then return public.kettle_error('VALIDATION_ERROR'); end if;
    v_version:=v_current.version+1;
    update public.riff_work_states set state=v_state,version=v_version,updated_at=now()
      where job_id=v_job_id and variant_id=v_variant_id returning updated_at into v_updated_at;
    insert into public.riff_work_state_events(job_id,variant_id,account_id,version,from_state,to_state,request_id)
      values(v_job_id,v_variant_id,p_account_id,v_version,v_current.state,v_state,v_request_id);
  end if;

  v_output:=jsonb_build_object('ok',true,'data',jsonb_build_object('work_state',jsonb_build_object(
    'job_id',v_job_id,'variant_id',v_variant_id,'state',v_state,'version',v_version,'updated_at',v_updated_at)));
  insert into public.riff_work_state_receipts(account_id,request_id,job_id,variant_id,input,output)
    values(p_account_id,v_request_id,v_job_id,v_variant_id,p_input,v_output);
  return v_output;
exception when others then
  return public.kettle_error('UNAVAILABLE');
end;
$$;

create or replace function public.kettle_get_creator_job(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_job public.creator_jobs%rowtype;v_states jsonb;
begin
  if public.kettle_jsonb_exact_keys(p_input,array['job_id']) is not true
    or jsonb_typeof(p_input->'job_id') is distinct from 'string' then return public.kettle_error('VALIDATION_ERROR'); end if;
  if not exists(select 1 from public.accounts where id=p_account_id and state='active') then return public.kettle_error('FORBIDDEN'); end if;
  begin select j.* into v_job from public.creator_jobs j join public.projects p on (p.id,p.account_id)=(j.project_id,j.account_id)
    where j.id=(p_input->>'job_id')::uuid and j.account_id=p_account_id;
  exception when invalid_text_representation then return public.kettle_error('VALIDATION_ERROR'); end;
  if not found then return public.kettle_error('NOT_FOUND'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('job_id',v_job.id,'variant_id',ws.variant_id,'state',ws.state,
      'version',ws.version,'updated_at',ws.updated_at) order by variant.ordinality),'[]'::jsonb)
    into v_states from jsonb_array_elements(case when v_job.kind='scripts' and v_job.state='succeeded'
      and jsonb_typeof(v_job.result#>'{scripts,variants}')='array' then v_job.result#>'{scripts,variants}' else '[]'::jsonb end)
      with ordinality variant(value,ordinality)
    join public.riff_work_states ws on ws.job_id=v_job.id and ws.variant_id::text=lower(variant.value->>'id') and ws.account_id=p_account_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(v_job)||jsonb_build_object('work_states',v_states)));
end;
$$;

create or replace function public.kettle_list_riff_work(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_limit integer;v_work jsonb;
begin
  if not exists(select 1 from public.accounts where id=p_account_id and state='active') then return public.kettle_error('FORBIDDEN'); end if;
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) key where key<>'limit')
    or (p_input?'limit' and jsonb_typeof(p_input->'limit') is distinct from 'number') then return public.kettle_error('VALIDATION_ERROR'); end if;
  begin v_limit:=coalesce((p_input->>'limit')::integer,10);exception when others then return public.kettle_error('VALIDATION_ERROR');end;
  if v_limit not between 1 and 20 then return public.kettle_error('VALIDATION_ERROR'); end if;
  select coalesce(jsonb_agg(item order by item->>'updated_at' desc,item->>'job_id'),'[]'::jsonb) into v_work from (
    select jsonb_build_object('project_id',p.id,'project_name',p.name,'job_id',j.id,'kind',j.kind,'state',j.state,
      'updated_at',j.updated_at,'source',s.source,'variant_id',latest.variant_id,'work_state',case when latest.variant_id is null then null
        else jsonb_build_object('job_id',j.id,'variant_id',latest.variant_id,'state',latest.state,'version',latest.version,'updated_at',latest.updated_at) end) item
    from public.riff_creator_starts s join public.projects p on (p.id,p.account_id)=(s.project_id,s.account_id)
    join lateral (select cj.id,cj.kind,cj.state,cj.updated_at from public.creator_jobs cj where cj.account_id=s.account_id and cj.project_id=s.project_id
      order by cj.updated_at desc,cj.id limit 1) j on true
    left join lateral (select ws.variant_id,ws.state,ws.version,ws.updated_at from public.riff_work_states ws where ws.account_id=p_account_id and ws.job_id=j.id
      order by ws.updated_at desc,ws.version desc,ws.variant_id limit 1) latest on true
    where s.account_id=p_account_id order by j.updated_at desc,j.id limit v_limit) recent;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('work',v_work));
end;
$$;

revoke all on function public.kettle_riff_work_state_append_only(),public.kettle_set_riff_work_state(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.kettle_set_riff_work_state(uuid,jsonb) to service_role;
