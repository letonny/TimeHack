set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000001', 'habit', 'legacy-habit', 'save', 0,
  '{"id":"legacy-habit","name":"Study","goalMinutes":30}', '2026-10-28T10:00:00Z'
);
select public.apply_timehack_change(
  '30000000-0000-0000-0000-000000000002', 'session', 'legacy-session', 'save', 0,
  '{"id":"legacy-session","name":"Study","startedAt":1000,"endedAt":4000,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000},{"kind":"break","startedAt":2000,"endedAt":3000},{"kind":"study","startedAt":3000,"endedAt":4000}]}',
  '2026-10-28T10:01:00Z'
);
