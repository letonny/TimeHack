-- Milestone 4.6. Existing rows retain their historical productive interpretation.
alter table public.activities add column category text
  check (category is null or (length(category) between 1 and 80 and category = btrim(category))),
  add column counts_productive boolean not null default true;
alter table public.activity_sessions add column counts_productive boolean not null default true;
alter table public.manual_duration_entries add column counts_productive boolean not null default true;

-- Keep the 4.5 replay function intact. Its event/revision and interval protections
-- remain the write gate; this wrapper applies only the new snapshot fields.
create function public.apply_timehack_classified_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
  v_replayed boolean;
begin
  if v_user is null or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid classified change' using errcode = '22023';
  end if;
  if p_payload ? 'countsProductive' and pg_catalog.jsonb_typeof(p_payload->'countsProductive') <> 'boolean' then
    raise exception 'invalid productivity classification' using errcode = '22023';
  end if;
  if p_entity_type = 'activity' and p_payload ? 'category'
    and pg_catalog.jsonb_typeof(p_payload->'category') not in ('string', 'null') then
    raise exception 'invalid activity category' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select exists(select 1 from public.activity_events where user_id = v_user and id = p_event_id) into v_replayed;
  v_revision := public.apply_timehack_change(p_event_id, p_entity_type, p_entity_id, p_action,
    p_expected_revision, p_payload, p_occurred_at);
  if v_replayed or p_action = 'delete' then return v_revision; end if;
  if p_entity_type = 'activity' then
    update public.activities set
      category = case when p_payload ? 'category' then nullif(btrim(p_payload->>'category'), '') else category end,
      counts_productive = case when p_payload ? 'countsProductive' then (p_payload->>'countsProductive')::boolean else counts_productive end
      where user_id = v_user and id = p_entity_id and revision = v_revision;
  elsif p_entity_type = 'session' and p_payload ? 'countsProductive' then
    update public.activity_sessions set counts_productive = (p_payload->>'countsProductive')::boolean
      where user_id = v_user and id = p_entity_id and revision = v_revision;
    update public.manual_duration_entries set counts_productive = (p_payload->>'countsProductive')::boolean
      where user_id = v_user and id = p_entity_id and revision = v_revision;
  end if;
  return v_revision;
end;
$$;
revoke all on function public.apply_timehack_classified_change(uuid, text, text, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_timehack_classified_change(uuid, text, text, text, bigint, jsonb, timestamptz) to authenticated;

create table public.session_correction_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  session_id text not null,
  expected_revision bigint not null,
  payload jsonb not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.session_correction_events enable row level security;
revoke all on public.session_correction_events from public, anon, authenticated;
grant select on public.session_correction_events to authenticated;
create policy session_correction_events_select on public.session_correction_events for select to authenticated
  using (user_id = (select auth.uid()));

create function public.correct_timehack_session_intervals(
  p_event_id uuid, p_session_id text, p_expected_revision bigint, p_payload jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_parent public.activity_sessions%rowtype;
  v_event public.session_correction_events%rowtype;
  v_old record;
  v_part jsonb;
  v_set jsonb;
  v_set_part jsonb;
  v_old_set public.session_sets%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_previous timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_index integer;
  v_set_index integer;
  v_part_index integer;
  v_count integer;
  v_set_count integer;
  v_previous_set_end timestamptz;
  v_set_start timestamptz;
  v_set_end timestamptz;
  v_changed boolean := false;
begin
  if v_user is null or p_event_id is null or p_session_id is null or length(p_session_id) not between 1 and 120
    or p_expected_revision is null or p_expected_revision < 1
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_payload->'segments') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_payload->'sets') is distinct from 'array' then
    raise exception 'invalid correction command' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select * into v_event from public.session_correction_events where user_id = v_user and id = p_event_id;
  if found then
    if v_event.session_id = p_session_id and v_event.expected_revision = p_expected_revision
      and v_event.payload = p_payload then return v_event.result_revision; end if;
    raise exception 'correction event id reused' using errcode = '22023';
  end if;
  select * into v_parent from public.activity_sessions
    where user_id = v_user and id = p_session_id and deleted_at is null and entry_type = 'timer' for update;
  if not found then raise exception 'session unavailable' using errcode = '23503'; end if;
  if v_parent.revision <> p_expected_revision then
    raise exception 'session correction revision conflict' using errcode = '40001';
  end if;
  if v_parent.ended_at is null then raise exception 'complete the session before correcting intervals' using errcode = '22023'; end if;
  v_count := pg_catalog.jsonb_array_length(p_payload->'segments');
  if v_count < 1 or v_count > 1000 or v_count <> (
    select count(*) from public.session_segments where user_id = v_user and session_id = p_session_id
  ) then raise exception 'segment count cannot change' using errcode = '22023'; end if;
  v_previous := null;
  for v_index in 0..v_count - 1 loop
    select position, kind, started_at, ended_at into v_old from public.session_segments
      where user_id = v_user and session_id = p_session_id and position = v_index;
    v_part := p_payload->'segments'->v_index;
    if v_old.position is null or pg_catalog.jsonb_typeof(v_part) is distinct from 'object'
      or v_part->>'kind' is distinct from v_old.kind
      or pg_catalog.jsonb_typeof(v_part->'startedAt') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_part->'endedAt') is distinct from 'number'
      or ((v_part->>'startedAt')::numeric % 1) <> 0
      or ((v_part->>'endedAt')::numeric % 1) <> 0 then
      raise exception 'invalid correction segment' using errcode = '22023';
    end if;
    v_start := pg_catalog.to_timestamp((v_part->>'startedAt')::numeric / 1000);
    v_end := pg_catalog.to_timestamp((v_part->>'endedAt')::numeric / 1000);
    if v_start < '1970-01-01'::timestamptz or v_end > now() or v_end < v_start
      or (v_previous is not null and v_start < v_previous) then
      raise exception 'invalid correction interval' using errcode = '22023';
    end if;
    if v_index = 0 then v_first := v_start; end if;
    if v_start is distinct from v_old.started_at or v_end is distinct from v_old.ended_at then v_changed := true; end if;
    v_previous := v_end;
    v_last := v_end;
  end loop;
  -- Parent boundaries follow the edited first and last intervals explicitly.
  -- The 4.5 deferred trigger validates the final Trip Mode phase and order.
  v_set_count := pg_catalog.jsonb_array_length(p_payload->'sets');
  if v_set_count <> (select count(*) from public.session_sets
    where user_id = v_user and session_id = p_session_id and deleted_at is null) then
    raise exception 'all SET revisions are required' using errcode = '22023';
  end if;
  if (select count(distinct item->>'id') from pg_catalog.jsonb_array_elements(p_payload->'sets') item) <> v_set_count then
    raise exception 'duplicate SET correction' using errcode = '22023';
  end if;
  v_previous_set_end := null;
  for v_set_index in 0..v_set_count - 1 loop
    v_set := p_payload->'sets'->v_set_index;
    if pg_catalog.jsonb_typeof(v_set) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_set->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_set->'expectedRevision') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_set->'segments') is distinct from 'array' then
      raise exception 'invalid SET correction' using errcode = '22023';
    end if;
    select * into v_old_set from public.session_sets
      where user_id = v_user and session_id = p_session_id and id = v_set->>'id' and deleted_at is null for update;
    if not found or v_old_set.revision <> (v_set->>'expectedRevision')::bigint
      or pg_catalog.jsonb_array_length(v_set->'segments') <> pg_catalog.jsonb_array_length(v_old_set.segments) then
      raise exception 'SET correction revision conflict' using errcode = '40001';
    end if;
    if v_set->'segments' is distinct from v_old_set.segments then v_changed := true; end if;
    v_previous := null;
    for v_part_index in 0..pg_catalog.jsonb_array_length(v_set->'segments') - 1 loop
      v_set_part := v_set->'segments'->v_part_index;
      if pg_catalog.jsonb_typeof(v_set_part->'startedAt') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_set_part->'endedAt') is distinct from 'number'
        or ((v_set_part->>'startedAt')::numeric % 1) <> 0
        or ((v_set_part->>'endedAt')::numeric % 1) <> 0 then
        raise exception 'invalid SET interval' using errcode = '22023';
      end if;
      v_set_start := pg_catalog.to_timestamp((v_set_part->>'startedAt')::numeric / 1000);
      v_set_end := pg_catalog.to_timestamp((v_set_part->>'endedAt')::numeric / 1000);
      if v_set_end < v_set_start or (v_previous is not null and v_set_start < v_previous)
        or (v_previous_set_end is not null and v_set_start < v_previous_set_end)
        or not exists (
          select 1 from pg_catalog.jsonb_array_elements(p_payload->'segments') segment
          where segment->>'kind' = 'study'
            and pg_catalog.to_timestamp((segment->>'startedAt')::numeric / 1000) <= v_set_start
            and pg_catalog.to_timestamp((segment->>'endedAt')::numeric / 1000) >= v_set_end
        ) then raise exception 'SET must be inside an activity interval without overlap' using errcode = '22023'; end if;
      v_previous := v_set_end;
      v_previous_set_end := v_set_end;
    end loop;
  end loop;
  if not v_changed then raise exception 'correction has no interval changes' using errcode = '22023'; end if;
  -- Every SET is supplied in chronological order; duplicate ids fail the
  -- revision check after the first update. Parent and SET writes are atomic.
  for v_index in 0..v_count - 1 loop
    v_part := p_payload->'segments'->v_index;
    update public.session_segments set started_at = pg_catalog.to_timestamp((v_part->>'startedAt')::numeric / 1000),
      ended_at = pg_catalog.to_timestamp((v_part->>'endedAt')::numeric / 1000), updated_at = now()
      where user_id = v_user and session_id = p_session_id and position = v_index;
  end loop;
  for v_set_index in 0..v_set_count - 1 loop
    v_set := p_payload->'sets'->v_set_index;
    update public.session_sets set segments = v_set->'segments', revision = revision + 1, updated_at = now()
      where user_id = v_user and session_id = p_session_id and id = v_set->>'id';
  end loop;
  update public.activity_sessions set started_at = v_first, ended_at = v_last,
    revision = revision + 1, updated_at = now()
    where user_id = v_user and id = p_session_id returning revision into p_expected_revision;
  insert into public.session_correction_events(user_id, id, session_id, expected_revision, payload, result_revision)
    values (v_user, p_event_id, p_session_id, v_parent.revision, p_payload, p_expected_revision);
  return p_expected_revision;
end;
$$;
revoke all on function public.correct_timehack_session_intervals(uuid, text, bigint, jsonb) from public, anon;
grant execute on function public.correct_timehack_session_intervals(uuid, text, bigint, jsonb) to authenticated;
