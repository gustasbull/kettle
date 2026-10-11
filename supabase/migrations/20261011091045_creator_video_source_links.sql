-- One immutable observation may be authorized by more than one durable job fact.
-- Keep display limitations on each source link so every role retains its exact caveats.
alter table public.riff_video_observation_sources
 add column limitations jsonb;

update public.riff_video_observation_sources source
set limitations=observation.limitations
from public.riff_video_observations observation
where observation.id=source.observation_id and observation.account_id=source.account_id;

alter table public.riff_video_observation_sources
 alter column limitations set not null,
 add constraint riff_video_observation_sources_limitations_array
  check(jsonb_typeof(limitations)='array' and jsonb_array_length(limitations)<=20),
 add constraint riff_video_observation_sources_limitations_size
  check(octet_length(limitations::text)<=22000),
 drop constraint riff_video_observation_sources_pkey,
 add primary key(observation_id,source_job_id,checkpoint_key,role);

create or replace function public.kettle_ingest_riff_videos(p_account_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.creator_jobs%rowtype; checkpoint_row public.creator_job_checkpoints%rowtype;
 stored public.riff_video_catalog_ingests%rowtype; item jsonb;
 identity_id uuid; checkpoint text:=p_input->>'checkpoint_key'; catalog_role text:=p_input->>'role';
 normalized jsonb; receipt jsonb; ids jsonb; inserted_at timestamptz:=now(); observation_observed_at timestamptz;
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
   item->>'origin',item->>'permission_basis',item->'limitations',inserted_at)
  on conflict(id) do nothing;
  select observation.observed_at into observation_observed_at
  from public.riff_video_observations observation
  join public.riff_video_identities identity on (identity.id,identity.account_id)=(observation.identity_id,observation.account_id)
  where observation.id=(item->>'id')::uuid and observation.account_id=p_account_id
   and identity.platform=item->>'platform' and identity.native_id=item->>'native_id'
   and observation.canonical_url=item->>'canonical_url'
   and observation.caption is not distinct from item->>'caption'
   and observation.thumbnail_url is not distinct from item->>'thumbnail_url'
   and observation.published_at is not distinct from (item->>'published_at')::timestamptz
   and observation.duration_seconds is not distinct from (item->>'duration_seconds')::numeric
   and observation.views is not distinct from (item#>>'{metrics,views}')::bigint
   and observation.likes is not distinct from (item#>>'{metrics,likes}')::bigint
   and observation.comments is not distinct from (item#>>'{metrics,comments}')::bigint
   and observation.shares is not distinct from (item#>>'{metrics,shares}')::bigint
   and observation.saves is not distinct from (item#>>'{metrics,saves}')::bigint
   and observation.retrieved_at=(item->>'retrieved_at')::timestamptz
   and observation.source_observed_at is not distinct from (item->>'source_observed_at')::timestamptz
   and observation.origin=item->>'origin' and observation.permission_basis=item->>'permission_basis';
  if not found then raise exception 'catalog observation conflict' using errcode='23505';end if;
  insert into public.riff_video_observation_sources(observation_id,account_id,project_id,source_job_id,checkpoint_key,role,observed_at,limitations)
   values((item->>'id')::uuid,p_account_id,j.project_id,j.id,checkpoint,catalog_role,observation_observed_at,item->'limitations');
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

create or replace function public.kettle_list_riff_videos(p_account_id uuid,p_input jsonb) returns jsonb
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
 with selected_sources as (
  select distinct on (s.observation_id) s.*
  from public.riff_video_observation_sources s
  where s.account_id=p_account_id and (pid is null or s.project_id=pid) and (catalog_role is null or s.role=catalog_role)
  order by s.observation_id,s.role asc,s.source_job_id desc,s.checkpoint_key desc
 ), filtered as (
  select o.*,i.platform,i.native_id,s.role,s.project_id,s.limitations source_limitations,
   row_number() over(partition by o.identity_id order by o.observed_at desc,o.id desc) as rank
  from selected_sources s
  join public.riff_video_observations o on (o.id,o.account_id,o.observed_at)=(s.observation_id,s.account_id,s.observed_at)
  join public.riff_video_identities i on (i.id,i.account_id)=(o.identity_id,o.account_id)
 ), retained as (
  select * from filtered where rank=1 and (after_time is null or (observed_at,id)<(after_time,after_id))
  order by observed_at desc,id desc limit page_limit+1
 ), emitted as (select * from retained order by observed_at desc,id desc limit page_limit)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'platform',platform,'native_id',native_id,'canonical_url',canonical_url,
  'caption',caption,'thumbnail_url',thumbnail_url,'published_at',published_at,'duration_seconds',duration_seconds,
  'metrics',jsonb_build_object('views',views,'likes',likes,'comments',comments,'shares',shares,'saves',saves),
  'retrieved_at',retrieved_at,'source_observed_at',source_observed_at,'observed_at',observed_at,'origin',origin,
  'role',role,'permission_basis',permission_basis,'limitations',source_limitations) order by observed_at desc,id desc),'[]'::jsonb)
 into cards from emitted;
 with selected_sources as (
  select distinct on (s.observation_id) s.*
  from public.riff_video_observation_sources s
  where s.account_id=p_account_id and (pid is null or s.project_id=pid) and (catalog_role is null or s.role=catalog_role)
  order by s.observation_id,s.role asc,s.source_job_id desc,s.checkpoint_key desc
 ), filtered as (
  select o.id,o.identity_id,o.observed_at,row_number() over(partition by o.identity_id order by o.observed_at desc,o.id desc) as rank
  from selected_sources s
  join public.riff_video_observations o on (o.id,o.account_id,o.observed_at)=(s.observation_id,s.account_id,s.observed_at)
 ), retained as (select * from filtered where rank=1 and (after_time is null or (observed_at,id)<(after_time,after_id)) order by observed_at desc,id desc limit page_limit+1)
 select case when count(*)>page_limit then (select jsonb_build_object('observed_at',observed_at,'id',id) from retained order by observed_at desc,id desc offset page_limit-1 limit 1) else null end
 into next_position from retained;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('cards',cards,'next_position',next_position));
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return public.kettle_error('VALIDATION_ERROR');
end; $$;

revoke all on function public.kettle_ingest_riff_videos(uuid,jsonb),public.kettle_list_riff_videos(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.kettle_ingest_riff_videos(uuid,jsonb) to service_role;
grant execute on function public.kettle_list_riff_videos(uuid,jsonb) to service_role;
