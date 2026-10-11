-- Atomic high-level creator start for the bounded development trial.
-- The public MCP operation never supplies account identity or allowance policy.
create table public.riff_creator_starts (
  account_id uuid not null references public.accounts(id),
  request_id uuid not null,
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  project_id uuid not null,
  job_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (account_id, request_id),
  unique (job_id, account_id),
  foreign key (project_id, account_id) references public.projects(id, account_id),
  foreign key (job_id, account_id) references public.creator_jobs(id, account_id)
);

alter table public.riff_creator_starts enable row level security;
revoke all on public.riff_creator_starts from public, anon, authenticated, service_role;
grant select, insert on public.riff_creator_starts to service_role;

create function public.kettle_get_riff_creator_start(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_start public.riff_creator_starts%rowtype;
  v_project jsonb;
  v_job jsonb;
begin
  if not exists (select 1 from public.accounts where id = p_account_id and state = 'active') then
    return public.kettle_error('FORBIDDEN');
  end if;
  select * into v_start from public.riff_creator_starts
    where account_id = p_account_id and request_id = (p_input->>'request_id')::uuid;
  if not found then return public.kettle_error('NOT_FOUND'); end if;
  if v_start.input <> p_input then return public.kettle_error('IDEMPOTENCY_CONFLICT'); end if;
  v_project := public.kettle_get_project(p_account_id, jsonb_build_object('project_id', v_start.project_id));
  v_job := public.kettle_get_creator_job(p_account_id, jsonb_build_object('job_id', v_start.job_id));
  if v_project->>'ok' <> 'true' or v_job->>'ok' <> 'true' then
    return public.kettle_error('NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'project', v_project#>'{data,project}', 'job', v_job#>'{data,job}', 'source', v_start.source
  ));
exception when invalid_text_representation then
  return public.kettle_error('VALIDATION_ERROR');
end;
$$;

create function public.kettle_start_riff_creator(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_raw jsonb := p_input->'input';
  v_source jsonb := p_input->'source';
  v_request_id uuid;
  v_existing public.riff_creator_starts%rowtype;
  v_profile_url text;
  v_video_url text;
  v_canonical_url text;
  v_handle text;
  v_kind text;
  v_max_profiles integer;
  v_ttl integer;
  v_trial_expires timestamptz;
  v_lightreel_expires timestamptz;
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
    or v_max_profiles not between 1 and 10 or v_ttl not between 60 and 86400
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

  -- A maximum scan needs one profile request and two feed pages. Lightreel is
  -- required as configured development capacity for the next discovery step.
  select expires_at into v_trial_expires from public.creator_provider_trials
    where provider = 'scrapecreators' and enabled and expires_at > now() and remaining_units >= 3 for share;
  if not found then return public.kettle_error('FORBIDDEN'); end if;
  select expires_at into v_lightreel_expires from public.creator_provider_trials
    where provider = 'lightreel' and enabled and expires_at > now() and remaining_units >= 1 for share;
  if not found then return public.kettle_error('FORBIDDEN'); end if;

  if not exists (select 1 from public.creator_pipeline_allowances
      where account_id = p_account_id and profile_url = v_profile_url)
    and (select count(*) from public.creator_pipeline_allowances where account_id = p_account_id) >= v_max_profiles then
    return public.kettle_error('FORBIDDEN');
  end if;

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

  insert into public.creator_pipeline_allowances(account_id, profile_url, enabled, expires_at)
    values (p_account_id, v_profile_url, true,
      least(now() + make_interval(secs => v_ttl), v_trial_expires, v_lightreel_expires))
    on conflict (account_id, profile_url) do update set
      enabled = true,
      expires_at = least(
        greatest(public.creator_pipeline_allowances.expires_at, excluded.expires_at),
        v_trial_expires,
        v_lightreel_expires
      );

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
  insert into public.riff_creator_starts(account_id, request_id, input, source, project_id, job_id)
    values (p_account_id, v_request_id, v_raw, v_source, v_project_id, v_job_id);
  return public.kettle_get_riff_creator_start(p_account_id, v_raw);
end;
$$;

create function public.kettle_list_riff_work(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_limit integer;
  v_work jsonb;
begin
  if not exists (select 1 from public.accounts where id = p_account_id and state = 'active') then
    return public.kettle_error('FORBIDDEN');
  end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_input) key where key <> 'limit') then
    return public.kettle_error('VALIDATION_ERROR');
  end if;
  begin
    v_limit := coalesce((p_input->>'limit')::integer, 10);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.kettle_error('VALIDATION_ERROR');
  end;
  if v_limit not between 1 and 20 then return public.kettle_error('VALIDATION_ERROR'); end if;

  select coalesce(jsonb_agg(item order by item->>'updated_at' desc, item->>'job_id'), '[]'::jsonb)
    into v_work from (
      select jsonb_build_object(
        'project_id', p.id,
        'project_name', p.name,
        'job_id', j.id,
        'kind', j.kind,
        'state', j.state,
        'updated_at', j.updated_at,
        'source', s.source
      ) item
      from public.riff_creator_starts s
      join public.projects p on (p.id, p.account_id) = (s.project_id, s.account_id)
      join lateral (
        select cj.id, cj.kind, cj.state, cj.updated_at
        from public.creator_jobs cj
        where cj.account_id = s.account_id and cj.project_id = s.project_id
        order by cj.updated_at desc, cj.id
        limit 1
      ) j on true
      where s.account_id = p_account_id
      order by j.updated_at desc, j.id
      limit v_limit
    ) recent;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('work', v_work));
end;
$$;

revoke all on function public.kettle_get_riff_creator_start(uuid, jsonb),
  public.kettle_start_riff_creator(uuid, jsonb),
  public.kettle_list_riff_work(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.kettle_get_riff_creator_start(uuid, jsonb),
  public.kettle_start_riff_creator(uuid, jsonb),
  public.kettle_list_riff_work(uuid, jsonb)
  to service_role;
