-- TimeHack Milestone 3B. All timestamps are UTC instants; the browser computes local days.
create table public.habits (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 120 and name = btrim(name)),
  goal_minutes integer not null check (goal_minutes between 1 and 1440),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create unique index habits_user_name_active_idx on public.habits (user_id, lower(name)) where deleted_at is null;
create index habits_user_updated_idx on public.habits (user_id, updated_at desc);

create table public.activity_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 120 and name = btrim(name)),
  started_at timestamptz not null,
  ended_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  check (ended_at is null or ended_at >= started_at)
);
create index activity_sessions_user_started_idx on public.activity_sessions (user_id, started_at desc) where deleted_at is null;
create index activity_sessions_user_updated_idx on public.activity_sessions (user_id, updated_at desc);
create unique index activity_sessions_one_active_idx on public.activity_sessions (user_id) where ended_at is null and deleted_at is null;

create table public.session_segments (
  user_id uuid not null,
  session_id text not null,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('study', 'break')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id, position),
  foreign key (user_id, session_id) references public.activity_sessions(user_id, id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);
create index session_segments_user_session_idx on public.session_segments (user_id, session_id, position);

create table public.activity_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  entity_type text not null check (entity_type in ('habit', 'session')),
  entity_id text not null check (length(entity_id) between 1 and 120),
  action text not null check (action in ('save', 'delete', 'import')),
  payload jsonb not null,
  expected_revision bigint not null check (expected_revision >= 0),
  result_revision bigint not null check (result_revision > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index activity_events_user_created_idx on public.activity_events (user_id, created_at desc);
create index activity_events_entity_idx on public.activity_events (user_id, entity_type, entity_id, created_at desc);

alter table public.habits enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.session_segments enable row level security;
alter table public.activity_events enable row level security;

revoke all on public.habits, public.activity_sessions, public.session_segments, public.activity_events from public, anon;
grant select, insert, update, delete on public.habits, public.activity_sessions, public.session_segments to authenticated;
grant select, insert on public.activity_events to authenticated;

create policy habits_select on public.habits for select to authenticated using (user_id = (select auth.uid()));
create policy habits_insert on public.habits for insert to authenticated with check (user_id = (select auth.uid()));
create policy habits_update on public.habits for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy habits_delete on public.habits for delete to authenticated using (user_id = (select auth.uid()));
create policy sessions_select on public.activity_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_insert on public.activity_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy sessions_update on public.activity_sessions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sessions_delete on public.activity_sessions for delete to authenticated using (user_id = (select auth.uid()));
create policy segments_select on public.session_segments for select to authenticated using (user_id = (select auth.uid()));
create policy segments_insert on public.session_segments for insert to authenticated with check (user_id = (select auth.uid()));
create policy segments_update on public.session_segments for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy segments_delete on public.session_segments for delete to authenticated using (user_id = (select auth.uid()));
create policy events_select on public.activity_events for select to authenticated using (user_id = (select auth.uid()));
create policy events_insert on public.activity_events for insert to authenticated with check (user_id = (select auth.uid()));

-- A transactionally applied command makes retries idempotent and rejects stale devices.
create function public.apply_timehack_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
  v_segment jsonb;
  v_position integer := 0;
  v_previous timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_session_start timestamptz;
  v_session_end timestamptz;
begin
  if v_user is null or p_event_id is null or p_entity_type not in ('habit', 'session')
     or p_action not in ('save', 'delete', 'import') or p_entity_id is null
     or length(p_entity_id) not between 1 and 120 or p_expected_revision is null
     or p_expected_revision < 0 or p_payload is null or p_occurred_at is null then
    raise exception 'invalid timehack command';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0));
  select result_revision into v_revision from public.activity_events where user_id = v_user and id = p_event_id;
  if found then return v_revision; end if;

  if p_entity_type = 'habit' then
    if p_action = 'delete' then
      update public.habits set deleted_at = now(), revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    elsif p_expected_revision = 0 then
      insert into public.habits (user_id, id, name, goal_minutes)
        values (v_user, p_entity_id, p_payload->>'name', (p_payload->>'goalMinutes')::integer)
        on conflict (user_id, id) do nothing returning revision into v_revision;
    else
      update public.habits set name = p_payload->>'name', goal_minutes = (p_payload->>'goalMinutes')::integer,
        revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    end if;
  else
    if p_action = 'delete' then
      update public.activity_sessions set deleted_at = now(), revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id and revision = p_expected_revision and deleted_at is null and ended_at is not null
        returning revision into v_revision;
    else
      v_session_start := pg_catalog.to_timestamp((p_payload->>'startedAt')::numeric / 1000);
      v_session_end := case when p_payload->>'endedAt' is null then null else pg_catalog.to_timestamp((p_payload->>'endedAt')::numeric / 1000) end;
      if pg_catalog.jsonb_typeof(p_payload->'segments') <> 'array' or pg_catalog.jsonb_array_length(p_payload->'segments') = 0 then
        raise exception 'invalid segments';
      end if;
      if p_expected_revision = 0 then
        insert into public.activity_sessions (user_id, id, name, started_at, ended_at)
          values (v_user, p_entity_id, p_payload->>'name', v_session_start, v_session_end)
          on conflict (user_id, id) do nothing returning revision into v_revision;
      else
        update public.activity_sessions set name = p_payload->>'name', started_at = v_session_start,
          ended_at = v_session_end, revision = revision + 1, updated_at = now()
          where user_id = v_user and id = p_entity_id and revision = p_expected_revision and deleted_at is null
          returning revision into v_revision;
      end if;
      if v_revision is not null then
        delete from public.session_segments where user_id = v_user and session_id = p_entity_id;
        v_previous := v_session_start;
        for v_segment in select value from pg_catalog.jsonb_array_elements(p_payload->'segments') loop
          v_start := pg_catalog.to_timestamp((v_segment->>'startedAt')::numeric / 1000);
          v_end := case when v_segment->>'endedAt' is null then null else pg_catalog.to_timestamp((v_segment->>'endedAt')::numeric / 1000) end;
          if v_start < v_previous or (v_end is null and (v_position <> pg_catalog.jsonb_array_length(p_payload->'segments') - 1 or v_session_end is not null))
             or (v_end is not null and (v_end < v_start or (v_session_end is not null and v_end > v_session_end))) then
            raise exception 'invalid segment order';
          end if;
          insert into public.session_segments (user_id, session_id, position, kind, started_at, ended_at)
            values (v_user, p_entity_id, v_position, v_segment->>'kind', v_start, v_end);
          v_previous := coalesce(v_end, v_start);
          v_position := v_position + 1;
        end loop;
      end if;
    end if;
  end if;
  if v_revision is null then raise exception 'timehack revision conflict' using errcode = '40001'; end if;
  insert into public.activity_events (user_id, id, entity_type, entity_id, action, payload, expected_revision, result_revision, occurred_at)
    values (v_user, p_event_id, p_entity_type, p_entity_id, p_action, p_payload, p_expected_revision, v_revision, p_occurred_at);
  return v_revision;
end;
$$;
revoke all on function public.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_timehack_change(uuid, text, text, text, bigint, jsonb, timestamptz) to authenticated;
