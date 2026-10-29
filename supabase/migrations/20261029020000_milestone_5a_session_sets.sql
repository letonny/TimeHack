-- Additive SET stopwatch storage. Apply before deploying a client that reads session_sets.
create table public.session_sets (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  session_id text not null,
  description text not null,
  segments jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, session_id) references public.activity_sessions(user_id, id)
);
create index session_sets_parent_idx on public.session_sets(user_id, session_id);
alter table public.session_sets enable row level security;
revoke all on public.session_sets from public, anon, authenticated;
grant select on public.session_sets to authenticated;
create policy session_sets_select on public.session_sets for select to authenticated
  using (user_id = (select auth.uid()));

create table public.session_set_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  entity_id text not null,
  action text not null,
  expected_revision bigint not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.session_set_events enable row level security;
revoke all on public.session_set_events from public, anon, authenticated;
grant select on public.session_set_events to authenticated;
create policy session_set_events_select on public.session_set_events for select to authenticated
  using (user_id = (select auth.uid()));

create function public.apply_timehack_set_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_event public.session_set_events%rowtype;
  v_old public.session_sets%rowtype;
  v_parent public.activity_sessions%rowtype;
  v_revision bigint;
  v_part jsonb;
  v_old_part jsonb;
  v_count integer;
  v_old_count integer;
  v_index integer;
  v_start timestamptz;
  v_end timestamptz;
  v_previous_end timestamptz;
begin
  if v_user is null or p_event_id is null or p_entity_type is distinct from 'set'
    or p_action is distinct from 'save' or p_entity_id is null or length(p_entity_id) not between 1 and 120
    or p_expected_revision is null or p_expected_revision < 0 or p_occurred_at is null
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_payload->'id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload->'sessionId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload->'description') is distinct from 'string'
    or p_payload->>'id' is distinct from p_entity_id
    or length(btrim(coalesce(p_payload->>'sessionId', ''))) not between 1 and 120
    or length(btrim(coalesce(p_payload->>'description', ''))) not between 1 and 120
    or p_payload->>'description' is distinct from btrim(p_payload->>'description')
    or pg_catalog.jsonb_typeof(p_payload->'segments') is distinct from 'array' then
    raise exception 'invalid SET command' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select * into v_event from public.session_set_events where user_id = v_user and id = p_event_id;
  if found then
    if v_event.entity_id = p_entity_id and v_event.action = p_action
      and v_event.expected_revision = p_expected_revision and v_event.payload = p_payload
      and v_event.occurred_at = p_occurred_at then return v_event.result_revision; end if;
    raise exception 'SET event ID reused' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':set:' || p_entity_id, 1));
  select * into v_parent from public.activity_sessions
    where user_id = v_user and id = p_payload->>'sessionId' and deleted_at is null
      and entry_type = 'timer' for update;
  if not found then raise exception 'SET parent session unavailable' using errcode = '23503'; end if;
  select * into v_old from public.session_sets where user_id = v_user and id = p_entity_id for update;
  if p_expected_revision = 0 then
    if found then raise exception 'SET revision conflict' using errcode = '40001'; end if;
  elsif not found or v_old.revision <> p_expected_revision or v_old.deleted_at is not null
    or v_old.session_id <> v_parent.id then
    raise exception 'SET revision conflict' using errcode = '40001';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_payload->'segments');
  if v_count < 1 or v_count > 1000 then raise exception 'invalid SET intervals' using errcode = '22023'; end if;
  v_previous_end := v_parent.started_at;
  for v_index in 0..v_count - 1 loop
    v_part := p_payload->'segments'->v_index;
    if pg_catalog.jsonb_typeof(v_part) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_part->'startedAt') is distinct from 'number'
      or (pg_catalog.jsonb_typeof(v_part->'endedAt') is distinct from 'number'
        and pg_catalog.jsonb_typeof(v_part->'endedAt') is distinct from 'null') then
      raise exception 'invalid SET interval' using errcode = '22023';
    end if;
    v_start := pg_catalog.to_timestamp((v_part->>'startedAt')::numeric / 1000);
    v_end := case when v_part->>'endedAt' is null then null
      else pg_catalog.to_timestamp((v_part->>'endedAt')::numeric / 1000) end;
    if v_start < v_previous_end or (v_end is not null and v_end < v_start)
      or (v_parent.ended_at is not null and (v_end is null or v_end > v_parent.ended_at))
      or (v_end is null and v_index <> v_count - 1)
      or (v_end is null and not exists (
        select 1 from public.session_segments active_segment
        where active_segment.user_id = v_user and active_segment.session_id = v_parent.id
          and active_segment.kind = 'study' and active_segment.ended_at is null
          and active_segment.position = (
            select pg_catalog.max(position) from public.session_segments
            where user_id = v_user and session_id = v_parent.id
          )
          and active_segment.started_at <= v_start
      ))
      or not exists (
        select 1 from public.session_segments segment
        where segment.user_id = v_user and segment.session_id = v_parent.id
          and segment.kind = 'study' and segment.started_at <= v_start
          and (segment.ended_at is null or segment.ended_at >= coalesce(v_end, v_start))
      ) then
      raise exception 'SET interval outside parent session' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.session_sets other_set,
        pg_catalog.jsonb_array_elements(other_set.segments) other_part
      where other_set.user_id = v_user and other_set.session_id = v_parent.id
        and other_set.id <> p_entity_id and other_set.deleted_at is null
        and pg_catalog.to_timestamp((other_part->>'startedAt')::numeric / 1000) < coalesce(v_end, 'infinity'::timestamptz)
        and coalesce(pg_catalog.to_timestamp((other_part->>'endedAt')::numeric / 1000), 'infinity'::timestamptz) > v_start
    ) then raise exception 'overlapping SET intervals' using errcode = '22023'; end if;
    v_previous_end := coalesce(v_end, v_start);
  end loop;

  if p_expected_revision > 0 then
    v_old_count := pg_catalog.jsonb_array_length(v_old.segments);
    if v_count <> v_old_count then raise exception 'SET history is immutable' using errcode = '22023'; end if;
    for v_index in 0..v_count - 1 loop
      v_old_part := v_old.segments->v_index;
      v_part := p_payload->'segments'->v_index;
      if v_index < v_count - 1 and v_part <> v_old_part then
        raise exception 'SET history is immutable' using errcode = '22023';
      end if;
      if v_index = v_count - 1 and (
        v_part->>'startedAt' <> v_old_part->>'startedAt'
        or (v_old_part->>'endedAt' is not null and v_part <> v_old_part)) then
        raise exception 'SET history is immutable' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_expected_revision = 0 then
    insert into public.session_sets(user_id, id, session_id, description, segments)
      values(v_user, p_entity_id, v_parent.id, p_payload->>'description', p_payload->'segments')
      returning revision into v_revision;
  else
    update public.session_sets set description = p_payload->>'description',
      segments = p_payload->'segments', revision = revision + 1, updated_at = now()
      where user_id = v_user and id = p_entity_id and revision = p_expected_revision
      returning revision into v_revision;
  end if;
  insert into public.session_set_events(user_id, id, entity_id, action, expected_revision, payload, occurred_at, result_revision)
    values(v_user, p_event_id, p_entity_id, p_action, p_expected_revision, p_payload, p_occurred_at, v_revision);
  return v_revision;
end;
$$;
revoke all on function public.apply_timehack_set_change(uuid, text, text, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_timehack_set_change(uuid, text, text, text, bigint, jsonb, timestamptz) to authenticated;

-- Explicit correction path for finished timer timestamps. Existing timer RPC
-- continues to reject interval rewrites during ordinary sync replay.
create function public.correct_timehack_timer_session(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_event public.activity_events%rowtype;
  v_session public.activity_sessions%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_count integer;
  v_index integer;
  v_start timestamptz;
  v_end timestamptz;
  v_prev timestamptz;
  v_session_start timestamptz;
  v_session_end timestamptz;
  v_revision bigint;
begin
  if v_user is null or p_event_id is null or p_entity_type is distinct from 'session'
    or p_action is distinct from 'save' or p_expected_revision is null or p_expected_revision < 1
    or p_entity_id is null or p_payload->>'id' is distinct from p_entity_id
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_payload->'id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload->'entryType') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload->'name') is distinct from 'string'
    or (p_payload ? 'note' and pg_catalog.jsonb_typeof(p_payload->'note') not in ('string', 'null'))
    or (p_payload ? 'activityId' and pg_catalog.jsonb_typeof(p_payload->'activityId') not in ('string', 'null'))
    or p_payload->>'entryType' is distinct from 'timer' or p_occurred_at is null
    or pg_catalog.jsonb_typeof(p_payload->'startedAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_payload->'endedAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_payload->'segments') is distinct from 'array'
    or length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 120
    or p_payload->>'name' is distinct from btrim(p_payload->>'name')
    or length(coalesce(p_payload->>'note', '')) > 2000 then
    raise exception 'invalid timer correction' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select * into v_event from public.activity_events where user_id = v_user and id = p_event_id;
  if found then
    if v_event.entity_type = p_entity_type and v_event.entity_id = p_entity_id
      and v_event.action = p_action and v_event.expected_revision = p_expected_revision
      and v_event.payload = p_payload and v_event.occurred_at = p_occurred_at then
      return v_event.result_revision;
    end if;
    raise exception 'timer correction event ID reused' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':session:' || p_entity_id, 1));
  select * into v_session from public.activity_sessions
    where user_id = v_user and id = p_entity_id and entry_type = 'timer'
      and ended_at is not null and deleted_at is null for update;
  if not found or v_session.revision <> p_expected_revision then
    raise exception 'timer correction revision conflict' using errcode = '40001';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'kind', kind, 'startedAt', (extract(epoch from started_at) * 1000)::bigint,
    'endedAt', (extract(epoch from ended_at) * 1000)::bigint
  ) order by position) into v_old from public.session_segments
    where user_id = v_user and session_id = p_entity_id;
  v_new := p_payload->'segments';
  v_count := pg_catalog.jsonb_array_length(v_old);
  if v_count is null or v_count < 1 or pg_catalog.jsonb_array_length(v_new) is distinct from v_count then
    raise exception 'timer correction must preserve intervals' using errcode = '22023';
  end if;
  v_session_start := pg_catalog.to_timestamp((p_payload->>'startedAt')::numeric / 1000);
  v_session_end := pg_catalog.to_timestamp((p_payload->>'endedAt')::numeric / 1000);
  if v_session_start is null or v_session_end is null
    or v_session_end <= v_session_start or v_session_end > pg_catalog.clock_timestamp()
    or v_new->0->>'startedAt' is distinct from p_payload->>'startedAt'
    or v_new->(v_count - 1)->>'endedAt' is distinct from p_payload->>'endedAt' then
    raise exception 'invalid corrected timer range' using errcode = '22023';
  end if;
  v_prev := v_session_start;
  for v_index in 0..v_count - 1 loop
    if pg_catalog.jsonb_typeof(v_new->v_index) is distinct from 'object'
      or (v_new->v_index->>'kind' is distinct from 'study'
        and v_new->v_index->>'kind' is distinct from 'break')
      or pg_catalog.jsonb_typeof(v_new->v_index->'startedAt') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_new->v_index->'endedAt') is distinct from 'number'
      or v_new->v_index->>'kind' is distinct from v_old->v_index->>'kind'
      or (v_index > 0 and v_new->v_index->>'startedAt' is distinct from v_old->v_index->>'startedAt')
      or (v_index < v_count - 1 and v_new->v_index->>'endedAt' is distinct from v_old->v_index->>'endedAt') then
      raise exception 'timer correction changed interval history' using errcode = '22023';
    end if;
    v_start := pg_catalog.to_timestamp((v_new->v_index->>'startedAt')::numeric / 1000);
    v_end := pg_catalog.to_timestamp((v_new->v_index->>'endedAt')::numeric / 1000);
    if v_start < v_prev or v_end < v_start or v_end > v_session_end then
      raise exception 'corrected timer intervals overlap' using errcode = '22023';
    end if;
    v_prev := v_end;
  end loop;
  if exists (
    select 1 from public.session_sets s,
      pg_catalog.jsonb_array_elements(s.segments) part
    where s.user_id = v_user and s.session_id = p_entity_id and s.deleted_at is null
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_new) parent_part
        where parent_part->>'kind' = 'study'
          and (parent_part->>'startedAt')::numeric <= (part->>'startedAt')::numeric
          and (parent_part->>'endedAt')::numeric >= (part->>'endedAt')::numeric
      )
  ) then raise exception 'corrected timer excludes a SET' using errcode = '22023'; end if;
  update public.activity_sessions set name = p_payload->>'name', started_at = v_session_start,
    ended_at = v_session_end, activity_id = nullif(p_payload->>'activityId', ''),
    note = coalesce(p_payload->>'note', ''), revision = revision + 1, updated_at = now()
    where user_id = v_user and id = p_entity_id and revision = p_expected_revision
    returning revision into v_revision;
  update public.session_segments segment set
    started_at = case when segment.position = 0 then v_session_start else segment.started_at end,
    ended_at = case when segment.position = v_count - 1 then v_session_end else segment.ended_at end
    where segment.user_id = v_user and segment.session_id = p_entity_id;
  insert into public.activity_events(user_id, id, entity_type, entity_id, action, payload,
    expected_revision, result_revision, occurred_at)
    values(v_user, p_event_id, p_entity_type, p_entity_id, p_action, p_payload,
      p_expected_revision, v_revision, p_occurred_at);
  return v_revision;
end;
$$;
revoke all on function public.correct_timehack_timer_session(uuid, text, text, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.correct_timehack_timer_session(uuid, text, text, text, bigint, jsonb, timestamptz) to authenticated;

-- Older clients can still call apply_timehack_change. Check the final state of
-- its transaction so a parent cannot pause, finish, or soft-delete with an
-- open SET. Deferred timing permits that RPC to replace session_segments.
create function public.check_timehack_open_set_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_session_id text;
begin
  if TG_TABLE_NAME = 'session_segments' then
    if TG_OP = 'DELETE' then v_user := OLD.user_id; v_session_id := OLD.session_id;
    else v_user := NEW.user_id; v_session_id := NEW.session_id; end if;
  else
    if TG_OP = 'DELETE' then v_user := OLD.user_id; v_session_id := OLD.id;
    else v_user := NEW.user_id; v_session_id := NEW.id; end if;
  end if;

  if exists (
    select 1 from public.session_sets s
    where s.user_id = v_user and s.session_id = v_session_id and s.deleted_at is null
      and s.segments->(pg_catalog.jsonb_array_length(s.segments) - 1)->>'endedAt' is null
      and not exists (
        select 1 from public.activity_sessions parent
        join public.session_segments segment on segment.user_id = parent.user_id
          and segment.session_id = parent.id
        where parent.user_id = s.user_id and parent.id = s.session_id
          and parent.deleted_at is null and parent.ended_at is null
          and segment.kind = 'study' and segment.ended_at is null
          and segment.position = (
            select pg_catalog.max(position) from public.session_segments
            where user_id = parent.user_id and session_id = parent.id
          )
          and segment.started_at <= pg_catalog.to_timestamp(
            (s.segments->(pg_catalog.jsonb_array_length(s.segments) - 1)->>'startedAt')::numeric / 1000
          )
      )
  ) then
    raise exception 'parent session cannot leave a SET open' using errcode = '22023';
  end if;
  return null;
end;
$$;
revoke all on function public.check_timehack_open_set_parent() from public, anon, authenticated;
create constraint trigger timehack_open_set_parent_session
  after update or delete on public.activity_sessions
  deferrable initially deferred for each row
  execute function public.check_timehack_open_set_parent();
create constraint trigger timehack_open_set_parent_segment
  after insert or update or delete on public.session_segments
  deferrable initially deferred for each row
  execute function public.check_timehack_open_set_parent();
