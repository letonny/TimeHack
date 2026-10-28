-- Milestone 4A. Reminder configuration only; delivery is intentionally deferred.
-- Local wall time and IANA zone are stored separately for DST-aware future jobs.

create table public.habit_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  enabled boolean not null default true,
  local_time time(0) without time zone not null,
  time_zone text not null check (length(time_zone) between 3 and 100),
  weekday_mask smallint not null check (weekday_mask between 1 and 127),
  skip_if_goal_complete boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, habit_id),
  foreign key (user_id, habit_id) references public.habits(user_id, id) on delete cascade
);
create index habit_reminders_delivery_lookup_idx
  on public.habit_reminders (time_zone, local_time)
  where enabled and deleted_at is null;
comment on column public.habit_reminders.local_time is
  'Wall-clock time. Future delivery uses the first occurrence when repeated and the first valid minute after a DST gap.';

alter table public.habit_reminders enable row level security;
revoke all on public.habit_reminders from public, anon;
grant select on public.habit_reminders to authenticated;
create policy habit_reminders_select on public.habit_reminders for select to authenticated
  using (user_id = (select auth.uid()));

-- Milestone 4B should read this view rather than habit_reminders directly. A
-- soft-deleted habit leaves its reminder revision/history intact, but can never
-- appear in the delivery candidate set.
create view public.habit_reminder_delivery_candidates as
  select r.user_id, r.habit_id, h.name as habit_name, h.goal_minutes,
    r.local_time, r.time_zone, r.weekday_mask, r.skip_if_goal_complete,
    r.revision, r.updated_at
  from public.habit_reminders r
  join public.habits h
    on h.user_id = r.user_id and h.id = r.habit_id
  where r.enabled and r.deleted_at is null and h.deleted_at is null;
revoke all on public.habit_reminder_delivery_candidates from public, anon, authenticated;
comment on view public.habit_reminder_delivery_candidates is
  'Milestone 4B delivery source. Excludes disabled/deleted reminders and soft-deleted habits.';

alter table public.activity_events drop constraint activity_events_entity_type_check;
alter table public.activity_events add constraint activity_events_entity_type_check
  check (entity_type in ('habit', 'session', 'activity', 'profile', 'reminder'));

create function public.apply_timehack_reminder_change(
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
  v_existing_deleted_at timestamptz;
  v_existing_event public.activity_events%rowtype;
  v_enabled boolean;
  v_local_time_text text;
  v_local_time time(0);
  v_time_zone text;
  v_weekday jsonb;
  v_weekday_numeric numeric;
  v_weekday_number integer;
  v_weekday_mask integer := 0;
  v_skip_if_goal_complete boolean;
begin
  if v_user is null
     or p_event_id is null
     or p_entity_type is distinct from 'reminder'
     or p_action is null
     or p_action not in ('save', 'delete')
     or p_entity_id is null
     or length(p_entity_id) not between 1 and 120
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or p_occurred_at is null
     or (p_action = 'delete' and p_expected_revision = 0) then
    raise exception 'invalid reminder command' using errcode = '22023';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':reminder:' || p_entity_id, 1)
  );
  select revision, deleted_at into v_existing_revision, v_existing_deleted_at
    from public.habit_reminders
    where user_id = v_user and habit_id = p_entity_id
    for update;

  if p_action = 'delete' then
    if v_existing_revision is null
       or v_existing_revision <> p_expected_revision
       or v_existing_deleted_at is not null then
      raise exception 'timehack revision conflict' using errcode = '40001';
    end if;
    update public.habit_reminders
      set deleted_at = now(), revision = revision + 1, updated_at = now()
      where user_id = v_user and habit_id = p_entity_id
        and revision = p_expected_revision and deleted_at is null
      returning revision into v_revision;
  else
    if p_payload->>'habitId' is distinct from p_entity_id
       or pg_catalog.jsonb_typeof(p_payload->'enabled') is distinct from 'boolean'
       or pg_catalog.jsonb_typeof(p_payload->'skipIfGoalComplete') is distinct from 'boolean'
       or pg_catalog.jsonb_typeof(p_payload->'weekdays') is distinct from 'array' then
      raise exception 'invalid reminder payload' using errcode = '22023';
    end if;

    v_enabled := (p_payload->>'enabled')::boolean;
    v_skip_if_goal_complete := (p_payload->>'skipIfGoalComplete')::boolean;
    v_local_time_text := p_payload->>'localTime';
    v_time_zone := p_payload->>'timeZone';
    if not exists (
      select 1 from public.habits
      where user_id = v_user and id = p_entity_id and deleted_at is null
    ) then
      raise exception 'reminders require an active owned habit' using errcode = '23503';
    end if;
    if v_local_time_text is null
       or v_local_time_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_time_zone is null
       or v_time_zone !~ '^(?:UTC|[A-Za-z_]+(?:[+-][A-Za-z0-9]+)?(?:/[A-Za-z0-9._+-]+)+)$'
       or not exists (
         select 1 from pg_catalog.pg_timezone_names where name = v_time_zone
       ) then
      raise exception 'invalid reminder time or time zone' using errcode = '22023';
    end if;
    v_local_time := v_local_time_text::time(0);

    for v_weekday in
      select value from pg_catalog.jsonb_array_elements(p_payload->'weekdays')
    loop
      if pg_catalog.jsonb_typeof(v_weekday) <> 'number' then
        raise exception 'invalid reminder weekdays' using errcode = '22023';
      end if;
      v_weekday_numeric := (v_weekday #>> '{}')::numeric;
      if v_weekday_numeric <> pg_catalog.trunc(v_weekday_numeric)
         or v_weekday_numeric not between 1 and 7 then
        raise exception 'invalid reminder weekdays' using errcode = '22023';
      end if;
      v_weekday_number := v_weekday_numeric::integer;
      if (v_weekday_mask & (1 << (v_weekday_number - 1))) <> 0 then
        raise exception 'duplicate reminder weekday' using errcode = '22023';
      end if;
      v_weekday_mask := v_weekday_mask | (1 << (v_weekday_number - 1));
    end loop;
    if v_weekday_mask = 0 then
      raise exception 'select at least one reminder weekday' using errcode = '22023';
    end if;

    if p_expected_revision = 0 then
      if v_existing_revision is not null then
        raise exception 'timehack revision conflict' using errcode = '40001';
      end if;
      insert into public.habit_reminders (
        user_id, habit_id, enabled, local_time, time_zone,
        weekday_mask, skip_if_goal_complete
      ) values (
        v_user, p_entity_id, v_enabled, v_local_time, v_time_zone,
        v_weekday_mask, v_skip_if_goal_complete
      )
      on conflict (user_id, habit_id) do nothing
      returning revision into v_revision;
    else
      if v_existing_revision is null or v_existing_revision <> p_expected_revision then
        raise exception 'timehack revision conflict' using errcode = '40001';
      end if;
      update public.habit_reminders
        set enabled = v_enabled, local_time = v_local_time,
          time_zone = v_time_zone, weekday_mask = v_weekday_mask,
          skip_if_goal_complete = v_skip_if_goal_complete,
          deleted_at = null, revision = revision + 1, updated_at = now()
        where user_id = v_user and habit_id = p_entity_id
          and revision = p_expected_revision
        returning revision into v_revision;
    end if;
  end if;

  if v_revision is null then
    raise exception 'timehack revision conflict' using errcode = '40001';
  end if;
  insert into public.activity_events (
    user_id, id, entity_type, entity_id, action, payload,
    expected_revision, result_revision, occurred_at
  ) values (
    v_user, p_event_id, 'reminder', p_entity_id, p_action, p_payload,
    p_expected_revision, v_revision, p_occurred_at
  );
  return v_revision;
end;
$$;

revoke all on function public.apply_timehack_reminder_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) from public, anon;
grant execute on function public.apply_timehack_reminder_change(
  uuid, text, text, text, bigint, jsonb, timestamptz
) to authenticated;
