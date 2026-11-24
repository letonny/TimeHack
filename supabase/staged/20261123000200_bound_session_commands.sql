-- Stage after confirming compatibility with pending offline snapshots.
-- Both public RPC signatures stay unchanged. For unseen session events, reject
-- snapshots over 1,000 segments (the correction RPC ceiling) or 1 MiB of
-- canonical UTF-8 JSON, including nested SET snapshots and extra fields.
-- A thousand ordinary segments require well under 1 MiB. The separate byte
-- ceiling bounds the append-only event payload even for duration-only sessions.
-- Old exact retries return their recorded revision. An unsent oversized edit,
-- including a new edit of a historical oversized timer, cannot use this exception.
-- Applying this changes no data. To withdraw the limits, restore the classified
-- function definition from 20261123000000_unify_change_replay_and_grants.sql.
create or replace function public.apply_timehack_classified_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
  v_replayed boolean;
begin
  if v_user is null or p_entity_type is null or p_action is null
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid classified change' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select exists(select 1 from public.activity_events where user_id = v_user and id = p_event_id) into v_replayed;
  if not v_replayed then
    if p_entity_type = 'session' then
      -- Measure canonical JSON bytes, independent of TOAST compression.
      if pg_catalog.octet_length(p_payload::text) > 1048576 then
        raise exception 'session payload exceeds 1 MiB' using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(p_payload->'segments') = 'array' then
        if pg_catalog.jsonb_array_length(p_payload->'segments') > 1000 then
          raise exception 'session exceeds 1000 segments' using errcode = '22023';
        end if;
      elsif p_action <> 'delete' and coalesce(p_payload->>'entryType', 'timer') <> 'manual_duration' then
        raise exception 'session segments must be an array' using errcode = '22023';
      end if;
    end if;
    if p_payload ? 'countsProductive' and pg_catalog.jsonb_typeof(p_payload->'countsProductive') <> 'boolean' then
      raise exception 'invalid productivity classification' using errcode = '22023';
    end if;
    if p_entity_type = 'activity' and p_payload ? 'category'
      and pg_catalog.jsonb_typeof(p_payload->'category') not in ('string', 'null') then
      raise exception 'invalid activity category' using errcode = '22023';
    end if;
  end if;
  v_revision := timehack_private.apply_timehack_change(p_event_id, p_entity_type, p_entity_id, p_action,
    p_expected_revision, p_payload, p_occurred_at);
  if v_replayed or p_action = 'delete' then return v_revision; end if;
  if p_entity_type = 'activity' then
    update public.activities set
      category = case when p_payload ? 'category' then nullif(btrim(p_payload->>'category'), '') else category end,
      counts_productive = case when p_payload ? 'countsProductive' then (p_payload->>'countsProductive')::boolean else counts_productive end
      where user_id = v_user and id = p_entity_id and revision = v_revision and deleted_at is null;
  elsif p_entity_type = 'session' and p_payload ? 'countsProductive' then
    update public.activity_sessions set counts_productive = (p_payload->>'countsProductive')::boolean
      where user_id = v_user and id = p_entity_id and revision = v_revision and deleted_at is null;
    update public.manual_duration_entries set counts_productive = (p_payload->>'countsProductive')::boolean
      where user_id = v_user and id = p_entity_id and revision = v_revision and deleted_at is null;
  end if;
  return v_revision;
end;
$$;
