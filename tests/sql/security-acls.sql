-- Use effective privileges (including PUBLIC and inherited grants).
do $check$
declare
  client text;
  relation record;
  privilege text;
  routine record;
  expected boolean;
  readable constant text[] := array[
    'activities','activity_events','activity_sessions','habits','habit_reminders',
    'manual_duration_entries','session_segments','session_sets','session_set_events',
    'session_correction_events','user_profiles'
  ];
  client_rpcs constant regprocedure[] := array[
    'public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)'::regprocedure,
    'public.apply_timehack_classified_change(uuid,text,text,text,bigint,jsonb,timestamptz)',
    'public.apply_timehack_reminder_change(uuid,text,text,text,bigint,jsonb,timestamptz)',
    'public.apply_timehack_set_change(uuid,text,text,text,bigint,jsonb,timestamptz)',
    'public.correct_timehack_timer_session(uuid,text,text,text,bigint,jsonb,timestamptz)',
    'public.correct_timehack_session_intervals(uuid,text,bigint,jsonb)',
    'public.save_timehack_push_subscription(text,text,text,text)',
    'public.disable_timehack_push_subscription(text)',
    'public.timehack_push_subscription_active(text)',
    'public.claim_timehack_push_test()'
  ];
begin
  foreach client in array array['anon','authenticated'] loop
    if has_schema_privilege(client,'timehack_private','usage') then
      raise exception '% can use the internal schema', client;
    end if;
    for relation in select oid, relname, relkind, relrowsecurity, relowner from pg_class
      where relnamespace='public'::regnamespace and relkind in ('r','v') loop
      if relation.relkind='r' and not relation.relrowsecurity then
        raise exception 'RLS disabled for %', relation.relname;
      end if;
      for privilege in select privilege_type from aclexplode(acldefault('r',relation.relowner)) loop
        expected := client='authenticated' and privilege='SELECT' and relation.relname=any(readable);
        if has_table_privilege(client,relation.oid,privilege) <> expected then
          raise exception 'unexpected % % on %', client, privilege, relation.relname;
        end if;
      end loop;
    end loop;
    for routine in select oid, prosecdef, proconfig from pg_proc
      where pronamespace in ('public'::regnamespace,'timehack_private'::regnamespace) loop
      expected := client='authenticated' and routine.oid=any(client_rpcs);
      if has_function_privilege(client,routine.oid,'execute') <> expected then
        raise exception 'unexpected % EXECUTE on %', client, routine.oid::regprocedure;
      end if;
      if expected and (not routine.prosecdef or not coalesce('search_path=""'=any(routine.proconfig),false)) then
        raise exception 'unexpected definer configuration for %', routine.oid::regprocedure;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role','public.habit_reminder_delivery_candidates','select')
    or not has_function_privilege('service_role','public.claim_timehack_push_delivery(uuid,text,date,timestamptz)','execute')
    or not has_function_privilege('service_role','public.timehack_habit_goal_complete(uuid,text,date,text)','execute') then
    raise exception 'worker privileges missing';
  end if;
end
$check$;
