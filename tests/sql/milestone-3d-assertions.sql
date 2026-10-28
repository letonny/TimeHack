set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- The upgrade preserves every 3B row and supplies compatible defaults.
do $$
begin
  if (select count(*) from public.habits where id = 'legacy-habit') <> 1
     or (select count(*) from public.session_segments where session_id = 'legacy-session') <> 3
     or (select count(*) from public.activity_events) <> 2
     or (select entry_type from public.activity_sessions where id = 'legacy-session') <> 'timer'
     or (select note from public.activity_sessions where id = 'legacy-session') <> ''
     or (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'activity_sessions' and column_name = 'started_at') <> 'NO' then
    raise exception '3B history was not preserved';
  end if;
end $$;

-- Direct writes, including same-account writes, cannot bypass the RPC/event log.
do $$
begin
  if has_table_privilege('authenticated', 'public.habits', 'INSERT')
     or has_table_privilege('authenticated', 'public.activity_sessions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.session_segments', 'DELETE')
     or has_table_privilege('authenticated', 'public.activities', 'INSERT')
     or has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE')
     or has_table_privilege('authenticated', 'public.manual_duration_entries', 'DELETE')
     or has_table_privilege('authenticated', 'public.activity_events', 'INSERT')
     or not has_function_privilege('authenticated', 'public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)', 'EXECUTE') then
    raise exception 'unsafe table or function privileges';
  end if;
  if not (select prosecdef from pg_proc
      where oid = 'public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)'::regprocedure)
     or exists (select 1 from pg_class
       where oid in ('public.habits'::regclass, 'public.activity_sessions'::regclass,
         'public.session_segments'::regclass, 'public.activity_events'::regclass,
         'public.activities'::regclass, 'public.user_profiles'::regclass,
         'public.manual_duration_entries'::regclass)
       and not relrowsecurity) then
    raise exception 'security definer or RLS configuration missing';
  end if;
  begin
    insert into public.habits (user_id, id, name, goal_minutes)
      values (auth.uid(), 'bypass', 'Bypass', 10);
    raise exception 'direct habit write accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.activity_events (user_id, id, entity_type, entity_id, action, payload, expected_revision, result_revision, occurred_at)
      values (auth.uid(), '39999999-0000-0000-0000-000000000001', 'habit', 'x', 'save', '{}', 0, 1, now());
    raise exception 'direct event write accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.manual_duration_entries (
      user_id, id, name, local_date, duration_milliseconds
    ) values (auth.uid(), 'bypass-duration', 'Bypass', '2026-10-28', 60000);
    raise exception 'direct duration write accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000003', 'profile', '00000000-0000-0000-0000-000000000001', 'save', 0,
  '{"displayName":"Alice"}', now()
);

select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000004', 'activity', 'activity-1', 'save', 0,
  '{"id":"activity-1","name":"Coding","icon":"laptop","color":"#a78bfa"}', now()
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000005', 'session', 'duration-1', 'save', 0,
  '{"id":"duration-1","name":"Coding","startedAt":null,"endedAt":null,"segments":[],"entryType":"manual_duration","localDate":"2026-10-28","durationMilliseconds":2700000,"activityId":"activity-1","note":"Reviewed migration"}', '2026-10-28T12:00:00Z'
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000006', 'session', 'range-1', 'save', 0,
  '{"id":"range-1","name":"Cooking","startedAt":1600000000000,"endedAt":1600001800000,"segments":[{"kind":"study","startedAt":1600000000000,"endedAt":1600001800000}],"entryType":"manual_range","localDate":null,"durationMilliseconds":null,"activityId":null,"note":"Dinner"}', now()
);

-- Duration-only rows do not weaken the timestamp/segment assumptions made by
-- deployed 3B clients.
do $$
begin
  if (select count(*) from public.manual_duration_entries where id = 'duration-1') <> 1
     or exists (select 1 from public.activity_sessions where id = 'duration-1')
     or exists (select 1 from public.activity_sessions where started_at is null)
     or exists (select 1 from public.activity_sessions s where deleted_at is null
       and not exists (select 1 from public.session_segments g
         where g.user_id = s.user_id and g.session_id = s.id)) then
    raise exception 'duration-only storage broke legacy session invariants';
  end if;
end $$;

-- A deployed 3B client can still create and evolve a timer without new keys.
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000007', 'session', 'legacy-client-active', 'save', 0,
  '{"id":"legacy-client-active","name":"Study","startedAt":1600010000000,"endedAt":null,"segments":[{"kind":"study","startedAt":1600010000000,"endedAt":null}]}', now()
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000008', 'session', 'legacy-client-active', 'save', 1,
  '{"id":"legacy-client-active","name":"Study","startedAt":1600010000000,"endedAt":null,"segments":[{"kind":"study","startedAt":1600010000000,"endedAt":1600010600000},{"kind":"break","startedAt":1600010600000,"endedAt":null}]}', now()
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000009', 'session', 'legacy-client-active', 'save', 2,
  '{"id":"legacy-client-active","name":"Study","startedAt":1600010000000,"endedAt":null,"segments":[{"kind":"study","startedAt":1600010000000,"endedAt":1600010600000},{"kind":"break","startedAt":1600010600000,"endedAt":1600010900000}]}', now()
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000010', 'session', 'legacy-client-active', 'save', 3,
  '{"id":"legacy-client-active","name":"Study","startedAt":1600010000000,"endedAt":null,"segments":[{"kind":"study","startedAt":1600010000000,"endedAt":1600010600000},{"kind":"break","startedAt":1600010600000,"endedAt":1600010900000},{"kind":"break","startedAt":1600011200000,"endedAt":null}]}', now()
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000011', 'session', 'legacy-client-active', 'save', 4,
  '{"id":"legacy-client-active","name":"Study","startedAt":1600010000000,"endedAt":1600011500000,"segments":[{"kind":"study","startedAt":1600010000000,"endedAt":1600010600000},{"kind":"break","startedAt":1600010600000,"endedAt":1600010900000},{"kind":"break","startedAt":1600011200000,"endedAt":1600011500000}]}', now()
);

-- Idempotent retries return the first result; event-id reuse with another command is rejected.
do $$
begin
  if public.apply_timehack_change(
    '30000000-0000-0000-0000-000000000005', 'session', 'duration-1', 'save', 0,
    '{"id":"duration-1","name":"Coding","startedAt":null,"endedAt":null,"segments":[],"entryType":"manual_duration","localDate":"2026-10-28","durationMilliseconds":2700000,"activityId":"activity-1","note":"Reviewed migration"}', '2026-10-28T12:00:00Z'
  ) <> 1 then raise exception 'idempotent retry failed'; end if;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000005', 'habit', 'other', 'save', 0, '{"name":"Other","goalMinutes":5}', now());
    raise exception 'event id reuse accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000012', 'session', 'duration-1', 'save', 0,
      '{"id":"duration-1","name":"Coding","startedAt":null,"endedAt":null,"segments":[],"entryType":"manual_duration","localDate":"2026-10-28","durationMilliseconds":3000000}', now());
    raise exception 'stale write accepted';
  exception when serialization_failure then null;
  end;
end $$;

-- Entry type conversion, malformed manual shapes, and completed timer rewrites are rejected atomically.
do $$
begin
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000013', 'session', 'duration-1', 'save', 1,
      '{"id":"duration-1","name":"Coding","startedAt":1600000000000,"endedAt":1600001800000,"segments":[{"kind":"study","startedAt":1600000000000,"endedAt":1600001800000}],"entryType":"manual_range","localDate":null,"durationMilliseconds":null}', now());
    raise exception 'entry type conversion accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000014', 'session', 'bad-duration', 'save', 0,
      '{"id":"bad-duration","name":"Bad","startedAt":null,"endedAt":null,"segments":[{"kind":"study","startedAt":1,"endedAt":2}],"entryType":"manual_duration","localDate":"2026-10-28","durationMilliseconds":61000}', now());
    raise exception 'bad duration accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000015', 'session', 'bad-range', 'save', 0,
      '{"id":"bad-range","name":"Bad","startedAt":1600000000000,"endedAt":1600001800000,"segments":[{"kind":"break","startedAt":1600000000000,"endedAt":1600001800000}],"entryType":"manual_range","localDate":null,"durationMilliseconds":null}', now());
    raise exception 'bad range accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000016', 'session', 'legacy-session', 'save', 1,
      '{"id":"legacy-session","name":"Study","startedAt":1000,"endedAt":4000,"segments":[{"kind":"study","startedAt":1000,"endedAt":4000}],"entryType":"timer","localDate":null,"durationMilliseconds":null,"note":"rewrite"}', now());
    raise exception 'completed timer rewrite accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.activity_events where id in (
    '30000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000014',
    '30000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000016')) <> 0 then
    raise exception 'rejected command wrote an event';
  end if;
end $$;

-- Alice can safely edit completed timer metadata while its timestamps and SET history remain identical.
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000017', 'session', 'legacy-session', 'save', 1,
  '{"id":"legacy-session","name":"Studying","startedAt":1000,"endedAt":4000,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000},{"kind":"break","startedAt":2000,"endedAt":3000},{"kind":"study","startedAt":3000,"endedAt":4000}],"entryType":"timer","localDate":null,"durationMilliseconds":null,"activityId":null,"note":"Preserved SET intervals"}', now()
);

-- Bob sees no Alice rows, cannot target Alice revisions, and cannot reference Alice activity metadata.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
begin
  if (select count(*) from public.habits) <> 0 or (select count(*) from public.activity_sessions) <> 0
     or (select count(*) from public.session_segments) <> 0 or (select count(*) from public.activities) <> 0
     or (select count(*) from public.user_profiles) <> 0 or (select count(*) from public.manual_duration_entries) <> 0
     or (select count(*) from public.activity_events) <> 0 then
    raise exception 'cross-account read allowed';
  end if;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000018', 'session', 'legacy-session', 'save', 2,
      '{"id":"legacy-session","name":"Stolen","startedAt":1000,"endedAt":4000,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000},{"kind":"break","startedAt":2000,"endedAt":3000},{"kind":"study","startedAt":3000,"endedAt":4000}]}', now());
    raise exception 'cross-account update accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.apply_timehack_change('30000000-0000-0000-0000-000000000019', 'session', 'bob-duration', 'save', 0,
      '{"id":"bob-duration","name":"Coding","startedAt":null,"endedAt":null,"segments":[],"entryType":"manual_duration","localDate":"2026-10-28","durationMilliseconds":60000,"activityId":"activity-1"}', now());
    raise exception 'cross-account activity reference accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;
