set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.apply_timehack_change(
  '10000000-0000-0000-0000-000000000001', 'habit', 'habit-1', 'save', 0,
  '{"name":"Study","goalMinutes":30}', now()
);
select public.apply_timehack_change(
  '10000000-0000-0000-0000-000000000002', 'session', 'session-1', 'save', 0,
  '{"name":"Study","startedAt":1000,"endedAt":null,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000},{"kind":"break","startedAt":2000,"endedAt":null}]}', now()
);
do $$
begin
  if (select count(*) from public.habits) <> 1 or (select count(*) from public.session_segments) <> 2 then
    raise exception 'alice rows missing';
  end if;
  if public.apply_timehack_change('10000000-0000-0000-0000-000000000001', 'habit', 'habit-1', 'save', 0, '{"name":"Study","goalMinutes":30}', now()) <> 1 then
    raise exception 'duplicate event was not idempotent';
  end if;
  begin
    perform public.apply_timehack_change('10000000-0000-0000-0000-000000000003', 'habit', 'habit-1', 'save', 0, '{"name":"Changed","goalMinutes":10}', now());
    raise exception 'stale write accepted';
  exception when serialization_failure then null;
  end;
end $$;
select public.apply_timehack_change(
  '10000000-0000-0000-0000-000000000004', 'session', 'session-1', 'save', 1,
  '{"name":"Study","startedAt":1000,"endedAt":4000,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000},{"kind":"break","startedAt":2000,"endedAt":3000},{"kind":"study","startedAt":3000,"endedAt":4000}]}', now()
);
select public.apply_timehack_change(
  '10000000-0000-0000-0000-000000000005', 'habit', 'habit-1', 'save', 1,
  '{"name":"Study","goalMinutes":40}', now()
);
do $$
begin
  if (select count(*) from public.session_segments where session_id = 'session-1') <> 3
     or (select goal_minutes from public.habits where id = 'habit-1') <> 40
     or (select revision from public.activity_sessions where id = 'session-1') <> 2 then
    raise exception 'transactional update or segment replacement failed';
  end if;
end $$;
select public.apply_timehack_change(
  '10000000-0000-0000-0000-000000000006', 'session', 'session-1', 'delete', 2,
  '{}', now()
);
do $$
begin
  if (select count(*) from public.activity_sessions where deleted_at is not null) <> 1
     or (select count(*) from public.activity_events) <> 5 then
    raise exception 'soft delete or event log failed';
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
begin
  if (select count(*) from public.habits) <> 0 or (select count(*) from public.activity_sessions) <> 0
     or (select count(*) from public.session_segments) <> 0 or (select count(*) from public.activity_events) <> 0 then
    raise exception 'cross-account read allowed';
  end if;
  begin
    insert into public.habits (user_id, id, name, goal_minutes)
      values ('00000000-0000-0000-0000-000000000001', 'foreign', 'Foreign', 10);
    raise exception 'cross-account insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
