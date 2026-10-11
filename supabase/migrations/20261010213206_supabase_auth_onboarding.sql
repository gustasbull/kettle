-- Owner: integration lead. Append-only Supabase Auth and Riff onboarding support.
-- Enabling the hook remains a separate control-plane action after migration
-- verification; this migration only installs the function.

alter table public.accounts add column onboarding_seen_at timestamptz;

create function public.riff_custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_claims jsonb := event->'claims';
begin
  if jsonb_typeof(v_claims) is distinct from 'object' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Invalid access token claims.'
    ));
  end if;

  -- Supabase persists client_id for OAuth authorization-code and refresh
  -- issuance. Its OAuth server currently emits the generic `authenticated`
  -- audience and does not implement RFC 8707 resource indicators, so this
  -- constrained preview stamps all OAuth tokens from this single-purpose
  -- project with the canonical Riff MCP audience. This is not proof of which
  -- resource the client requested.
  -- Ordinary password/recovery sessions retain the native audience below.
  if jsonb_typeof(v_claims->'client_id') = 'string'
    and length(btrim(v_claims->>'client_id')) between 1 and 255 then
    v_claims := jsonb_set(
      v_claims,
      '{aud}',
      to_jsonb('https://kettle-stage2-development.g-baltramiejunas.workers.dev/mcp'::text),
      true
    );
    v_claims := jsonb_set(
      v_claims,
      '{riff_permissions}',
      '["account:read", "projects:read", "projects:write"]'::jsonb,
      true
    );
  else
    -- A normal website session has no OAuth client binding and must never inherit
    -- a stale or user-controlled Riff permission claim.
    v_claims := v_claims - 'riff_permissions';
  end if;

  return jsonb_set(event, '{claims}', v_claims, false);
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke all on function public.riff_custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.riff_custom_access_token_hook(jsonb)
  to supabase_auth_admin;

create function public.kettle_mark_riff_onboarding_seen(p_account_id uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_seen_at timestamptz;
begin
  if p_input is distinct from '{}'::jsonb then
    return public.kettle_error('VALIDATION_ERROR');
  end if;

  -- Serialize the first mark for this account. Replays return the original
  -- timestamp and do not rewrite the row.
  select a.onboarding_seen_at into v_seen_at
    from public.accounts a
    where a.id = p_account_id
    for update;
  if not found then
    return public.kettle_error('FORBIDDEN');
  end if;

  if v_seen_at is null then
    update public.accounts
      set onboarding_seen_at = now()
      where id = p_account_id
      returning onboarding_seen_at into v_seen_at;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'onboarding_seen_at', v_seen_at
  ));
end;
$$;

revoke all on function public.kettle_mark_riff_onboarding_seen(uuid, jsonb)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.kettle_mark_riff_onboarding_seen(uuid, jsonb)
  to service_role;

-- Preserve provider-neutral identity mapping and its advisory-lock behavior;
-- only new-account display copy changes from the retired Kettle brand.
create or replace function public.kettle_resolve_identity(p_issuer text, p_subject text, p_issued_at numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_identity public.account_identities%rowtype;
  v_account uuid;
begin
  if p_issuer is null or length(p_issuer) not between 1 and 2048
    or p_subject is null or length(p_subject) not between 1 and 255
    or p_issued_at is null or p_issued_at <= 0
    or p_issued_at > extract(epoch from now()) + 60 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_issuer, p_subject)::text, 0));
  select * into v_identity from public.account_identities
    where issuer = p_issuer and subject = p_subject for update;
  if found then
    if v_identity.blocked or to_timestamp(p_issued_at::double precision) <= v_identity.tokens_valid_after then
      return null;
    end if;
    return v_identity.account_id;
  end if;
  insert into public.accounts(display_name) values ('Riff member') returning id into v_account;
  insert into public.account_identities(issuer, subject, account_id) values (p_issuer, p_subject, v_account);
  return v_account;
end;
$$;

revoke all on function public.kettle_resolve_identity(text, text, numeric)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.kettle_resolve_identity(text, text, numeric)
  to service_role;
