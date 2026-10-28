set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- The additive migration does not rewrite legacy habits, sessions, or events.
do $$
begin
  if (select count(*) from public.habits where id = 'legacy-habit' and revision = 1) <> 1
     or (select count(*) from public.session_segments where session_id = 'legacy-session') <> 3
     or (select count(*) from public.activity_events) <> 2
     or (select count(*) from public.habit_reminders) <> 0 then
    raise exception '4A changed legacy data';
  end if;
end $$;

-- Authenticated clients can read only their rows and cannot bypass the RPC.
do $$
begin
  if has_table_privilege('authenticated', 'public.habit_reminders', 'INSERT')
     or has_table_privilege('authenticated', 'public.habit_reminders', 'UPDATE')
     or has_table_privilege('authenticated', 'public.habit_reminders', 'DELETE')
     or not has_table_privilege('authenticated', 'public.habit_reminders', 'SELECT')
     or has_table_privilege('authenticated', 'public.habit_reminder_delivery_candidates', 'SELECT')
     or not has_function_privilege('authenticated', 'public.apply_timehack_reminder_change(uuid,text,text,text,bigint,jsonb,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_timehack_reminder_change(uuid,text,text,text,bigint,jsonb,timestamptz)', 'EXECUTE')
     or not (select prosecdef from pg_proc where oid = 'public.apply_timehack_reminder_change(uuid,text,text,text,bigint,jsonb,timestamptz)'::regprocedure)
     or not (select relrowsecurity from pg_class where oid = 'public.habit_reminders'::regclass) then
    raise exception 'unsafe reminder privileges';
  end if;
  begin
    insert into public.habit_reminders (
      user_id, habit_id, local_time, time_zone, weekday_mask
    ) values (auth.uid(), 'legacy-habit', '09:00', 'America/Chicago', 127);
    raise exception 'direct reminder write accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nullable command discriminators are rejected before any mutation or event.
do $$
begin
  begin
    perform public.apply_timehack_reminder_change(
      '40000000-0000-0000-0000-000000000090', null, 'legacy-habit', 'save', 0,
      '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'null reminder entity type accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_timehack_reminder_change(
      '40000000-0000-0000-0000-000000000091', 'reminder', 'legacy-habit', null, 0,
      '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'null reminder action accepted';
  exception when invalid_parameter_value then null;
  end;
  if exists (select 1 from public.activity_events where id in (
    '40000000-0000-0000-0000-000000000090',
    '40000000-0000-0000-0000-000000000091'
  )) then raise exception 'invalid nullable command wrote an event'; end if;
end $$;

select public.apply_timehack_reminder_change(
  '40000000-0000-0000-0000-000000000001', 'reminder', 'legacy-habit', 'save', 0,
  '{"habitId":"legacy-habit","enabled":true,"localTime":"09:30","timeZone":"America/Chicago","weekdays":[1,2,3,4,5],"skipIfGoalComplete":true}',
  '2026-10-28T14:00:00Z'
);

do $$
begin
  if (select weekday_mask from public.habit_reminders where habit_id = 'legacy-habit') <> 31
     or (select local_time from public.habit_reminders where habit_id = 'legacy-habit') <> '09:30'::time
     or not (select skip_if_goal_complete from public.habit_reminders where habit_id = 'legacy-habit') then
    raise exception 'reminder create did not preserve schedule';
  end if;
  if public.apply_timehack_reminder_change(
    '40000000-0000-0000-0000-000000000001', 'reminder', 'legacy-habit', 'save', 0,
    '{"habitId":"legacy-habit","enabled":true,"localTime":"09:30","timeZone":"America/Chicago","weekdays":[1,2,3,4,5],"skipIfGoalComplete":true}',
    '2026-10-28T14:00:00Z'
  ) <> 1 then raise exception 'reminder retry was not idempotent'; end if;
end $$;

select public.apply_timehack_reminder_change(
  '40000000-0000-0000-0000-000000000002', 'reminder', 'legacy-habit', 'save', 1,
  '{"habitId":"legacy-habit","enabled":false,"localTime":"18:05","timeZone":"America/New_York","weekdays":[6,7],"skipIfGoalComplete":false}',
  '2026-10-28T14:01:00Z'
);

do $$
begin
  if (select revision from public.habit_reminders where habit_id = 'legacy-habit') <> 2
     or (select enabled from public.habit_reminders where habit_id = 'legacy-habit')
     or (select weekday_mask from public.habit_reminders where habit_id = 'legacy-habit') <> 96
     or (select skip_if_goal_complete from public.habit_reminders where habit_id = 'legacy-habit') then
    raise exception 'disabled reminder update failed';
  end if;
  begin
    perform public.apply_timehack_reminder_change(
      '40000000-0000-0000-0000-000000000003', 'reminder', 'legacy-habit', 'save', 1,
      '{"habitId":"legacy-habit","enabled":true,"localTime":"10:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'stale reminder update accepted';
  exception when serialization_failure then null;
  end;
end $$;

-- Server validation rejects malformed time, zone, weekday, and habit shapes.
do $$
declare
  v_payload jsonb;
begin
  foreach v_payload in array array[
    '{"habitId":"legacy-habit","enabled":true,"localTime":"24:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}'::jsonb,
    '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"Not/A_Zone","weekdays":[1],"skipIfGoalComplete":true}'::jsonb,
    '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[],"skipIfGoalComplete":true}'::jsonb,
    '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[1,1],"skipIfGoalComplete":true}'::jsonb
  ] loop
    begin
      perform public.apply_timehack_reminder_change(
        '40000000-0000-0000-0000-000000000099', 'reminder', 'legacy-habit', 'save', 2, v_payload, now());
      raise exception 'malformed reminder accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
end $$;

select public.apply_timehack_reminder_change(
  '40000000-0000-0000-0000-000000000004', 'reminder', 'legacy-habit', 'delete', 2,
  '{}', '2026-10-28T14:02:00Z'
);
select public.apply_timehack_reminder_change(
  '40000000-0000-0000-0000-000000000005', 'reminder', 'legacy-habit', 'save', 3,
  '{"habitId":"legacy-habit","enabled":true,"localTime":"08:15","timeZone":"America/Chicago","weekdays":[1,2,3,4,5,6,7],"skipIfGoalComplete":true}',
  '2026-10-28T14:03:00Z'
);

-- The unchanged 3D habit RPC can soft-delete a habit without rewriting its
-- reminder revision. Delivery candidates exclude it, and reminder saves cannot
-- create or resurrect schedules for the deleted habit. Delete remains available.
select public.apply_timehack_change(
  '41000000-0000-0000-0000-000000000001', 'habit', 'soft-habit', 'save', 0,
  '{"id":"soft-habit","name":"Soft habit","goalMinutes":20}', now()
);
select public.apply_timehack_reminder_change(
  '41000000-0000-0000-0000-000000000002', 'reminder', 'soft-habit', 'save', 0,
  '{"habitId":"soft-habit","enabled":true,"localTime":"09:00","timeZone":"America/Chicago","weekdays":[1,2,3,4,5,6,7],"skipIfGoalComplete":true}', now()
);
select public.apply_timehack_change(
  '41000000-0000-0000-0000-000000000003', 'habit', 'soft-habit', 'delete', 1,
  '{}', now()
);
do $$
begin
  if (select revision from public.habit_reminders where habit_id = 'soft-habit') <> 1
     or not (select enabled from public.habit_reminders where habit_id = 'soft-habit') then
    raise exception 'habit deletion rewrote reminder history';
  end if;
  begin
    perform public.apply_timehack_reminder_change(
      '41000000-0000-0000-0000-000000000004', 'reminder', 'soft-habit', 'save', 1,
      '{"habitId":"soft-habit","enabled":true,"localTime":"10:00","timeZone":"America/Chicago","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'reminder re-enabled for deleted habit';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.habit_reminder_delivery_candidates where habit_id = 'soft-habit') then
    raise exception 'deleted habit remained a delivery candidate';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select public.apply_timehack_reminder_change(
  '41000000-0000-0000-0000-000000000005', 'reminder', 'soft-habit', 'delete', 1,
  '{}', now()
);
do $$
begin
  begin
    perform public.apply_timehack_reminder_change(
      '41000000-0000-0000-0000-000000000006', 'reminder', 'soft-habit', 'save', 2,
      '{"habitId":"soft-habit","enabled":true,"localTime":"10:00","timeZone":"America/Chicago","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'reminder resurrected for deleted habit';
  exception when foreign_key_violation then null;
  end;
end $$;

select public.apply_timehack_change(
  '41000000-0000-0000-0000-000000000011', 'habit', 'soft-create-habit', 'save', 0,
  '{"id":"soft-create-habit","name":"Soft create habit","goalMinutes":15}', now()
);
select public.apply_timehack_change(
  '41000000-0000-0000-0000-000000000012', 'habit', 'soft-create-habit', 'delete', 1,
  '{}', now()
);
do $$
begin
  begin
    perform public.apply_timehack_reminder_change(
      '41000000-0000-0000-0000-000000000013', 'reminder', 'soft-create-habit', 'save', 0,
      '{"habitId":"soft-create-habit","enabled":false,"localTime":"11:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'reminder created for deleted habit';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Reminder deletion/resurrection remains supported while the habit is active.
select public.apply_timehack_change(
  '41000000-0000-0000-0000-000000000007', 'habit', 'resurrect-habit', 'save', 0,
  '{"id":"resurrect-habit","name":"Resurrect habit","goalMinutes":30}', now()
);
select public.apply_timehack_reminder_change(
  '41000000-0000-0000-0000-000000000008', 'reminder', 'resurrect-habit', 'save', 0,
  '{"habitId":"resurrect-habit","enabled":true,"localTime":"08:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now()
);
select public.apply_timehack_reminder_change(
  '41000000-0000-0000-0000-000000000009', 'reminder', 'resurrect-habit', 'delete', 1,
  '{}', now()
);
select public.apply_timehack_reminder_change(
  '41000000-0000-0000-0000-000000000010', 'reminder', 'resurrect-habit', 'save', 2,
  '{"habitId":"resurrect-habit","enabled":false,"localTime":"08:30","timeZone":"UTC","weekdays":[2,4],"skipIfGoalComplete":false}', now()
);
do $$
begin
  if (select revision from public.habit_reminders where habit_id = 'resurrect-habit') <> 3
     or (select deleted_at from public.habit_reminders where habit_id = 'resurrect-habit') is not null
     or (select enabled from public.habit_reminders where habit_id = 'resurrect-habit') then
    raise exception 'active-habit reminder resurrection failed';
  end if;
end $$;

-- Another account cannot read or mutate Alice's reminder or attach one to her habit.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
begin
  if (select count(*) from public.habit_reminders) <> 0 then
    raise exception 'cross-account reminder read allowed';
  end if;
  begin
    perform public.apply_timehack_reminder_change(
      '40000000-0000-0000-0000-000000000006', 'reminder', 'legacy-habit', 'save', 4,
      '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'cross-account reminder update accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.apply_timehack_reminder_change(
      '40000000-0000-0000-0000-000000000007', 'reminder', 'legacy-habit', 'save', 0,
      '{"habitId":"legacy-habit","enabled":true,"localTime":"09:00","timeZone":"UTC","weekdays":[1],"skipIfGoalComplete":true}', now());
    raise exception 'cross-account habit reference accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;
