-- Universal Trip Mode: travel is retained in the session timeline but excluded from activity totals.
alter table public.session_segments drop constraint session_segments_kind_check;
alter table public.session_segments add constraint session_segments_kind_check
  check (kind in ('study', 'break', 'travel_out', 'travel_return'));
alter table public.activity_sessions
  add column trip_phase text check (trip_phase in ('outbound', 'arrived', 'activity', 'activity_finished', 'return')),
  add column destination text not null default '' check (length(destination) <= 120),
  add column return_destination text not null default '' check (length(return_destination) <= 120);

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
  v_existing_trip_phase text;
  v_trip_phase text;
  v_trip_stage integer;
  v_trip_kind text;
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
    select entry_type, revision, started_at, ended_at, trip_phase
      into v_existing_type, v_existing_revision, v_existing_start, v_existing_end, v_existing_trip_phase
      from public.activity_sessions
      where user_id = v_user and id = p_entity_id and deleted_at is null
      for update;
    if not found then
      select 'manual_duration', revision, null::timestamptz, null::timestamptz, null::text
        into v_existing_type, v_existing_revision, v_existing_start, v_existing_end, v_existing_trip_phase
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
      v_trip_phase := p_payload->>'tripPhase';
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
      if (p_payload ? 'tripPhase' and pg_catalog.jsonb_typeof(p_payload->'tripPhase') not in ('string', 'null'))
         or (p_payload ? 'destination' and pg_catalog.jsonb_typeof(p_payload->'destination') not in ('string', 'null'))
         or (p_payload ? 'returnDestination' and pg_catalog.jsonb_typeof(p_payload->'returnDestination') not in ('string', 'null'))
         or length(coalesce(p_payload->>'destination', '')) > 120
         or length(coalesce(p_payload->>'returnDestination', '')) > 120
         or (v_entry_type = 'manual_duration' and (
           v_trip_phase is not null or coalesce(p_payload->>'destination', '') <> ''
           or coalesce(p_payload->>'returnDestination', '') <> '')) then
        raise exception 'invalid trip metadata' using errcode = '22023';
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

        -- Travel has a fixed place in the session: outbound, productive activity
        -- (including legacy breaks), then optional return. Repeated kinds within
        -- a stage are pause/resume intervals. This check also rejects travel in
        -- ordinary timers and manual ranges, regardless of segment position.
        if v_trip_phase is null then
          if coalesce(p_payload->>'destination', '') <> ''
             or coalesce(p_payload->>'returnDestination', '') <> ''
             or exists (
               select 1 from pg_catalog.jsonb_array_elements(p_payload->'segments') part
               where part->>'kind' in ('travel_out', 'travel_return')
             ) then
            raise exception 'travel requires Trip Mode' using errcode = '22023';
          end if;
        else
          if v_entry_type <> 'timer'
             or v_trip_phase not in ('outbound', 'arrived', 'activity', 'activity_finished', 'return')
             or p_payload->'segments'->0->>'kind' is distinct from 'travel_out' then
            raise exception 'invalid trip metadata' using errcode = '22023';
          end if;
          v_trip_stage := 0;
          for v_segment in select value from pg_catalog.jsonb_array_elements(p_payload->'segments') loop
            v_trip_kind := v_segment->>'kind';
            if v_trip_kind = 'travel_out' then
              if v_trip_stage <> 0 then raise exception 'outbound travel out of order' using errcode = '22023'; end if;
            elsif v_trip_kind = 'study' then
              if v_trip_stage = 2 then raise exception 'activity after return travel' using errcode = '22023'; end if;
              v_trip_stage := 1;
            elsif v_trip_kind = 'break' then
              if v_trip_stage <> 1 then raise exception 'break outside activity' using errcode = '22023'; end if;
            elsif v_trip_kind = 'travel_return' then
              if v_trip_stage = 0 then raise exception 'return before activity' using errcode = '22023'; end if;
              v_trip_stage := 2;
            else
              raise exception 'invalid trip segment' using errcode = '22023';
            end if;
          end loop;
          if (v_trip_phase in ('outbound', 'arrived') and v_trip_stage <> 0)
             or (v_trip_phase in ('activity', 'activity_finished') and v_trip_stage <> 1)
             or (v_trip_phase = 'return' and v_trip_stage <> 2)
             or (v_trip_phase in ('arrived', 'activity_finished')
               and p_payload->'segments'->(pg_catalog.jsonb_array_length(p_payload->'segments') - 1)->>'endedAt' is null)
             or (v_session_end is not null and v_trip_phase not in ('activity_finished', 'return')) then
            raise exception 'trip phase does not match segments' using errcode = '22023';
          end if;
          -- A new live trip must begin with outbound travel. Imports may carry
          -- an already progressed trip from offline storage.
          if p_expected_revision = 0 and p_action <> 'import'
             and (v_trip_phase <> 'outbound' or v_session_end is not null
               or pg_catalog.jsonb_array_length(p_payload->'segments') <> 1
               or p_payload->'segments'->0->>'endedAt' is not null) then
            raise exception 'trip must start outbound' using errcode = '22023';
          end if;
        end if;
        if p_expected_revision > 0 and v_existing_type = 'timer' then
          if (v_existing_trip_phase is null) <> (v_trip_phase is null)
             or (v_existing_trip_phase is not null and v_trip_phase is distinct from v_existing_trip_phase
               and not ((v_existing_trip_phase = 'outbound' and v_trip_phase = 'arrived')
                 or (v_existing_trip_phase = 'arrived' and v_trip_phase = 'activity')
                 or (v_existing_trip_phase = 'activity' and v_trip_phase = 'activity_finished')
                 or (v_existing_trip_phase = 'activity_finished' and v_trip_phase = 'return'))) then
            raise exception 'invalid trip phase transition' using errcode = '22023';
          end if;
          if v_existing_end is not null and v_trip_phase is distinct from v_existing_trip_phase then
            raise exception 'completed trip phase is immutable' using errcode = '22023';
          end if;
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
                 or (p_payload->'segments'->v_old_count->>'kind' <> v_old_segment->>'kind'
                   and not ((v_old_segment->>'kind' = 'travel_out'
                     and p_payload->'segments'->v_old_count->>'kind' = 'study'
                     and v_existing_trip_phase = 'arrived'
                     and v_trip_phase = 'activity')
                     or (v_old_segment->>'kind' in ('study', 'break')
                       and p_payload->'segments'->v_old_count->>'kind' = 'travel_return'
                       and v_existing_trip_phase = 'activity_finished'
                       and v_trip_phase = 'return')))
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
            user_id, id, name, started_at, ended_at, entry_type, activity_id, note, trip_phase, destination, return_destination
          ) values (
            v_user, p_entity_id, p_payload->>'name', v_session_start,
            v_session_end, v_entry_type, v_activity_id, v_note, nullif(p_payload->>'tripPhase', ''), coalesce(p_payload->>'destination', ''), coalesce(p_payload->>'returnDestination', '')
          )
          on conflict (user_id, id) do nothing
          returning revision into v_revision;
        else
          update public.activity_sessions
            set name = p_payload->>'name', started_at = v_session_start,
              ended_at = v_session_end, entry_type = v_entry_type,
              activity_id = v_activity_id, note = v_note,
              trip_phase = nullif(p_payload->>'tripPhase', ''),
              destination = coalesce(p_payload->>'destination', ''),
              return_destination = coalesce(p_payload->>'returnDestination', ''),
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
               or v_segment->>'kind' not in ('study', 'break', 'travel_out', 'travel_return')
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

-- CREATE OR REPLACE retains existing ACLs, but state the intended boundary
-- explicitly so a fresh or drifted environment cannot expose this definer RPC.
revoke all on function public.apply_timehack_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) from public, anon;
grant execute on function public.apply_timehack_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) to authenticated;

-- The RPC is the authenticated write path. This deferred check also protects
-- the invariant if a privileged maintenance job writes these tables directly.
-- It runs after the RPC has replaced a session's segments within its transaction.
create function public.check_timehack_trip_shape()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_session_id text;
  v_session public.activity_sessions%rowtype;
  v_segment record;
  v_stage integer := 0;
  v_count integer := 0;
  v_previous_end timestamptz;
  v_last_open boolean := false;
begin
  if TG_TABLE_NAME = 'activity_sessions' then
    if TG_OP = 'DELETE' then v_user := OLD.user_id; v_session_id := OLD.id;
    else v_user := NEW.user_id; v_session_id := NEW.id; end if;
  else
    if TG_OP = 'DELETE' then v_user := OLD.user_id; v_session_id := OLD.session_id;
    else v_user := NEW.user_id; v_session_id := NEW.session_id; end if;
  end if;
  select * into v_session from public.activity_sessions
    where user_id = v_user and id = v_session_id and deleted_at is null;
  if not found then return null; end if;
  if v_session.trip_phase is null then
    if exists (select 1 from public.session_segments
      where user_id = v_user and session_id = v_session_id
        and kind in ('travel_out', 'travel_return')) then
      raise exception 'travel requires Trip Mode' using errcode = '22023';
    end if;
    return null;
  end if;

  v_previous_end := v_session.started_at;
  for v_segment in select position, kind, started_at, ended_at
    from public.session_segments where user_id = v_user and session_id = v_session_id
    order by position loop
    if v_segment.position <> v_count
       or (v_count = 0 and (v_segment.kind <> 'travel_out' or v_segment.started_at <> v_session.started_at))
       or v_last_open or v_segment.started_at < v_previous_end then
      raise exception 'invalid trip segment order' using errcode = '22023';
    end if;
    if v_segment.kind = 'travel_out' then
      if v_stage <> 0 then raise exception 'outbound travel out of order' using errcode = '22023'; end if;
    elsif v_segment.kind = 'study' then
      if v_stage = 2 then raise exception 'activity after return travel' using errcode = '22023'; end if;
      v_stage := 1;
    elsif v_segment.kind = 'break' then
      if v_stage <> 1 then raise exception 'break outside activity' using errcode = '22023'; end if;
    elsif v_segment.kind = 'travel_return' then
      if v_stage = 0 then raise exception 'return before activity' using errcode = '22023'; end if;
      v_stage := 2;
    end if;
    v_previous_end := coalesce(v_segment.ended_at, v_segment.started_at);
    v_last_open := v_segment.ended_at is null;
    v_count := v_count + 1;
  end loop;
  if v_count = 0
     or (v_session.trip_phase in ('outbound', 'arrived') and v_stage <> 0)
     or (v_session.trip_phase in ('activity', 'activity_finished') and v_stage <> 1)
     or (v_session.trip_phase = 'return' and v_stage <> 2)
     or (v_session.trip_phase in ('arrived', 'activity_finished') and v_last_open)
     or (v_session.ended_at is not null and
       (v_last_open or v_previous_end > v_session.ended_at
         or v_session.trip_phase not in ('activity_finished', 'return'))) then
    raise exception 'trip phase does not match segments' using errcode = '22023';
  end if;
  return null;
end;
$$;
revoke all on function public.check_timehack_trip_shape() from public, anon, authenticated;
create constraint trigger timehack_trip_shape_session
  after insert or update or delete on public.activity_sessions
  deferrable initially deferred for each row
  execute function public.check_timehack_trip_shape();
create constraint trigger timehack_trip_shape_segment
  after insert or update or delete on public.session_segments
  deferrable initially deferred for each row
  execute function public.check_timehack_trip_shape();
