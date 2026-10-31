import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binary = (name: string) => paths.map(path => join(path, name)).find(existsSync);
const initdb = binary('initdb'), pgCtl = binary('pg_ctl'), psql = binary('psql');

test('4.6 classifications and atomic interval corrections preserve ownership, history and revisions', { skip: !initdb || !pgCtl || !psql }, () => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-m46-'));
  const data = join(root, 'data'), socket = join(root, 'socket'), log = join(root, 'postgres.log');
  mkdirSync(socket);
  const port = String(61000 + process.pid % 4000);
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  try {
    run(initdb!, ['-D', data, '-A', 'trust', '--no-instructions']);
    run(pgCtl!, ['-D', data, '-o', `-k ${socket} -p ${port} -c listen_addresses=''`, '-l', log, '-w', 'start']);
    const base = ['-X', '-h', socket, '-p', port, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    run(psql!, [...base, '-c', 'create role service_role']);
    for (const file of ['tests/sql/setup.sql',
      'supabase/migrations/20261028003144_milestone_3b_database.sql',
      'supabase/migrations/20261028020000_milestone_3d_manual_time.sql',
      'supabase/migrations/20261028030000_milestone_4a_habit_reminders.sql']) run(psql!, [...base, '-f', file]);
    run(psql!, [...base, '-c', "create function auth.role() returns text language sql stable as 'select current_setting(''request.jwt.claim.role'', true)'"]);
    for (const file of ['supabase/migrations/20261029010000_milestone_4b_push.sql',
      'supabase/migrations/20261029020000_milestone_5a_session_sets.sql',
      'supabase/migrations/20261030010000_milestone_4_5_trip_mode.sql',
      'supabase/migrations/20261030020000_milestone_4_6_classification_and_corrections.sql']) run(psql!, [...base, '-f', file]);
    const query = (sql: string) => run(psql!, [...base, '-Atc', sql]).trim().split('\n').at(-1) ?? '';
    const reject = (sql: string, pattern: RegExp) => assert.throws(() => query(sql), cause => { assert.match(String(cause), pattern); return true; });
    const user = '00000000-0000-0000-0000-000000000001';
    const other = '00000000-0000-0000-0000-000000000002';
    const auth = (sql: string, uid = user) => `set role authenticated; set request.jwt.claim.sub='${uid}'; ${sql}`;
    const t = Date.parse('2026-10-29T10:00:00Z');
    assert.equal(query("select has_function_privilege('anon','public.correct_timehack_session_intervals(uuid,text,bigint,jsonb)','EXECUTE')"), 'f');
    assert.equal(query("select has_function_privilege('authenticated','public.correct_timehack_session_intervals(uuid,text,bigint,jsonb)','EXECUTE')"), 't');
    query(`insert into public.activities(user_id,id,name,icon,color) values('${user}','gaming','Gaming','circle','#94a3b8')`);
    const activity = { id: 'gaming', name: 'Gaming', icon: 'circle', color: '#94a3b8', category: 'Leisure', countsProductive: false };
    const activityCall = auth(`select public.apply_timehack_classified_change('20000000-0000-0000-0000-000000000001','activity','gaming','save',1,'${JSON.stringify(activity)}'::jsonb,now())`);
    // Idempotency uses identical occurred_at, so use a fixed instant.
    const activityFixed = activityCall.replace(',now())', ",'2026-10-29T10:00:00Z')");
    assert.equal(query(activityFixed), '2');
    assert.equal(query(activityFixed), '2');
    assert.equal(query("select category || ':' || counts_productive from public.activities where id='gaming'"), 'Leisure:false');
    query(`insert into public.activity_sessions(user_id,id,name,started_at,ended_at,entry_type) values('${user}','s1','Gym',to_timestamp(${t}/1000.0),to_timestamp(${t + 180000}/1000.0),'timer')`);
    query(`insert into public.session_segments(user_id,session_id,position,kind,started_at,ended_at) values
      ('${user}','s1',0,'study',to_timestamp(${t}/1000.0),to_timestamp(${t + 60000}/1000.0)),
      ('${user}','s1',1,'break',to_timestamp(${t + 60000}/1000.0),to_timestamp(${t + 120000}/1000.0)),
      ('${user}','s1',2,'study',to_timestamp(${t + 120000}/1000.0),to_timestamp(${t + 180000}/1000.0))`);
    assert.equal(query("select counts_productive from public.activity_sessions where id='s1'"), 't');
    query(`insert into public.session_sets(user_id,id,session_id,description,segments) values('${user}','set1','s1','Set','[{"startedAt":${t + 10000},"endedAt":${t + 50000}}]'::jsonb)`);
    const body = { segments: [
      { kind: 'study', startedAt: t - 10000, endedAt: t + 60000 },
      { kind: 'break', startedAt: t + 60000, endedAt: t + 120000 },
      { kind: 'study', startedAt: t + 120000, endedAt: t + 190000 },
    ], sets: [{ id: 'set1', expectedRevision: 1, segments: [{ startedAt: t + 5000, endedAt: t + 55000 }] }] };
    const correct = (event: string, revision: number, payload: object, uid = user) => auth(`select public.correct_timehack_session_intervals('${event}','s1',${revision},'${JSON.stringify(payload)}'::jsonb)`, uid);
    reject(correct('30000000-0000-0000-0000-000000000002', 1, { ...body, segments: [{ ...body.segments[0], kind: 'travel_out' }, ...body.segments.slice(1)] }), /invalid correction segment/);
    reject(correct('30000000-0000-0000-0000-000000000003', 1, { ...body, segments: [body.segments[0], { ...body.segments[1], startedAt: t + 50000 }, body.segments[2]] }), /invalid correction interval/);
    reject(correct('30000000-0000-0000-0000-000000000007', 1, { ...body, segments: [{ ...body.segments[0], startedAt: 'not-a-date' }, ...body.segments.slice(1)] }), /invalid correction segment/);
    reject(correct('30000000-0000-0000-0000-000000000008', 1, { ...body, sets: [{ ...body.sets[0], segments: [{ startedAt: t + 70000, endedAt: t + 90000 }] }] }), /SET must be inside an activity/);
    reject(correct('30000000-0000-0000-0000-000000000004', 1, body, other), /session unavailable/);
    const command = correct('30000000-0000-0000-0000-000000000001', 1, body);
    assert.equal(query(command), '2');
    assert.equal(query(command), '2');
    assert.equal(query("select revision from public.session_sets where id='set1'"), '2');
    assert.equal(query("select revision from public.activity_sessions where id='s1'"), '2');
    reject(correct('30000000-0000-0000-0000-000000000006', 2, { ...body, sets: [{ ...body.sets[0], expectedRevision: 2 }] }), /no interval changes/);
    reject(correct('30000000-0000-0000-0000-000000000005', 1, body), /revision conflict/);
    reject(correct('30000000-0000-0000-0000-000000000001', 1, { ...body, sets: [] }), /event id reused/);
    assert.equal(query("select count(*) from public.session_correction_events"), '1');
    const classifiedSession = { id: 's1', name: 'Gym', entryType: 'timer', startedAt: t - 10000, endedAt: t + 190000,
      activityId: null, note: '', countsProductive: false, segments: body.segments };
    const classify = auth(`select public.apply_timehack_classified_change('40000000-0000-0000-0000-000000000001','session','s1','save',2,'${JSON.stringify(classifiedSession)}'::jsonb,'2026-10-29T10:00:00Z')`);
    assert.equal(query(classify), '3');
    assert.equal(query(classify), '3');
    assert.equal(query("select counts_productive from public.activity_sessions where id='s1'"), 'f');
    assert.equal(query("select counts_productive from public.manual_duration_entries where id='missing'"), '');
    reject(auth("update public.activity_sessions set counts_productive=true where id='s1'"), /permission denied/);

    query(`begin; insert into public.activity_sessions(user_id,id,name,started_at,ended_at,entry_type,trip_phase)
      values('${user}','trip','Fishing',to_timestamp(${t}/1000.0),to_timestamp(${t + 180000}/1000.0),'timer','return');
      insert into public.session_segments(user_id,session_id,position,kind,started_at,ended_at) values
      ('${user}','trip',0,'travel_out',to_timestamp(${t}/1000.0),to_timestamp(${t + 60000}/1000.0)),
      ('${user}','trip',1,'study',to_timestamp(${t + 60000}/1000.0),to_timestamp(${t + 120000}/1000.0)),
      ('${user}','trip',2,'travel_return',to_timestamp(${t + 120000}/1000.0),to_timestamp(${t + 180000}/1000.0)); commit`);
    const tripBody = { segments: [
      { kind: 'travel_out', startedAt: t - 5000, endedAt: t + 60000 },
      { kind: 'study', startedAt: t + 60000, endedAt: t + 120000 },
      { kind: 'travel_return', startedAt: t + 120000, endedAt: t + 185000 },
    ], sets: [] };
    const tripCorrect = (id: string, payload: object) => auth(`select public.correct_timehack_session_intervals('${id}','trip',1,'${JSON.stringify(payload)}'::jsonb)`);
    reject(tripCorrect('50000000-0000-0000-0000-000000000002', { ...tripBody, segments: [tripBody.segments[0], { ...tripBody.segments[1], kind: 'travel_return' }, tripBody.segments[2]] }), /invalid correction segment/);
    assert.equal(query(tripCorrect('50000000-0000-0000-0000-000000000001', tripBody)), '2');
    assert.equal(query("select round(extract(epoch from ended_at-started_at)) from public.activity_sessions where id='trip'"), '190');
    reject(tripCorrect('50000000-0000-0000-0000-000000000003', tripBody), /revision conflict/);
  } finally {
    try { run(pgCtl!, ['-D', data, '-m', 'immediate', '-w', 'stop']); } catch { /* server may not have started */ }
    rmSync(root, { recursive: true, force: true });
  }
});
