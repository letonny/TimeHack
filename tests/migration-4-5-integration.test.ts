import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync as runFile } from 'node:child_process';
import { arrive, completeTrip, emptyState, finishActivity, finishWithoutReturnTrip, pause, resume, setSegment, start as startTimer, startReturnTrip, startSet, startTrip, startTripActivity, stop, type Session, type TimerState } from '../lib/timer.ts';

const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binary = (name: string) => paths.map(path => join(path, name)).find(existsSync);
const initdb = binary('initdb'), pgCtl = binary('pg_ctl'), psql = binary('psql');

test('Trip Mode migration replays universal phases and preserves activity time', { skip: !initdb || !pgCtl || !psql }, () => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-trip-'));
  const data = join(root, 'data'), socket = join(root, 'socket'), log = join(root, 'postgres.log');
  mkdirSync(socket);
  const port = String(61000 + process.pid % 4000);
  const run = (command: string, args: string[]) => runFile(command, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
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
      'supabase/migrations/20261029020000_milestone_5a_session_sets.sql']) run(psql!, [...base, '-f', file]);
    run(psql!, [...base, '-c', "insert into public.activity_sessions(user_id,id,name,started_at,ended_at,entry_type) values('00000000-0000-0000-0000-000000000001','historical','Library','2026-10-29T09:00:00Z','2026-10-29T09:10:00Z','timer')"]);
    run(psql!, [...base, '-c', "insert into public.session_segments(user_id,session_id,position,kind,started_at,ended_at) values('00000000-0000-0000-0000-000000000001','historical',0,'study','2026-10-29T09:00:00Z','2026-10-29T09:10:00Z')"]);
    run(psql!, [...base, '-f', 'supabase/migrations/20261030010000_milestone_4_5_trip_mode.sql']);
    const query = (sql: string) => run(psql!, [...base, '-Atc', sql]).trim().split('\n').at(-1) ?? '';
    const user = '00000000-0000-0000-0000-000000000001';
    const other = '00000000-0000-0000-0000-000000000002';
    const replay = (event: string, id: string, revision: number, session: Session, action = 'save', uid = user) =>
      query(`set role authenticated; set request.jwt.claim.sub = '${uid}'; select public.apply_timehack_change('${event}','session','${id}','${action}',${revision},'${JSON.stringify(session)}'::jsonb,'2026-10-29T10:00:00Z')`);
    const rejected = (runCommand: () => unknown, message: RegExp) => assert.throws(runCommand, cause => {
      assert.match(String(cause), message);
      return true;
    });
    assert.equal(query("select has_function_privilege('authenticated','public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)','EXECUTE')"), 't');
    assert.equal(query("select has_function_privilege('anon','public.apply_timehack_change(uuid,text,text,text,bigint,jsonb,timestamptz)','EXECUTE')"), 'f');
    rejected(() => query("set role anon; select public.apply_timehack_change('90000000-0000-0000-0000-000000000001','session','x','save',0,'{}'::jsonb,now())"), /permission denied/);
    const start = Date.parse('2026-10-29T10:00:00Z');
    const historicalStart = Date.parse('2026-10-29T09:00:00Z');
    assert.equal(replay('20000000-0000-0000-0000-000000000001', 'historical', 1, {
      id: 'historical', entryType: 'timer', name: 'Library', startedAt: historicalStart,
      endedAt: historicalStart + 600_000, note: 'Kept after migration',
      segments: [{ kind: 'study', startedAt: historicalStart, endedAt: historicalStart + 600_000 }],
    }), '2');
    let state: TimerState = startTrip(emptyState(), 'Library', start, 'trip', null, 'Main branch', 'Office');
    const phases = [state.active!];
    state = arrive(state, start + 10_000); phases.push(state.active!);
    state = startTripActivity(state, start + 20_000); phases.push(state.active!);
    state = finishActivity(state, start + 50_000); phases.push(state.active!);
    state = startReturnTrip(state, start + 60_000); phases.push(state.active!);
    state = completeTrip(state, start + 80_000); phases.push(state.completed[0]);
    phases.forEach((session, index) => {
      const event = `30000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
      const command = `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_change('${event}','session','trip','save',${index},'${JSON.stringify(session)}'::jsonb,'2026-10-29T10:00:00Z')`;
      assert.equal(query(command), String(index + 1));
      assert.equal(query(command), String(index + 1));
    });
    assert.equal(query("select trip_phase || ':' || destination || ':' || return_destination from public.activity_sessions where id='trip'"), 'return:Main branch:Office');
    assert.equal(query("select string_agg(kind, ',' order by position) from public.session_segments where session_id='trip'"), 'travel_out,study,travel_return');
    assert.equal(query("select sum(extract(epoch from ended_at-started_at)) from public.session_segments where session_id='trip' and kind='study'"), '30.000000');
    assert.equal(replay('30000000-0000-0000-0000-000000000007', 'trip', 6,
      { ...state.completed[0], note: 'Updated after completion' }), '7');
    assert.equal(query("select note from public.activity_sessions where id='trip'"), 'Updated after completion');
    let noReturn = startTrip(emptyState(), 'School', start + 100_000, 'no-return');
    const noReturnPhases = [noReturn.active!];
    noReturn = arrive(noReturn, start + 110_000); noReturnPhases.push(noReturn.active!);
    noReturn = startTripActivity(noReturn, start + 120_000); noReturnPhases.push(noReturn.active!);
    noReturn = finishActivity(noReturn, start + 150_000); noReturnPhases.push(noReturn.active!);
    noReturn = finishWithoutReturnTrip(noReturn, start + 160_000); noReturnPhases.push(noReturn.completed[0]);
    noReturnPhases.forEach((session, index) => {
      const event = `40000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
      assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_change('${event}','session','no-return','save',${index},'${JSON.stringify(session)}'::jsonb,'2026-10-29T10:00:00Z')`), String(index + 1));
    });
    assert.equal(query("select string_agg(kind, ',' order by position) from public.session_segments where session_id='no-return'"), 'travel_out,study');
    const ordinary = stop(startTimer(emptyState(), 'Work', start + 200_000, 'ordinary'), start + 210_000).completed[0];
    assert.equal(replay('50000000-0000-0000-0000-000000000001', 'ordinary', 0, ordinary), '1');
    assert.equal(query("select trip_phase is null from public.activity_sessions where id='ordinary'"), 't');
    assert.equal(replay('50000000-0000-0000-0000-000000000006', 'ordinary', 1,
      { ...ordinary, note: 'Legacy timer metadata update' }), '2');
    rejected(() => replay('50000000-0000-0000-0000-000000000002', 'bad-normal-out', 0,
      { ...ordinary, id: 'bad-normal-out', segments: [{ ...ordinary.segments[0], kind: 'travel_out' }] }), /travel requires Trip Mode/);
    rejected(() => replay('50000000-0000-0000-0000-000000000003', 'bad-normal-return', 0,
      { ...ordinary, id: 'bad-normal-return', segments: [{ ...ordinary.segments[0], endedAt: start + 205_000 }, { kind: 'travel_return', startedAt: start + 205_000, endedAt: start + 210_000 }] }), /travel requires Trip Mode/);
    rejected(() => replay('50000000-0000-0000-0000-000000000004', 'ordinary', 2,
      { ...ordinary, tripPhase: 'activity', destination: 'Office' }), /invalid trip metadata/);
    rejected(() => replay('50000000-0000-0000-0000-000000000005', 'ordinary', 2,
      { ...ordinary, segments: [{ ...ordinary.segments[0], kind: 'travel_return' }] }), /travel requires Trip Mode/);
    rejected(() => replay('50000000-0000-0000-0000-000000000007', 'ordinary', 2,
      { ...ordinary, tripPhase: 'activity_finished', segments: [
        { kind: 'travel_out', startedAt: start + 200_000, endedAt: start + 205_000 },
        { kind: 'study', startedAt: start + 205_000, endedAt: start + 210_000 },
      ] }), /invalid trip phase transition/);
    rejected(() => query(`set role authenticated; set request.jwt.claim.sub = '${user}'; update public.session_segments set kind='travel_return' where session_id='ordinary'`), /permission denied/);
    rejected(() => query("update public.session_segments set kind='travel_return' where session_id='ordinary'"), /travel requires Trip Mode/);
    rejected(() => query("update public.activity_sessions set trip_phase='return' where id='ordinary'"), /invalid trip segment order/);
    assert.equal(query("select revision from public.activity_sessions where id='ordinary'"), '2');

    const malformed = startTrip(emptyState(), 'Studying', start + 220_000, 'malformed').active!;
    rejected(() => replay('60000000-0000-0000-0000-000000000001', 'bad-arrived', 0,
      { ...malformed, id: 'bad-arrived', tripPhase: 'arrived' }, 'import'), /trip phase does not match segments/);
    rejected(() => replay('60000000-0000-0000-0000-000000000002', 'bad-return', 0,
      { ...malformed, id: 'bad-return', tripPhase: 'return', segments: [
        { kind: 'travel_out', startedAt: start + 220_000, endedAt: start + 230_000 },
        { kind: 'travel_return', startedAt: start + 230_000, endedAt: null },
      ] }, 'import'), /return before activity/);
    rejected(() => replay('60000000-0000-0000-0000-000000000003', 'bad-order', 0,
      { ...malformed, id: 'bad-order', tripPhase: 'return', segments: [
        { kind: 'travel_out', startedAt: start + 220_000, endedAt: start + 230_000 },
        { kind: 'study', startedAt: start + 230_000, endedAt: start + 240_000 },
        { kind: 'travel_return', startedAt: start + 240_000, endedAt: start + 250_000 },
        { kind: 'study', startedAt: start + 250_000, endedAt: null },
      ] }, 'import'), /activity after return travel/);
    rejected(() => replay('60000000-0000-0000-0000-000000000004', 'bad-break', 0,
      { ...malformed, id: 'bad-break', tripPhase: 'activity', segments: [
        { kind: 'travel_out', startedAt: start + 220_000, endedAt: start + 230_000 },
        { kind: 'break', startedAt: start + 230_000, endedAt: null },
      ] }, 'import'), /break outside activity/);
    rejected(() => replay('60000000-0000-0000-0000-000000000005', 'bad-create', 0,
      { ...malformed, id: 'bad-create', tripPhase: 'arrived', segments: [{ ...malformed.segments[0], endedAt: start + 230_000 }] }), /trip must start outbound/);
    rejected(() => replay('60000000-0000-0000-0000-000000000017', 'bad-overlap', 0,
      { ...malformed, id: 'bad-overlap', tripPhase: 'activity_finished', endedAt: start + 250_000, segments: [
        { kind: 'travel_out', startedAt: start + 220_000, endedAt: start + 240_000 },
        { kind: 'study', startedAt: start + 230_000, endedAt: start + 250_000 },
      ] }, 'import'), /invalid segment order/);
    assert.equal(query("select count(*) from public.activity_sessions where id like 'bad-%'"), '0');

    assert.equal(replay('60000000-0000-0000-0000-000000000006', 'malformed', 0, malformed), '1');
    const arrived = arrive({ ...emptyState(), active: malformed }, start + 230_000).active!;
    const skipped = startTripActivity({ ...emptyState(), active: arrived }, start + 240_000).active!;
    rejected(() => replay('60000000-0000-0000-0000-000000000007', 'malformed', 1, skipped), /invalid trip phase transition/);
    assert.equal(replay('60000000-0000-0000-0000-000000000008', 'malformed', 1, arrived), '2');
    const activity = startTripActivity({ ...emptyState(), active: arrived }, start + 240_000).active!;
    assert.equal(replay('60000000-0000-0000-0000-000000000009', 'malformed', 2, activity), '3');
    const finished = finishActivity({ ...emptyState(), active: activity }, start + 250_000).active!;
    const returned = startReturnTrip({ ...emptyState(), active: finished }, start + 260_000).active!;
    rejected(() => replay('60000000-0000-0000-0000-000000000010', 'malformed', 3, returned), /invalid trip phase transition/);
    assert.equal(query("select revision from public.activity_sessions where id='malformed'"), '3');
    assert.equal(replay('60000000-0000-0000-0000-000000000011', 'malformed', 3, finished), '4');
    assert.equal(replay('60000000-0000-0000-0000-000000000012', 'malformed', 4, returned), '5');
    const completedGuard = completeTrip({ ...emptyState(), active: returned }, start + 270_000).completed[0];
    assert.equal(replay('60000000-0000-0000-0000-000000000013', 'malformed', 5, completedGuard), '6');
    rejected(() => replay('60000000-0000-0000-0000-000000000014', 'malformed', 6,
      { ...completedGuard, tripPhase: 'activity_finished' }), /trip phase does not match segments/);
    rejected(() => replay('60000000-0000-0000-0000-000000000015', 'malformed', 6,
      { ...completedGuard, segments: completedGuard.segments.map(part => part.kind === 'travel_return' ? { ...part, kind: 'study' } : part) }), /trip phase does not match segments/);
    rejected(() => replay('60000000-0000-0000-0000-000000000016', 'malformed', 6, completedGuard, 'save', other), /timehack revision conflict/);
    assert.equal(query("select revision from public.activity_sessions where id='malformed'"), '6');

    // Pause/resume in travel and activity, legacy study/break transitions, and
    // one nested SET all replay under the existing revision and SET RPC rules.
    const routineStart = start + 300_000;
    let routine = startTrip(emptyState(), 'Pickleball', routineStart, 'routine');
    let routineRevision = 0;
    let eventNumber = 1;
    const saveRoutine = () => {
      const event = `70000000-0000-0000-0000-${String(eventNumber++).padStart(12, '0')}`;
      routineRevision++;
      assert.equal(replay(event, 'routine', routineRevision - 1, routine.active ?? routine.completed[0]), String(routineRevision));
    };
    saveRoutine();
    routine = pause(routine, routineStart + 10_000); saveRoutine();
    routine = resume(routine, routineStart + 20_000); saveRoutine();
    routine = arrive(routine, routineStart + 30_000); saveRoutine();
    routine = startTripActivity(routine, routineStart + 40_000); saveRoutine();
    routine = setSegment(routine, routineStart + 50_000); saveRoutine();
    routine = pause(routine, routineStart + 55_000); saveRoutine();
    routine = resume(routine, routineStart + 60_000); saveRoutine();
    routine = startSet(routine, routineStart + 65_000, 'routine-set', 'Drills');
    saveRoutine();
    const openSet = routine.active!.sets![0];
    const setCall = (event: string, revision: number, payload: object) =>
      query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('${event}','set','routine-set','save',${revision},'${JSON.stringify(payload)}'::jsonb,'2026-10-29T10:00:00Z')`);
    assert.equal(setCall('80000000-0000-0000-0000-000000000001', 0, openSet), '1');
    routine = setSegment(routine, routineStart + 75_000);
    assert.equal(setCall('80000000-0000-0000-0000-000000000002', 1, routine.active!.sets![0]), '2');
    saveRoutine();
    routine = finishActivity(routine, routineStart + 80_000); saveRoutine();
    routine = startReturnTrip(routine, routineStart + 90_000); saveRoutine();
    routine = pause(routine, routineStart + 100_000); saveRoutine();
    routine = resume(routine, routineStart + 110_000); saveRoutine();
    routine = completeTrip(routine, routineStart + 120_000); saveRoutine();
    assert.equal(query("select string_agg(kind, ',' order by position) from public.session_segments where session_id='routine'"), 'travel_out,travel_out,study,break,break,study,break,travel_return,travel_return');
    assert.equal(query("select count(*) from public.session_sets where session_id='routine' and deleted_at is null"), '1');

    // The replacement RPC still handles every non-trip entity and manual shape.
    const ordinaryCall = (event: string, type: string, id: string, revision: number, payload: object) =>
      query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_change('${event}','${type}','${id}','save',${revision},'${JSON.stringify(payload)}'::jsonb,'2026-10-29T10:00:00Z')`);
    assert.equal(ordinaryCall('90000000-0000-0000-0000-000000000002', 'habit', 'h1', 0, { id: 'h1', name: 'Library', goalMinutes: 45 }), '1');
    assert.equal(ordinaryCall('90000000-0000-0000-0000-000000000003', 'activity', 'a1', 0, { id: 'a1', name: 'Custom errand', icon: 'circle', color: '#2dd4bf' }), '1');
    assert.equal(ordinaryCall('90000000-0000-0000-0000-000000000004', 'profile', user, 0, { displayName: 'Alex' }), '1');
    assert.equal(ordinaryCall('90000000-0000-0000-0000-000000000005', 'session', 'manual-range', 0, {
      id: 'manual-range', entryType: 'manual_range', name: 'School', startedAt: start + 500_000, endedAt: start + 560_000,
      segments: [{ kind: 'study', startedAt: start + 500_000, endedAt: start + 560_000 }],
    }), '1');
    assert.equal(ordinaryCall('90000000-0000-0000-0000-000000000006', 'session', 'manual-duration', 0, {
      id: 'manual-duration', entryType: 'manual_duration', name: 'Work', localDate: '2026-10-29',
      durationMilliseconds: 60_000, segments: [],
    }), '1');
    rejected(() => ordinaryCall('90000000-0000-0000-0000-000000000007', 'session', 'bad-duration', 0, {
      id: 'bad-duration', entryType: 'manual_duration', name: 'Work', localDate: '2026-10-29',
      durationMilliseconds: 60_000, segments: [], tripPhase: 'outbound',
    }), /invalid trip metadata/);
  } catch (cause) {
    const details = existsSync(log) ? readFileSync(log, 'utf8') : '';
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${details}`);
  } finally {
    if (existsSync(join(data, 'postmaster.pid'))) {
      try { run(pgCtl!, ['-D', data, '-m', 'fast', '-w', 'stop']); } catch { /* preserve failure */ }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
