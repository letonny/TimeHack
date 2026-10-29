-- Additive push infrastructure. No existing reminder or activity rows are changed.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (length(p256dh) between 40 and 256),
  auth_key text not null check (length(auth_key) between 16 and 256),
  device_label text not null default '' check (length(device_label) <= 80),
  status text not null default 'active' check (status in ('active', 'disabled', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error_code integer
);
create index push_subscriptions_active_idx on public.push_subscriptions (user_id) where status = 'active';
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;

-- Browser calls only these functions; encryption keys are never returned.
create function public.save_timehack_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid;
begin
  if v_user is null or p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) not between 20 and 2048
     or p_p256dh is null or length(p_p256dh) not between 40 and 256
     or p_auth is null or length(p_auth) not between 16 and 256
     or length(coalesce(p_label, '')) > 80 then
    raise exception 'invalid push subscription' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_endpoint, 7));
  select user_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
  if v_owner is not null and v_owner <> v_user then
    raise exception 'subscription belongs to another account' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, device_label)
    values (v_user, p_endpoint, p_p256dh, p_auth, coalesce(p_label, ''))
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth_key = excluded.auth_key,
      device_label = excluded.device_label, status = 'active', updated_at = now(), last_error_code = null;
end $$;
create function public.disable_timehack_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  update public.push_subscriptions set status = 'disabled', updated_at = now()
    where user_id = auth.uid() and endpoint = p_endpoint;
end $$;
create function public.timehack_push_subscription_active(p_endpoint text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.push_subscriptions
    where user_id = auth.uid() and endpoint = p_endpoint and status = 'active');
$$;
revoke all on function public.save_timehack_push_subscription(text,text,text,text),
  public.disable_timehack_push_subscription(text), public.timehack_push_subscription_active(text) from public, anon;
grant execute on function public.save_timehack_push_subscription(text,text,text,text),
  public.disable_timehack_push_subscription(text), public.timehack_push_subscription_active(text) to authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  habit_id text not null,
  local_date date not null,
  occurrence_at timestamptz not null,
  kind text not null default 'scheduled' check (kind in ('scheduled', 'test')),
  state text not null default 'claimed' check (state in ('claimed', 'sent', 'failed', 'expired')),
  claim_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default (now() + interval '2 minutes'),
  attempts integer not null default 1 check (attempts between 1 and 3),
  http_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, habit_id, local_date, kind)
);
create index push_deliveries_retry_idx on public.push_deliveries (lease_until) where state in ('claimed','failed');
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;
grant all on public.push_deliveries to service_role;

-- Atomic claim handles concurrent workers. A timed-out send may have reached the
-- push service; retrying can produce a duplicate, but never two simultaneous sends.
create function public.claim_timehack_push_delivery(p_subscription_id uuid, p_habit_id text,
  p_local_date date, p_occurrence_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  insert into public.push_deliveries (user_id, subscription_id, habit_id, local_date, occurrence_at)
    select user_id, id, p_habit_id, p_local_date, p_occurrence_at
    from public.push_subscriptions where id = p_subscription_id and status = 'active'
    on conflict (subscription_id, habit_id, local_date, kind) do update
      set claim_token = gen_random_uuid(), lease_until = now() + interval '2 minutes',
          attempts = public.push_deliveries.attempts + 1, state = 'claimed', updated_at = now()
      where public.push_deliveries.state in ('claimed', 'failed')
        and public.push_deliveries.lease_until < now() and public.push_deliveries.attempts < 3
    returning claim_token into v_token;
  return v_token;
end $$;
revoke all on function public.claim_timehack_push_delivery(uuid,text,date,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_timehack_push_delivery(uuid,text,date,timestamptz) to service_role;

create table public.push_test_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_requested_at timestamptz not null
);
alter table public.push_test_limits enable row level security;
revoke all on public.push_test_limits from public, anon, authenticated;
grant all on public.push_test_limits to service_role;
create function public.claim_timehack_push_test()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_allowed boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.push_test_limits (user_id, last_requested_at) values (auth.uid(), now())
    on conflict (user_id) do update set last_requested_at = now()
      where public.push_test_limits.last_requested_at < now() - interval '60 seconds'
    returning true into v_allowed;
  return coalesce(v_allowed, false);
end $$;
revoke all on function public.claim_timehack_push_test() from public, anon;
grant execute on function public.claim_timehack_push_test() to authenticated;

-- The 4A view excludes disabled/deleted reminders and soft-deleted habits.
grant select on public.habit_reminder_delivery_candidates to service_role;

create function public.timehack_habit_goal_complete(p_user_id uuid, p_habit_id text, p_local_date date, p_time_zone text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_goal integer; v_name text; v_start timestamptz; v_end timestamptz; v_milliseconds numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select name, goal_minutes into v_name, v_goal from public.habits
    where user_id = p_user_id and id = p_habit_id and deleted_at is null;
  if v_goal is null then return false; end if;
  v_start := p_local_date::timestamp at time zone p_time_zone;
  v_end := (p_local_date + 1)::timestamp at time zone p_time_zone;
  with ranges as (
    select pg_catalog.tstzrange(greatest(s.started_at, v_start), least(coalesce(s.ended_at, now()), v_end), '[)') as span
    from public.activity_sessions a join public.session_segments s
      on s.user_id = a.user_id and s.session_id = a.id
    where a.user_id = p_user_id and a.deleted_at is null and lower(a.name) = lower(v_name)
      and s.kind = 'study' and s.started_at < v_end and coalesce(s.ended_at, now()) > v_start
    union all
    select pg_catalog.tstzrange(v_start, v_start, '[)') where false
  ), merged as (select pg_catalog.range_agg(span) as spans from ranges),
  total as (select coalesce(sum(extract(epoch from upper(span) - lower(span)) * 1000), 0) as ms
    from merged, pg_catalog.unnest(spans) span)
  select (select ms from total) + coalesce((select sum(duration_milliseconds)
    from public.manual_duration_entries where user_id = p_user_id and deleted_at is null
      and lower(name) = lower(v_name) and local_date = p_local_date), 0) into v_milliseconds;
  return v_milliseconds >= v_goal * 60000;
end $$;
revoke all on function public.timehack_habit_goal_complete(uuid,text,date,text) from public, anon, authenticated;
grant execute on function public.timehack_habit_goal_complete(uuid,text,date,text) to service_role;
