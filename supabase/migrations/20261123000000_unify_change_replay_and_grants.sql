-- Both public entry points now run the same classification and replay logic.
-- Keep the established revision/interval writer intact and inaccessible to clients.
create schema if not exists timehack_private;
revoke all on schema timehack_private from public, anon, authenticated;
do $move$
begin
  if to_regprocedure('timehack_private.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz)') is null then
    alter function public.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz)
      set schema timehack_private;
  end if;
end
$move$;
revoke all on function timehack_private.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

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

create or replace function public.apply_timehack_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language sql security definer set search_path = '' as $$
  select public.apply_timehack_classified_change(p_event_id, p_entity_type, p_entity_id,
    p_action, p_expected_revision, p_payload, p_occurred_at);
$$;
revoke all on function public.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz) to authenticated;

-- Normalize historical bootstrap grants, including privileges outside RLS.
revoke all on public.habits, public.activity_sessions, public.session_segments,
  public.activity_events, public.activities, public.user_profiles,
  public.manual_duration_entries, public.habit_reminders from public, anon, authenticated;
grant select on public.habits, public.activity_sessions, public.session_segments,
  public.activity_events, public.activities, public.user_profiles,
  public.manual_duration_entries, public.habit_reminders to authenticated;
