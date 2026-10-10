-- Account-scoped Riff run grants reserve a complete bounded creator flow before
-- any user-triggered start. Six ScrapeCreators units cover profile + two feed
-- pages + three recommendation details; two Lightreel units cover a supplied
-- video review + recommendation research. Shared capacity is transferred into
-- a grant once, then every project job spends only that grant.
alter table public.creator_pipeline_allowances
  add column riff_managed boolean not null default false;

create table public.riff_creator_run_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  provision_request_id uuid not null,
  mode text not null check (mode in ('initial', 'refill')),
  ordinal integer not null check (ordinal between 1 and 10),
  state text not null default 'available' check (state in ('available', 'consumed')),
  scrapecreators_remaining integer not null default 6 check (scrapecreators_remaining between 0 and 6),
  lightreel_remaining integer not null default 2 check (lightreel_remaining between 0 and 2),
  expires_at timestamptz not null,
  provisioned_at timestamptz not null default now(),
  consumed_request_id uuid,
  consumed_at timestamptz,
  unique (id, account_id),
  unique (account_id, provision_request_id, ordinal),
  unique (account_id, consumed_request_id),
  check ((state = 'available' and consumed_request_id is null and consumed_at is null)
    or (state = 'consumed' and consumed_request_id is not null and consumed_at is not null))
);
create unique index riff_creator_one_initial_grant
  on public.riff_creator_run_grants(account_id) where mode = 'initial';
create index riff_creator_available_grants
  on public.riff_creator_run_grants(account_id, provisioned_at, id)
  where state = 'available';

create table public.riff_creator_grant_provisions (
  account_id uuid not null references public.accounts(id),
  request_id uuid not null,
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  created_at timestamptz not null default now(),
  primary key (account_id, request_id)
);

create table public.riff_creator_project_grants (
  account_id uuid not null references public.accounts(id),
  project_id uuid not null,
  grant_id uuid not null,
  profile_url text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, project_id),
  unique (grant_id),
  foreign key (project_id, account_id) references public.projects(id, account_id),
  foreign key (grant_id, account_id) references public.riff_creator_run_grants(id, account_id)
);

alter table public.riff_creator_starts add column grant_id uuid;
alter table public.riff_creator_starts add constraint riff_creator_starts_grant_owner
  foreign key (grant_id, account_id) references public.riff_creator_run_grants(id, account_id);
create unique index riff_creator_starts_grant on public.riff_creator_starts(grant_id) where grant_id is not null;

alter table public.riff_creator_run_grants enable row level security;
alter table public.riff_creator_grant_provisions enable row level security;
alter table public.riff_creator_project_grants enable row level security;
revoke all on public.riff_creator_run_grants, public.riff_creator_grant_provisions,
  public.riff_creator_project_grants from public, anon, authenticated, service_role;
grant select, update on public.riff_creator_run_grants to service_role;
grant select on public.riff_creator_grant_provisions to service_role;
grant select, insert on public.riff_creator_project_grants to service_role;

-- Allowances minted by the retired self-authorizing start are no longer valid.
-- Historical starts remain readable/replayable but cannot dispatch new spend.
update public.creator_pipeline_allowances a set
  riff_managed = true,
  enabled = false,
  expires_at = least(a.expires_at, now())
where exists (
  select 1 from public.riff_creator_starts s
  where s.account_id = a.account_id and s.source->>'profile_url' = a.profile_url
);

create function public.kettle_provision_riff_creator_run_grants(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request_id uuid;
  v_mode text;
  v_run_count integer;
  v_receipt public.riff_creator_grant_provisions%rowtype;
  v_initial public.riff_creator_run_grants%rowtype;
  v_scrape_remaining bigint;
  v_light_remaining bigint;
  v_scrape_expires timestamptz;
  v_light_expires timestamptz;
  v_grant_expires timestamptz;
  v_output jsonb;
  v_grants jsonb;
  v_ordinal integer;
begin
  perform 1 from public.accounts where id = p_account_id and state = 'active' for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_input)) <> 3
    or not (p_input ?& array['request_id', 'mode', 'run_count']) then
    return public.kettle_error('VALIDATION_ERROR');
  end if;
  begin
    v_request_id := (p_input->>'request_id')::uuid;
    v_run_count := (p_input->>'run_count')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.kettle_error('VALIDATION_ERROR');
  end;
  v_mode := p_input->>'mode';
  if v_request_id is null or v_mode not in ('initial', 'refill')
    or v_run_count not between 1 and 10
    or (v_mode = 'initial' and v_run_count <> 1) then
    return public.kettle_error('VALIDATION_ERROR');
  end if;

  select * into v_receipt from public.riff_creator_grant_provisions
    where account_id = p_account_id and request_id = v_request_id;
  if found then
    if v_receipt.input = p_input then return v_receipt.output; end if;
    return public.kettle_error('IDEMPOTENCY_CONFLICT');
  end if;

  if v_mode = 'initial' then
    select * into v_initial from public.riff_creator_run_grants
      where account_id = p_account_id and mode = 'initial';
    if found then
      v_output := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'status', 'existing', 'grants', jsonb_build_array(jsonb_build_object(
          'id', v_initial.id, 'mode', v_initial.mode, 'state', v_initial.state,
          'scrapecreators_remaining', v_initial.scrapecreators_remaining,
          'lightreel_remaining', v_initial.lightreel_remaining,
          'expires_at', v_initial.expires_at
        ))
      ));
      insert into public.riff_creator_grant_provisions(account_id, request_id, input, output)
        values (p_account_id, v_request_id, p_input, v_output);
      return v_output;
    end if;
  end if;

  select remaining_units, expires_at into v_scrape_remaining, v_scrape_expires
    from public.creator_provider_trials
    where provider = 'scrapecreators' and enabled and expires_at > now() for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
  select remaining_units, expires_at into v_light_remaining, v_light_expires
    from public.creator_provider_trials
    where provider = 'lightreel' and enabled and expires_at > now() for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
  if v_scrape_remaining < v_run_count::bigint * 6
    or v_light_remaining < v_run_count::bigint * 2 then
    return public.kettle_error('FORBIDDEN');
  end if;
  v_grant_expires := least(v_scrape_expires, v_light_expires);

  update public.creator_provider_trials
    set remaining_units = remaining_units - v_run_count::bigint * 6
    where provider = 'scrapecreators';
  update public.creator_provider_trials
    set remaining_units = remaining_units - v_run_count::bigint * 2
    where provider = 'lightreel';
  for v_ordinal in 1..v_run_count loop
    insert into public.riff_creator_run_grants(
      account_id, provision_request_id, mode, ordinal, expires_at
    ) values (p_account_id, v_request_id, v_mode, v_ordinal, v_grant_expires);
  end loop;
  select jsonb_agg(jsonb_build_object(
    'id', g.id, 'mode', g.mode, 'state', g.state,
    'scrapecreators_remaining', g.scrapecreators_remaining,
    'lightreel_remaining', g.lightreel_remaining,
    'expires_at', g.expires_at
  ) order by g.ordinal) into v_grants
  from public.riff_creator_run_grants g
  where g.account_id = p_account_id and g.provision_request_id = v_request_id;
  v_output := jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'status', 'created', 'grants', v_grants
  ));
  insert into public.riff_creator_grant_provisions(account_id, request_id, input, output)
    values (p_account_id, v_request_id, p_input, v_output);
  return v_output;
end;
$$;

-- A normal server-created allowance continues to use the shared provider pool.
-- A Riff-managed allowance additionally requires this exact project to own a
-- live consumed grant for the same profile.
create function public.kettle_creator_project_authorized(
  p_account_id uuid, p_project_id uuid, p_profile_url text
) returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select case when not a.riff_managed then true else exists (
      select 1 from public.riff_creator_project_grants pg
      join public.riff_creator_run_grants g
        on (g.id, g.account_id) = (pg.grant_id, pg.account_id)
      where pg.account_id = p_account_id and pg.project_id = p_project_id
        and pg.profile_url = p_profile_url and g.state = 'consumed' and g.expires_at > now()
    ) end
    from public.creator_pipeline_allowances a
    where a.account_id = p_account_id and a.profile_url = p_profile_url
      and a.enabled and a.expires_at > now()
  ), false);
$$;

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
  pid:=(p_input->>'project_id')::uuid;
  captured:=jsonb_build_object('scan',p_input->'scan');
  if p_input ? 'seed_url' then captured:=captured||jsonb_build_object('seed_url',p_input->'seed_url'); end if;
 elsif p_kind='recommendations' then
  stored:=public.kettle_get_creator_dna(p_account_id,jsonb_build_object('dna_id',p_input->>'dna_id'));
  if stored->>'ok'<>'true' then return stored; end if;
  stored:=stored->'data';
  if (stored#>>'{analysis,dna,version}')::integer is distinct from (p_input->>'expected_version')::integer then return public.kettle_error('VERSION_CONFLICT'); end if;
  pid:=(stored->>'project_id')::uuid; captured:=jsonb_build_object('stored',stored);
 elsif p_kind='scripts' then
  select * into parent from public.creator_jobs where account_id=p_account_id and kind='recommendations' and state='succeeded' and result#>>'{batch,id}'=p_input->>'batch_id';
  if not found then return public.kettle_error('NOT_FOUND'); end if;
  if not exists(select 1 from jsonb_array_elements(parent.result#>'{batch,ideas}') i where i->>'id'=p_input->>'idea_id') then return public.kettle_error('NOT_FOUND'); end if;
  pid:=parent.project_id; captured:=jsonb_build_object('stored',parent.captured->'stored','batch',parent.result->'batch','idea_id',p_input->>'idea_id');
  if p_input ? 'variants' then captured:=captured||jsonb_build_object('variants',p_input->'variants'); end if;
 else return public.kettle_error('VALIDATION_ERROR'); end if;
 perform 1 from public.projects where id=pid and account_id=p_account_id;
 if not found then return public.kettle_error('NOT_FOUND'); end if;
 url:=public.kettle_creator_profile_url(captured);
 if not public.kettle_creator_project_authorized(p_account_id,pid,url) then return public.kettle_error('FORBIDDEN'); end if;
 if p_kind in ('scan','recommendations') and exists (
  select 1 from public.creator_pipeline_allowances al
  where al.account_id=p_account_id and al.profile_url=url and al.riff_managed
 ) and exists (
  select 1 from public.creator_jobs existing
  where existing.account_id=p_account_id and existing.project_id=pid and existing.kind=p_kind
 ) then return public.kettle_error('FORBIDDEN'); end if;
 insert into public.creator_jobs(account_id,project_id,kind,input,captured,request_id) values(p_account_id,pid,p_kind,p_input,captured,req) returning * into j;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end; $$;

create or replace function public.kettle_run_creator_job(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype;
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;
 if not found then return public.kettle_error('FORBIDDEN'); end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;
 if not found then return public.kettle_error('NOT_FOUND'); end if;
 if j.state='queued' then
  if not public.kettle_creator_project_authorized(
    p_account_id,j.project_id,public.kettle_creator_profile_url(j.captured)
  ) then return public.kettle_error('FORBIDDEN'); end if;
  update public.creator_jobs set state='running',revision=revision+1,updated_at=now() where id=j.id returning * into j;
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job',to_jsonb(j)));
end; $$;

create or replace function public.kettle_reserve_creator_attempt(p_account_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.creator_jobs%rowtype; a public.creator_attempts%rowtype; b public.creator_pipeline_budget%rowtype;
 g public.riff_creator_run_grants%rowtype; riff_managed boolean;
 k text:=p_input->>'key'; provider text:=p_input->>'provider'; op text:=p_input->>'operation'; ceiling bigint:=(p_input->>'ceiling_microusd')::bigint; receipt jsonb;
begin
 perform 1 from public.accounts where id=p_account_id and state='active' for update;
 if not found then return public.kettle_error('FORBIDDEN'); end if;
 select * into j from public.creator_jobs where id=(p_input->>'job_id')::uuid and account_id=p_account_id for update;
 if not found then return public.kettle_error('NOT_FOUND'); end if;
 if k is null or length(k) not between 1 and 200 or ceiling is null or ceiling<0 or provider is null or op is null or not
  ((provider='scrapecreators' and op in ('profile','feed','video')) or (provider='lightreel' and op in ('research','poll')) or (provider='openai' and op='generate')) then return public.kettle_error('VALIDATION_ERROR'); end if;
 select * into a from public.creator_attempts where job_id=j.id and key=k;
 if found then
  if a.provider<>provider or a.operation<>op or a.ceiling_microusd<>ceiling then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
  select ar.receipt into receipt from public.creator_attempt_receipts ar where ar.job_id=j.id and ar.key=k;
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('status','replay','receipt',receipt)); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('status','ambiguous'));
 end if;
 if j.state<>'running' then return public.kettle_error('FORBIDDEN'); end if;
 select al.riff_managed into riff_managed from public.creator_pipeline_allowances al
  where al.account_id=p_account_id and al.profile_url=public.kettle_creator_profile_url(j.captured)
    and al.enabled and al.expires_at>now();
 if not found then return public.kettle_error('FORBIDDEN'); end if;
 if riff_managed then
  select rg.* into g from public.riff_creator_project_grants pg
   join public.riff_creator_run_grants rg on (rg.id,rg.account_id)=(pg.grant_id,pg.account_id)
   where pg.account_id=p_account_id and pg.project_id=j.project_id
    and pg.profile_url=public.kettle_creator_profile_url(j.captured)
    and rg.state='consumed' and rg.expires_at>now() for update of rg;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
 end if;
 if (select count(*) from public.creator_attempts where job_id=j.id)>=32 then return public.kettle_error('FORBIDDEN'); end if;
 if riff_managed and provider='openai' then return public.kettle_error('FORBIDDEN'); end if;
 if ceiling>0 then
  select * into b from public.creator_pipeline_budget where id=1 for update;
  if not found or ceiling>b.limit_microusd-b.reserved_microusd then return public.kettle_error('FORBIDDEN'); end if;
 end if;
 if riff_managed then
  if provider='scrapecreators' then
   update public.riff_creator_run_grants set scrapecreators_remaining=scrapecreators_remaining-1
    where id=g.id and scrapecreators_remaining>=1;
  elsif provider='lightreel' then
   update public.riff_creator_run_grants set lightreel_remaining=lightreel_remaining-1
    where id=g.id and lightreel_remaining>=1;
  else return public.kettle_error('FORBIDDEN'); end if;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
 elsif ceiling=0 then
  if provider not in ('scrapecreators','lightreel') then return public.kettle_error('FORBIDDEN'); end if;
  update public.creator_provider_trials t set remaining_units=t.remaining_units-1
   where t.provider=p_input->>'provider' and t.enabled and t.expires_at>now() and t.remaining_units>=1;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
 end if;
 if ceiling>0 then
  update public.creator_pipeline_budget set reserved_microusd=reserved_microusd+ceiling where id=1;
 end if;
 insert into public.creator_attempts(job_id,key,provider,operation,ceiling_microusd) values(j.id,k,provider,op,ceiling);
 return jsonb_build_object('ok',true,'data',jsonb_build_object('status','acquired'));
end; $$;

create or replace function public.kettle_list_creator_dispatches(p_account_id uuid,p_input jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('ok',true,'data',jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('id',j.id,'account_id',j.account_id,'state',j.state)),'[]'::jsonb)))
 from (select j.id,j.account_id,j.state from public.creator_jobs j join public.accounts a on a.id=j.account_id and a.state='active'
 where j.state in ('queued','running') and public.kettle_creator_project_authorized(
  j.account_id,j.project_id,public.kettle_creator_profile_url(j.captured)
 ) order by j.created_at,j.id limit greatest(0,least(10,coalesce((p_input->>'limit')::integer,10)))) j;
$$;

create or replace function public.kettle_start_riff_creator(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_raw jsonb := p_input->'input';
  v_source jsonb := p_input->'source';
  v_request_id uuid;
  v_existing public.riff_creator_starts%rowtype;
  v_grant public.riff_creator_run_grants%rowtype;
  v_profile_url text;
  v_video_url text;
  v_canonical_url text;
  v_handle text;
  v_kind text;
  v_max_profiles integer;
  v_ttl integer;
  v_project_input jsonb;
  v_project_result jsonb;
  v_project_id uuid;
  v_scan_input jsonb;
  v_job_result jsonb;
  v_job_id uuid;
begin
  perform 1 from public.accounts where id = p_account_id and state = 'active' for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
  if jsonb_typeof(v_raw) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v_raw)) <> 2
    or v_raw->>'source_url' is null then return public.kettle_error('VALIDATION_ERROR'); end if;
  begin
    v_request_id := (v_raw->>'request_id')::uuid;
  exception when invalid_text_representation then
    return public.kettle_error('VALIDATION_ERROR');
  end;

  select * into v_existing from public.riff_creator_starts
    where account_id = p_account_id and request_id = v_request_id;
  if found then
    if v_existing.input <> v_raw then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
    return public.kettle_get_riff_creator_start(p_account_id, v_raw);
  end if;
  if exists (select 1 from public.creator_jobs where account_id = p_account_id and request_id = v_request_id) then
    return public.kettle_error('IDEMPOTENCY_CONFLICT');
  end if;

  begin
    v_max_profiles := (p_input->>'max_profiles_per_account')::integer;
    v_ttl := (p_input->>'allowance_ttl_seconds')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.kettle_error('VALIDATION_ERROR');
  end;
  if jsonb_typeof(v_source) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v_source)) <> 6
    or v_max_profiles not between 1 and 10 or v_ttl not between 60 and 604800
    or v_source->>'platform' is distinct from 'tiktok' then
    return public.kettle_error('VALIDATION_ERROR');
  end if;
  v_kind := v_source->>'kind';
  v_handle := v_source->>'handle';
  v_profile_url := v_source->>'profile_url';
  v_video_url := v_source->>'video_url';
  v_canonical_url := v_source->>'canonical_url';
  if v_handle is null or v_handle !~ '^[A-Za-z0-9_.]{1,100}$'
    or v_profile_url is distinct from 'https://www.tiktok.com/@' || v_handle
    or v_kind not in ('profile', 'video')
    or (v_kind = 'profile' and (v_video_url is not null or v_canonical_url is distinct from v_profile_url))
    or (v_kind = 'video' and (v_video_url is null or v_canonical_url is distinct from v_video_url
      or left(v_video_url, length(v_profile_url) + 7) is distinct from v_profile_url || '/video/'
      or substring(v_video_url from length(v_profile_url) + 8) !~ '^[0-9]{1,30}$')) then
    return public.kettle_error('VALIDATION_ERROR');
  end if;

  if not exists (select 1 from public.creator_pipeline_allowances
      where account_id = p_account_id and profile_url = v_profile_url)
    and (select count(*) from public.creator_pipeline_allowances where account_id = p_account_id) >= v_max_profiles then
    return public.kettle_error('FORBIDDEN');
  end if;
  select * into v_grant from public.riff_creator_run_grants
    where account_id = p_account_id and state = 'available' and expires_at > now()
    order by case mode when 'initial' then 0 else 1 end, provisioned_at, id
    limit 1 for update;
  if not found then return public.kettle_error('FORBIDDEN'); end if;

  v_project_input := jsonb_build_object(
    'request_id', v_request_id, 'project_id', null, 'expected_version', 0,
    'name', '@' || v_handle || ' creator work', 'project_type', 'brand',
    'brief', jsonb_build_object(
      'product', 'Creator profile @' || v_handle,
      'audience', 'Unknown until analysis; inferred audience context must remain labelled and evidence-backed.',
      'goal', 'Analyze the supplied creator source and find a tailored next video direction.',
      'tone', 'Creator-led', 'language', 'en', 'duration_seconds', 30,
      'filming_constraints', jsonb_build_array(
        'Use only permitted source evidence.', 'Treat missing data as unknown.', 'Do not promise performance.'
      ),
      'facts', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'statement', 'The user supplied this creator source for analysis; this does not establish profile ownership.',
        'source', jsonb_build_object('kind', 'url', 'url', v_canonical_url, 'captured_at', now()),
        'user_confirmed', true
      ))
    )
  );
  v_project_result := public.kettle_save_project(p_account_id, v_project_input);
  if v_project_result->>'ok' <> 'true' then return v_project_result; end if;
  v_project_id := (v_project_result#>>'{data,project,id}')::uuid;

  update public.riff_creator_run_grants set
    state = 'consumed', consumed_request_id = v_request_id, consumed_at = now()
    where id = v_grant.id and state = 'available';
  if not found then raise exception 'Riff creator grant was consumed concurrently'; end if;
  insert into public.riff_creator_project_grants(account_id, project_id, grant_id, profile_url)
    values (p_account_id, v_project_id, v_grant.id, v_profile_url);
  insert into public.creator_pipeline_allowances(account_id, profile_url, enabled, expires_at, riff_managed)
    values (p_account_id, v_profile_url, true,
      least(now() + make_interval(secs => v_ttl), v_grant.expires_at), true)
    on conflict (account_id, profile_url) do update set
      enabled = true,
      riff_managed = true,
      expires_at = greatest(public.creator_pipeline_allowances.expires_at, excluded.expires_at);

  v_scan_input := jsonb_build_object(
    'project_id', v_project_id, 'request_id', v_request_id,
    'scan', jsonb_build_object('platform', 'tiktok', 'supplied_url', v_profile_url, 'max_videos', 10, 'max_pages', 2)
  );
  if v_kind = 'video' then v_scan_input := v_scan_input || jsonb_build_object('seed_url', v_video_url); end if;
  v_job_result := public.kettle_start_creator_scan(p_account_id, v_scan_input);
  if v_job_result->>'ok' <> 'true' then
    raise exception 'Riff creator scan intent could not be created';
  end if;
  v_job_id := (v_job_result#>>'{data,job,id}')::uuid;
  insert into public.riff_creator_starts(account_id, request_id, input, source, project_id, job_id, grant_id)
    values (p_account_id, v_request_id, v_raw, v_source, v_project_id, v_job_id, v_grant.id);
  return public.kettle_get_riff_creator_start(p_account_id, v_raw);
end;
$$;

revoke all on function public.kettle_provision_riff_creator_run_grants(uuid, jsonb),
  public.kettle_creator_project_authorized(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.kettle_provision_riff_creator_run_grants(uuid, jsonb),
  public.kettle_creator_project_authorized(uuid, uuid, text)
  to service_role;
