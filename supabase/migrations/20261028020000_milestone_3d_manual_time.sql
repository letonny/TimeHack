-- Milestone 3D (review before applying). Additive support for profiles, activity
-- metadata, notes, timestamped manual ranges, and truthful duration-only entries.

create table public.activities (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 120 and name = btrim(name)),
  icon text not null check (icon in ('book', 'laptop', 'dumbbell', 'cooking', 'book-open', 'moon', 'circle')),
  color text not null check (color in ('#2dd4bf', '#a78bfa', '#38bdf8', '#fb923c', '#4ade80', '#818cf8', '#94a3b8')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create unique index activities_user_name_active_idx on public.activities (user_id, lower(name)) where deleted_at is null;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 80 and display_name = btrim(display_name)),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duration-only records intentionally live outside activity_sessions. The 3B
-- client assumes every activity_session has timestamps and at least one segment;
-- keeping that invariant prevents one new record from breaking an older client.
create table public.manual_duration_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 120 and name = btrim(name)),
  local_date date not null,
  duration_milliseconds bigint not null check (
    duration_milliseconds between 60000 and 86400000
    and duration_milliseconds % 60000 = 0
  ),
  activity_id text,
  note text not null default '' check (length(note) <= 2000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, activity_id) references public.activities(user_id, id)
);
create index manual_duration_entries_user_date_idx
  on public.manual_duration_entries (user_id, local_date desc) where deleted_at is null;

alter table public.activity_sessions drop constraint activity_sessions_check;
alter table public.activity_sessions
  add column entry_type text not null default 'timer' check (entry_type in ('timer', 'manual_range')),
  add column activity_id text,
  add column note text not null default '' check (length(note) <= 2000),
  add constraint activity_sessions_activity_fk
    foreign key (user_id, activity_id) references public.activities(user_id, id),
  add constraint activity_sessions_shape_check check (
    (entry_type = 'timer' and (ended_at is null or ended_at >= started_at))
    or (entry_type = 'manual_range' and ended_at is not null and ended_at > started_at)
  );
drop index public.activity_sessions_one_active_idx;
create unique index activity_sessions_one_active_idx
  on public.activity_sessions (user_id)
  where entry_type = 'timer' and ended_at is null and deleted_at is null;

alter table public.activity_events drop constraint activity_events_entity_type_check;
alter table public.activity_events add constraint activity_events_entity_type_check
  check (entity_type in ('habit', 'session', 'activity', 'profile'));

alter table public.activities enable row level security;
alter table public.user_profiles enable row level security;
alter table public.manual_duration_entries enable row level security;

revoke all on public.activities, public.user_profiles, public.manual_duration_entries from public, anon;
grant select on public.activities, public.user_profiles, public.manual_duration_entries to authenticated;

-- Direct writes would bypass revision checks and activity_events. Reads still use
-- RLS; all mutations are performed atomically by apply_timehack_change.
revoke insert, update, delete on public.habits, public.activity_sessions,
  public.session_segments, public.activities, public.user_profiles,
  public.manual_duration_entries from authenticated;
revoke insert, update, delete on public.activity_events from authenticated;

create policy activities_select on public.activities for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_select on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy manual_duration_entries_select on public.manual_duration_entries for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.apply_timehack_change(
  p_event_id uuid, p_entity_type text, p_entity_id text, p_action text,
  p_expected_revision bigint, p_payload jsonb, p_occurred_at timestamptz
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
  v_existing_revision bigint;
  v_segment jsonb;
  v_position integer := 0;
  v_previous timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_session_start timestamptz;
  v_session_end timestamptz;
  v_entry_type text;
  v_note text;
  v_activity_id text;
  v_existing_type text;
  v_existing_start timestamptz;
  v_existing_end timestamptz;
  v_existing_segments jsonb;
  v_old_count integer;
  v_new_count integer;
  v_index integer;
  v_old_segment jsonb;
  v_new_segment jsonb;
  v_existing_event public.activity_events%rowtype;
begin
  if v_user is null
     or p_event_id is null
     or p_entity_type not in ('habit', 'session', 'activity', 'profile')
     or p_action not in ('save', 'delete', 'import')
     or p_entity_id is null
     or length(p_entity_id) not between 1 and 120
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or p_occurred_at is null
     or (p_action = 'delete' and p_expected_revision = 0)
     or (p_action = 'import' and p_expected_revision <> 0) then
    raise exception 'invalid timehack command' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || p_event_id::text, 0)
  );
  select * into v_existing_event
    from public.activity_events
    where user_id = v_user and id = p_event_id;
  if found then
    if v_existing_event.entity_type = p_entity_type
       and v_existing_event.entity_id = p_entity_id
       and v_existing_event.action = p_action
       and v_existing_event.expected_revision = p_expected_revision
       and v_existing_event.payload = p_payload
       and v_existing_event.occurred_at = p_occurred_at then
      return v_existing_event.result_revision;
    end if;
    raise exception 'timehack event id reused with different command' using errcode = '22023';
  end if;

  -- Serialize different event IDs that target the same logical entity. This is
  -- also what makes a cross-table session create (range versus duration-only)
  -- behave as one revision stream.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user::text || ':' || p_entity_type || ':' || p_entity_id, 1
    )
  );

  if p_action <> 'delete'
     and p_entity_type <> 'profile'
     and p_payload ? 'id'
     and p_payload->>'id' <> p_entity_id then
    raise exception 'payload id mismatch' using errcode = '22023';
  end if;

  if p_entity_type = 'habit' then
    if p_action = 'delete' then
      update public.habits
        set deleted_at = now(), revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id
          and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    elsif p_expected_revision = 0 then
      insert into public.habits (user_id, id, name, goal_minutes)
        values (v_user, p_entity_id, p_payload->>'name', (p_payload->>'goalMinutes')::integer)
        on conflict (user_id, id) do nothing
        returning revision into v_revision;
    else
      update public.habits
        set name = p_payload->>'name',
          goal_minutes = (p_payload->>'goalMinutes')::integer,
          revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id
          and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    end if;

  elsif p_entity_type = 'activity' then
    if p_action = 'delete' then
      update public.activities
        set deleted_at = now(), revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id
          and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    elsif p_expected_revision = 0 then
      insert into public.activities (user_id, id, name, icon, color)
        values (v_user, p_entity_id, p_payload->>'name', p_payload->>'icon', p_payload->>'color')
        on conflict (user_id, id) do nothing
        returning revision into v_revision;
    else
      update public.activities
        set name = p_payload->>'name', icon = p_payload->>'icon',
          color = p_payload->>'color', revision = revision + 1, updated_at = now()
        where user_id = v_user and id = p_entity_id
          and revision = p_expected_revision and deleted_at is null
        returning revision into v_revision;
    end if;

  elsif p_entity_type = 'profile' then
    if p_action = 'delete' or p_entity_id <> v_user::text then
      raise exception 'invalid profile command' using errcode = '22023';
    end if;
    if p_expected_revision = 0 then
      insert into public.user_profiles (user_id, display_name)
        values (v_user, p_payload->>'displayName')
        on conflict (user_id) do nothing
        returning revision into v_revision;
    else
      update public.user_profiles
        set display_name = p_payload->>'displayName',
          revision = revision + 1, updated_at = now()
        where user_id = v_user and revision = p_expected_revision
        returning revision into v_revision;
    end if;

  else
    -- Lock and identify a session record in either physical table. IDs are kept
    -- unique across both tables by this RPC, and direct writes are not granted.
    v_existing_type := null;
    v_existing_revision := null;
    select entry_type, revision, started_at, ended_at
      into v_existing_type, v_existing_revision, v_existing_start, v_existing_end
      from public.activity_sessions
      where user_id = v_user and id = p_entity_id and deleted_at is null
      for update;
    if not found then
      select 'manual_duration', revision, null::timestamptz, null::timestamptz
        into v_existing_type, v_existing_revision, v_existing_start, v_existing_end
        from public.manual_duration_entries
        where user_id = v_user and id = p_entity_id and deleted_at is null
        for update;
    end if;

    if p_action = 'delete' then
      if v_existing_revision is null or v_existing_revision <> p_expected_revision then
        raise exception 'timehack revision conflict' using errcode = '40001';
      end if;
      if v_existing_type = 'timer' and v_existing_end is null then
        raise exception 'active timer cannot be deleted' using errcode = '22023';
      elsif v_existing_type = 'manual_duration' then
        update public.manual_duration_entries
          set deleted_at = now(), revision = revision + 1, updated_at = now()
          where user_id = v_user and id = p_entity_id
            and revision = p_expected_revision and deleted_at is null
          returning revision into v_revision;
      else
        update public.activity_sessions
          set deleted_at = now(), revision = revision + 1, updated_at = now()
          where user_id = v_user and id = p_entity_id
            and revision = p_expected_revision and deleted_at is null
          returning revision into v_revision;
      end if;
    else
      v_entry_type := coalesce(p_payload->>'entryType', 'timer');
      v_note := coalesce(p_payload->>'note', '');
      v_activity_id := nullif(p_payload->>'activityId', '');
      v_session_start := case
        when p_payload->>'startedAt' is null then null
        else pg_catalog.to_timestamp((p_payload->>'startedAt')::numeric / 1000)
      end;
      v_session_end := case
        when p_payload->>'endedAt' is null then null
        else pg_catalog.to_timestamp((p_payload->>'endedAt')::numeric / 1000)
      end;

      if v_entry_type not in ('timer', 'manual_range', 'manual_duration')
         or length(v_note) > 2000
         or p_payload->>'name' is null
         or length(btrim(p_payload->>'name')) not between 1 and 120
         or p_payload->>'name' <> btrim(p_payload->>'name') then
        raise exception 'invalid session metadata' using errcode = '22023';
      end if;

      if p_expected_revision = 0 then
        if v_existing_revision is not null then
          raise exception 'timehack revision conflict' using errcode = '40001';
        end if;
      elsif v_existing_revision is null or v_existing_revision <> p_expected_revision then
        raise exception 'timehack revision conflict' using errcode = '40001';
      elsif v_existing_type <> v_entry_type then
        raise exception 'session entry type is immutable' using errcode = '22023';
      end if;

      if v_entry_type = 'manual_duration' then
        if v_session_start is not null
           or v_session_end is not null
           or p_payload->>'localDate' is null
           or (p_payload->>'localDate')::date
              > (pg_catalog.clock_timestamp() at time zone 'UTC')::date + 1
           or p_payload->>'durationMilliseconds' is null
           or (p_payload->>'durationMilliseconds')::numeric
              <> pg_catalog.trunc((p_payload->>'durationMilliseconds')::numeric)
           or (p_payload->>'durationMilliseconds')::bigint not between 60000 and 86400000
           or (p_payload->>'durationMilliseconds')::bigint % 60000 <> 0
           or pg_catalog.jsonb_typeof(coalesce(p_payload->'segments', '[]'::jsonb)) <> 'array'
           or pg_catalog.jsonb_array_length(coalesce(p_payload->'segments', '[]'::jsonb)) <> 0 then
          raise exception 'invalid manual duration shape' using errcode = '22023';
        end if;

        if p_expected_revision = 0 then
          insert into public.manual_duration_entries (
            user_id, id, name, local_date, duration_milliseconds, activity_id, note
          ) values (
            v_user, p_entity_id, p_payload->>'name', (p_payload->>'localDate')::date,
            (p_payload->>'durationMilliseconds')::bigint, v_activity_id, v_note
          )
          on conflict (user_id, id) do nothing
          returning revision into v_revision;
        else
          update public.manual_duration_entries
            set name = p_payload->>'name',
              local_date = (p_payload->>'localDate')::date,
              duration_milliseconds = (p_payload->>'durationMilliseconds')::bigint,
              activity_id = v_activity_id, note = v_note,
              revision = revision + 1, updated_at = now()
            where user_id = v_user and id = p_entity_id
              and revision = p_expected_revision and deleted_at is null
            returning revision into v_revision;
        end if;
      else
        if v_entry_type = 'manual_range' then
          if v_session_start is null
             or v_session_end is null
             or v_session_end <= v_session_start
             or v_session_end > pg_catalog.clock_timestamp()
             or p_payload->>'localDate' is not null
             or p_payload->>'durationMilliseconds' is not null
             or pg_catalog.jsonb_typeof(p_payload->'segments') <> 'array'
             or pg_catalog.jsonb_array_length(p_payload->'segments') <> 1 then
            raise exception 'invalid manual range shape' using errcode = '22023';
          end if;
        elsif v_session_start is null
           or p_payload->>'localDate' is not null
           or p_payload->>'durationMilliseconds' is not null
           or (v_session_end is not null and v_session_end < v_session_start)
           or pg_catalog.jsonb_typeof(p_payload->'segments') <> 'array'
           or pg_catalog.jsonb_array_length(p_payload->'segments') = 0 then
          raise exception 'invalid timer shape' using errcode = '22023';
        end if;

        if p_expected_revision > 0 and v_existing_type = 'timer' then
          if v_session_start is distinct from v_existing_start then
            raise exception 'timer start is immutable' using errcode = '22023';
          end if;
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'kind', kind,
              'startedAt', (extract(epoch from started_at) * 1000)::bigint,
              'endedAt', case when ended_at is null then null
                else (extract(epoch from ended_at) * 1000)::bigint end
            ) order by position), '[]'::jsonb)
            into v_existing_segments
            from public.session_segments
            where user_id = v_user and session_id = p_entity_id;

          if v_existing_end is not null then
            if v_session_end is distinct from v_existing_end
               or p_payload->'segments' <> v_existing_segments then
              raise exception 'completed timer intervals are immutable' using errcode = '22023';
            end if;
          else
            v_old_count := pg_catalog.jsonb_array_length(v_existing_segments);
            v_new_count := pg_catalog.jsonb_array_length(p_payload->'segments');
            if v_new_count < v_old_count or v_new_count > v_old_count + 1 then
              raise exception 'invalid timer transition' using errcode = '22023';
            end if;
            if v_old_count > 1 then
              for v_index in 0..v_old_count - 2 loop
                if v_existing_segments->v_index <> p_payload->'segments'->v_index then
                  raise exception 'timer history cannot be rewritten' using errcode = '22023';
                end if;
              end loop;
            end if;
            v_old_segment := v_existing_segments->(v_old_count - 1);
            v_new_segment := p_payload->'segments'->(v_old_count - 1);
            if v_old_segment->>'kind' <> v_new_segment->>'kind'
               or v_old_segment->>'startedAt' <> v_new_segment->>'startedAt' then
              raise exception 'timer segment identity changed' using errcode = '22023';
            end if;
            if v_old_segment->>'endedAt' is null then
              if v_new_count = v_old_count + 1
                 and (v_new_segment->>'endedAt' is null
                   or p_payload->'segments'->v_old_count->>'startedAt' <> v_new_segment->>'endedAt'
                   or p_payload->'segments'->v_old_count->>'kind' = v_new_segment->>'kind'
                   or p_payload->'segments'->v_old_count->>'endedAt' is not null) then
                raise exception 'invalid set transition' using errcode = '22023';
              end if;
            else
              if v_new_segment <> v_old_segment then
                raise exception 'paused timer history changed' using errcode = '22023';
              end if;
              if v_session_end is not null then
                if v_new_count <> v_old_count then
                  raise exception 'paused finish cannot add segments' using errcode = '22023';
                end if;
              elsif v_new_count <> v_old_count + 1
                 or p_payload->'segments'->v_old_count->>'kind' <> v_old_segment->>'kind'
                 or p_payload->'segments'->v_old_count->>'endedAt' is not null
                 or (p_payload->'segments'->v_old_count->>'startedAt')::numeric
                    < (v_old_segment->>'endedAt')::numeric then
                raise exception 'invalid resume transition' using errcode = '22023';
              end if;
            end if;
          end if;
        end if;

        if p_expected_revision = 0 then
          insert into public.activity_sessions (
            user_id, id, name, started_at, ended_at, entry_type, activity_id, note
          ) values (
            v_user, p_entity_id, p_payload->>'name', v_session_start,
            v_session_end, v_entry_type, v_activity_id, v_note
          )
          on conflict (user_id, id) do nothing
          returning revision into v_revision;
        else
          update public.activity_sessions
            set name = p_payload->>'name', started_at = v_session_start,
              ended_at = v_session_end, entry_type = v_entry_type,
              activity_id = v_activity_id, note = v_note,
              revision = revision + 1, updated_at = now()
            where user_id = v_user and id = p_entity_id
              and revision = p_expected_revision and deleted_at is null
            returning revision into v_revision;
        end if;

        if v_revision is not null then
          delete from public.session_segments
            where user_id = v_user and session_id = p_entity_id;
          v_previous := v_session_start;
          v_position := 0;
          for v_segment in
            select value from pg_catalog.jsonb_array_elements(p_payload->'segments')
          loop
            if pg_catalog.jsonb_typeof(v_segment) <> 'object'
               or v_segment->>'kind' not in ('study', 'break')
               or pg_catalog.jsonb_typeof(v_segment->'startedAt') <> 'number'
               or (v_segment->'endedAt' is not null
                 and pg_catalog.jsonb_typeof(v_segment->'endedAt') not in ('number', 'null')) then
              raise exception 'invalid segment metadata' using errcode = '22023';
            end if;
            v_start := pg_catalog.to_timestamp((v_segment->>'startedAt')::numeric / 1000);
            v_end := case when v_segment->>'endedAt' is null then null
              else pg_catalog.to_timestamp((v_segment->>'endedAt')::numeric / 1000) end;
            if (v_position = 0 and v_start <> v_session_start)
               or v_start < v_previous
               or (v_end is null and (
                 v_position <> pg_catalog.jsonb_array_length(p_payload->'segments') - 1
                 or v_session_end is not null))
               or (v_end is not null and (
                 v_end < v_start
                 or (v_session_end is not null and v_end > v_session_end))) then
              raise exception 'invalid segment order' using errcode = '22023';
            end if;
            if v_entry_type = 'manual_range'
               and (v_segment->>'kind' <> 'study'
                 or v_start <> v_session_start
                 or v_end <> v_session_end) then
              raise exception 'manual range must contain one matching study segment' using errcode = '22023';
            end if;
            insert into public.session_segments (
              user_id, session_id, position, kind, started_at, ended_at
            ) values (
              v_user, p_entity_id, v_position, v_segment->>'kind', v_start, v_end
            );
            v_previous := coalesce(v_end, v_start);
            v_position := v_position + 1;
          end loop;
        end if;
      end if;
    end if;
  end if;

  if v_revision is null then
    raise exception 'timehack revision conflict' using errcode = '40001';
  end if;
  insert into public.activity_events (
    user_id, id, entity_type, entity_id, action, payload,
    expected_revision, result_revision, occurred_at
  ) values (
    v_user, p_event_id, p_entity_type, p_entity_id, p_action, p_payload,
    p_expected_revision, v_revision, p_occurred_at
  );
  return v_revision;
end;
$$;

revoke all on function public.apply_timehack_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) from public, anon;
grant execute on function public.apply_timehack_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) to authenticated;
