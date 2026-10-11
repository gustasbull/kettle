-- Account-scoped, provider-free Riff video catalog. Rows are immutable safe projections.
create table public.riff_video_identities (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
 platform text not null check(platform='tiktok'), native_id text not null check(length(btrim(native_id)) between 1 and 200),
 created_at timestamptz not null default now(), unique(account_id,platform,native_id), unique(id,account_id)
);
create table public.riff_video_observations (
 id uuid primary key, account_id uuid not null references public.accounts(id), identity_id uuid not null,
 canonical_url text not null check(length(canonical_url) between 1 and 2048), caption text check(length(caption)<=10000),
 thumbnail_url text check(length(thumbnail_url)<=4096), published_at timestamptz,
 duration_seconds numeric check(duration_seconds>0 and duration_seconds<=86400),
 views bigint check(views between 0 and 9007199254740991), likes bigint check(likes between 0 and 9007199254740991),
 comments bigint check(comments between 0 and 9007199254740991), shares bigint check(shares between 0 and 9007199254740991),
 saves bigint check(saves between 0 and 9007199254740991), retrieved_at timestamptz not null,
 source_observed_at timestamptz, origin text not null check(origin in ('fixture','live')),
 permission_basis text not null check(length(btrim(permission_basis)) between 1 and 2000),
 limitations jsonb not null check(jsonb_typeof(limitations)='array' and jsonb_array_length(limitations)<=20 and octet_length(limitations::text)<=22000),
 observed_at timestamptz not null default now(), unique(id,account_id), unique(id,account_id,observed_at),
 foreign key(identity_id,account_id) references public.riff_video_identities(id,account_id)
);
create index riff_video_observations_account_order on public.riff_video_observations(account_id,observed_at desc,id desc);
create index riff_video_observations_identity_order on public.riff_video_observations(account_id,identity_id,observed_at desc,id desc);

create table public.riff_video_observation_sources (
 observation_id uuid primary key, account_id uuid not null, project_id uuid not null, source_job_id uuid not null,
 checkpoint_key text not null check(length(checkpoint_key) between 1 and 200 and checkpoint_key ~ '^[a-z0-9][a-z0-9:_-]{0,199}$'),
 role text not null check(role in ('own_profile','discovered_reference')), observed_at timestamptz not null,
 foreign key(project_id,account_id) references public.projects(id,account_id),
 foreign key(source_job_id,account_id) references public.creator_jobs(id,account_id),
 foreign key(source_job_id,checkpoint_key) references public.creator_job_checkpoints(job_id,key),
 foreign key(observation_id,account_id,observed_at) references public.riff_video_observations(id,account_id,observed_at)
);
create index riff_video_observation_sources_account_project_role_order
 on public.riff_video_observation_sources(account_id,project_id,role,observed_at desc,observation_id desc);

create table public.riff_video_catalog_ingests (
 source_job_id uuid not null, checkpoint_key text not null, role text not null check(role in ('own_profile','discovered_reference')),
 account_id uuid not null, input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=131072),
 output jsonb not null check(jsonb_typeof(output)='object' and octet_length(output::text)<=4096), created_at timestamptz not null default now(),
 primary key(source_job_id,checkpoint_key,role), foreign key(source_job_id,account_id) references public.creator_jobs(id,account_id),
 foreign key(source_job_id,checkpoint_key) references public.creator_job_checkpoints(job_id,key)
);

alter table public.riff_video_identities enable row level security;
alter table public.riff_video_observations enable row level security;
alter table public.riff_video_observation_sources enable row level security;
alter table public.riff_video_catalog_ingests enable row level security;
revoke all on public.riff_video_identities,public.riff_video_observations,public.riff_video_observation_sources,public.riff_video_catalog_ingests
 from public,anon,authenticated,service_role;
grant select on public.riff_video_identities to service_role;
grant select on public.riff_video_observations to service_role;
grant select on public.riff_video_observation_sources to service_role;

create function public.kettle_riff_video_observation_valid(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare metric jsonb; limitation jsonb; n numeric;
begin
 if not public.kettle_jsonb_exact_keys(p_value,array['id','platform','native_id','canonical_url','caption','thumbnail_url','published_at','duration_seconds','metrics','retrieved_at','source_observed_at','origin','permission_basis','limitations'])
  or jsonb_typeof(p_value->'id')<>'string' or jsonb_typeof(p_value->'platform')<>'string'
  or jsonb_typeof(p_value->'native_id')<>'string' or jsonb_typeof(p_value->'canonical_url')<>'string'
  or jsonb_typeof(p_value->'retrieved_at')<>'string' or jsonb_typeof(p_value->'origin')<>'string'
  or jsonb_typeof(p_value->'permission_basis')<>'string'
  or p_value->>'platform'<>'tiktok' or p_value->>'native_id' is distinct from btrim(p_value->>'native_id') or length(btrim(p_value->>'native_id')) not between 1 and 200
  or length(p_value->>'canonical_url') not between 1 and 2048
  or p_value->>'canonical_url' !~ '^https://(www\.)?tiktok\.com/' or (p_value->>'canonical_url') ~ '[?#]'
  or (p_value->'caption'<>'null'::jsonb and (jsonb_typeof(p_value->'caption')<>'string' or length(p_value->>'caption')>10000))
  or (p_value->'thumbnail_url'<>'null'::jsonb and (jsonb_typeof(p_value->'thumbnail_url')<>'string' or length(p_value->>'thumbnail_url')>4096
    or p_value->>'thumbnail_url' !~ '^https://([A-Za-z0-9-]+\.)*tiktokcdn(-us)?\.com/' or p_value->>'thumbnail_url' ~ '#'))
  or p_value->>'origin' not in ('fixture','live') or p_value->>'permission_basis' is distinct from btrim(p_value->>'permission_basis') or length(btrim(p_value->>'permission_basis')) not between 1 and 2000
  or jsonb_typeof(p_value->'metrics')<>'object' or not public.kettle_jsonb_exact_keys(p_value->'metrics',array['views','likes','comments','shares','saves'])
  or jsonb_typeof(p_value->'limitations')<>'array' or jsonb_array_length(p_value->'limitations')>20
  or octet_length((p_value->'limitations')::text)>22000 then return false; end if;
 perform (p_value->>'id')::uuid;perform (p_value->>'retrieved_at')::timestamptz;
 if p_value->'published_at'<>'null'::jsonb then if jsonb_typeof(p_value->'published_at')<>'string' then return false;end if;perform (p_value->>'published_at')::timestamptz; end if;
 if p_value->'source_observed_at'<>'null'::jsonb then if jsonb_typeof(p_value->'source_observed_at')<>'string' then return false;end if;perform (p_value->>'source_observed_at')::timestamptz; end if;
 if p_value->'duration_seconds'<>'null'::jsonb then if jsonb_typeof(p_value->'duration_seconds')<>'number' then return false;end if;n:=(p_value->>'duration_seconds')::numeric;if n<=0 or n>86400 then return false;end if;end if;
 for metric in select value from jsonb_each(p_value->'metrics') loop
  if metric<>'null'::jsonb then if jsonb_typeof(metric)<>'number' then return false;end if;n:=(metric#>>'{}')::numeric;if n<0 or n>9007199254740991 or trunc(n)<>n then return false;end if;end if;
 end loop;
 for limitation in select value from jsonb_array_elements(p_value->'limitations') loop
  if jsonb_typeof(limitation)<>'string' or (limitation#>>'{}') is distinct from btrim(limitation#>>'{}') or length(btrim(limitation#>>'{}')) not between 1 and 1000 then return false;end if;
 end loop;
 return true;
exception when others then return false;
end; $$;

create function public.kettle_ingest_riff_videos(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.creator_jobs%rowtype; checkpoint_row public.creator_job_checkpoints%rowtype;
 stored public.riff_video_catalog_ingests%rowtype; item jsonb;
 identity_id uuid; checkpoint text:=p_input->>'checkpoint_key'; catalog_role text:=p_input->>'role';
 normalized jsonb; receipt jsonb; ids jsonb; inserted_at timestamptz:=now();
begin
 if jsonb_typeof(p_input)<>'object' or not public.kettle_jsonb_exact_keys(p_input,array['job_id','checkpoint_key','role','observations'])
  or checkpoint is null or checkpoint!~'^[a-z0-9][a-z0-9:_-]{0,199}$'
  or catalog_role not in ('own_profile','discovered_reference') or jsonb_typeof(p_input->'observations')<>'array'
  or jsonb_array_length(p_input->'observations') not between 1 and 10 or octet_length(p_input::text)>131072
  then return public.kettle_error('VALIDATION_ERROR');end if;
 perform 1 from public.accounts where id=p_account_id and state='active' for update;
 if not found then return public.kettle_error('FORBIDDEN');end if;
 normalized:=jsonb_build_object('job_id',p_input->'job_id','checkpoint_key',checkpoint,'role',catalog_role,'observations',p_input->'observations');
 select owned.* into j from public.creator_jobs owned where owned.id=(p_input->>'job_id')::uuid and owned.account_id=p_account_id for update;
 if not found then return public.kettle_error('NOT_FOUND');end if;
 select ingest.* into stored from public.riff_video_catalog_ingests ingest
  where ingest.source_job_id=(p_input->>'job_id')::uuid and ingest.checkpoint_key=checkpoint and ingest.role=catalog_role and ingest.account_id=p_account_id;
 if found then
  if stored.input is distinct from normalized then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
  return stored.output;
 end if;
 if j.state<>'running' then return public.kettle_error('FORBIDDEN');end if;
 select cp.* into checkpoint_row from public.creator_job_checkpoints cp where cp.job_id=j.id and cp.key=checkpoint;
 if not found then return public.kettle_error('VALIDATION_ERROR');end if;
 if checkpoint_row.stage is distinct from (case when j.kind='scan' then 'reading_posts'
   when j.kind='recommendations' then 'enriching_references' else '' end)
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if not ((j.kind='scan' and catalog_role='own_profile' and checkpoint~'^scan:feed:[0-9]+$')
  or (j.kind='recommendations' and catalog_role='discovered_reference' and checkpoint~'^recommend:detail:[^:]{1,200}$'))
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if j.kind='recommendations' and (jsonb_array_length(p_input->'observations')<>1
   or checkpoint is distinct from 'recommend:detail:'||(p_input#>>'{observations,0,native_id}'))
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if exists(select 1 from jsonb_array_elements(p_input->'observations') value where not public.kettle_riff_video_observation_valid(value))
  or (select count(*) from jsonb_array_elements(p_input->'observations'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_input->'observations') value)
  or (select count(*) from jsonb_array_elements(p_input->'observations'))<>(select count(distinct (value->>'platform',value->>'native_id')) from jsonb_array_elements(p_input->'observations') value)
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if j.kind='scan' and exists(
   select 1 from jsonb_array_elements(p_input->'observations') observation
   where not exists(select 1 from jsonb_array_elements(checkpoint_row.progress->'videos') video
    where (video->>'platform',video->>'native_id',video->>'url') is not distinct from
      (observation->>'platform',observation->>'native_id',observation->>'canonical_url')))
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if j.kind='recommendations' and (jsonb_array_length(checkpoint_row.progress->'references')=0 or
   (checkpoint_row.progress->'references'->(jsonb_array_length(checkpoint_row.progress->'references')-1)->>'platform',
    checkpoint_row.progress->'references'->(jsonb_array_length(checkpoint_row.progress->'references')-1)->>'native_id',
    checkpoint_row.progress->'references'->(jsonb_array_length(checkpoint_row.progress->'references')-1)->>'url') is distinct from
   (p_input#>>'{observations,0,platform}',p_input#>>'{observations,0,native_id}',p_input#>>'{observations,0,canonical_url}'))
  then return public.kettle_error('VALIDATION_ERROR');end if;
 if exists(select 1 from jsonb_array_elements(p_input->'observations') value join public.riff_video_observations existing on existing.id=(value->>'id')::uuid)
  then return public.kettle_error('IDEMPOTENCY_CONFLICT');end if;
 for item in select value from jsonb_array_elements(p_input->'observations') loop
  insert into public.riff_video_identities(account_id,platform,native_id) values(p_account_id,item->>'platform',item->>'native_id')
   on conflict(account_id,platform,native_id) do nothing;
  select id into identity_id from public.riff_video_identities where account_id=p_account_id and platform=item->>'platform' and native_id=item->>'native_id';
  insert into public.riff_video_observations(id,account_id,identity_id,canonical_url,caption,thumbnail_url,published_at,duration_seconds,
   views,likes,comments,shares,saves,retrieved_at,source_observed_at,origin,permission_basis,limitations,observed_at)
  values((item->>'id')::uuid,p_account_id,identity_id,item->>'canonical_url',item->>'caption',item->>'thumbnail_url',
   (item->>'published_at')::timestamptz,(item->>'duration_seconds')::numeric,(item#>>'{metrics,views}')::bigint,
   (item#>>'{metrics,likes}')::bigint,(item#>>'{metrics,comments}')::bigint,(item#>>'{metrics,shares}')::bigint,
   (item#>>'{metrics,saves}')::bigint,(item->>'retrieved_at')::timestamptz,(item->>'source_observed_at')::timestamptz,
   item->>'origin',item->>'permission_basis',item->'limitations',inserted_at);
  insert into public.riff_video_observation_sources(observation_id,account_id,project_id,source_job_id,checkpoint_key,role,observed_at)
   values((item->>'id')::uuid,p_account_id,j.project_id,j.id,checkpoint,catalog_role,inserted_at);
 end loop;
 select jsonb_agg(value->'id' order by ordinal) into ids from jsonb_array_elements(p_input->'observations') with ordinality values(value,ordinal);
 receipt:=jsonb_build_object('ok',true,'data',jsonb_build_object('status','stored','ingested_count',jsonb_array_length(p_input->'observations'),'observation_ids',ids));
 insert into public.riff_video_catalog_ingests(source_job_id,checkpoint_key,role,account_id,input,output)
 values(j.id,checkpoint,catalog_role,p_account_id,normalized,receipt);
 return receipt;
exception
 when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return public.kettle_error('VALIDATION_ERROR');
 when unique_violation or foreign_key_violation or check_violation then return public.kettle_error('IDEMPOTENCY_CONFLICT');
 when others then return public.kettle_error('UNAVAILABLE');
end; $$;

create function public.kettle_list_riff_videos(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare pid uuid; catalog_role text; after_time timestamptz; after_id uuid; page_limit integer; numeric_limit numeric; cards jsonb; next_position jsonb;
begin
 if jsonb_typeof(p_input)<>'object' or not public.kettle_jsonb_exact_keys(p_input,array['project_id','role','sort','after','limit'])
  or p_input->>'sort'<>'observed_at_desc' or jsonb_typeof(p_input->'limit')<>'number'
  then return public.kettle_error('VALIDATION_ERROR');end if;
 numeric_limit:=(p_input->>'limit')::numeric;if trunc(numeric_limit)<>numeric_limit or numeric_limit not between 1 and 20 then return public.kettle_error('VALIDATION_ERROR');end if;page_limit:=numeric_limit::integer;
 if p_input->'project_id'<>'null'::jsonb then pid:=(p_input->>'project_id')::uuid;end if;
 if p_input->'role'<>'null'::jsonb then catalog_role:=p_input->>'role';if catalog_role not in ('own_profile','discovered_reference') then return public.kettle_error('VALIDATION_ERROR');end if;end if;
 if p_input->'after'<>'null'::jsonb then
  if not public.kettle_jsonb_exact_keys(p_input->'after',array['observed_at','id']) then return public.kettle_error('VALIDATION_ERROR');end if;
  if jsonb_typeof(p_input#>'{after,observed_at}')<>'string' or jsonb_typeof(p_input#>'{after,id}')<>'string' then return public.kettle_error('VALIDATION_ERROR');end if;
  after_time:=(p_input#>>'{after,observed_at}')::timestamptz;after_id:=(p_input#>>'{after,id}')::uuid;
 end if;
 perform 1 from public.accounts where id=p_account_id and state='active';if not found then return public.kettle_error('FORBIDDEN');end if;
 if pid is not null and not exists(select 1 from public.projects p where p.id=pid and p.account_id=p_account_id) then return public.kettle_error('NOT_FOUND');end if;
 with filtered as (
  select o.*,i.platform,i.native_id,s.role,s.project_id,
   row_number() over(partition by o.identity_id order by o.observed_at desc,o.id desc) as rank
  from public.riff_video_observation_sources s
  join public.riff_video_observations o on (o.id,o.account_id,o.observed_at)=(s.observation_id,s.account_id,s.observed_at)
  join public.riff_video_identities i on (i.id,i.account_id)=(o.identity_id,o.account_id)
  where s.account_id=p_account_id and (pid is null or s.project_id=pid) and (catalog_role is null or s.role=catalog_role)
 ), retained as (
  select * from filtered where rank=1 and (after_time is null or (observed_at,id)<(after_time,after_id))
  order by observed_at desc,id desc limit page_limit+1
 ), emitted as (select * from retained order by observed_at desc,id desc limit page_limit)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'platform',platform,'native_id',native_id,'canonical_url',canonical_url,
  'caption',caption,'thumbnail_url',thumbnail_url,'published_at',published_at,'duration_seconds',duration_seconds,
  'metrics',jsonb_build_object('views',views,'likes',likes,'comments',comments,'shares',shares,'saves',saves),
  'retrieved_at',retrieved_at,'source_observed_at',source_observed_at,'observed_at',observed_at,'origin',origin,
  'role',role,'permission_basis',permission_basis,'limitations',limitations) order by observed_at desc,id desc),'[]'::jsonb)
 into cards from emitted;
 with filtered as (
  select o.id,o.identity_id,o.observed_at,row_number() over(partition by o.identity_id order by o.observed_at desc,o.id desc) as rank
  from public.riff_video_observation_sources s
  join public.riff_video_observations o on (o.id,o.account_id,o.observed_at)=(s.observation_id,s.account_id,s.observed_at)
  where s.account_id=p_account_id and (pid is null or s.project_id=pid) and (catalog_role is null or s.role=catalog_role)
 ), retained as (select * from filtered where rank=1 and (after_time is null or (observed_at,id)<(after_time,after_id)) order by observed_at desc,id desc limit page_limit+1)
 select case when count(*)>page_limit then (select jsonb_build_object('observed_at',observed_at,'id',id) from retained order by observed_at desc,id desc offset page_limit-1 limit 1) else null end
 into next_position from retained;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('cards',cards,'next_position',next_position));
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return public.kettle_error('VALIDATION_ERROR');
end; $$;

revoke all on function public.kettle_riff_video_observation_valid(jsonb),public.kettle_ingest_riff_videos(uuid,jsonb),public.kettle_list_riff_videos(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.kettle_riff_video_observation_valid(jsonb) to service_role;
grant execute on function public.kettle_ingest_riff_videos(uuid,jsonb) to service_role;
grant execute on function public.kettle_list_riff_videos(uuid,jsonb) to service_role;
