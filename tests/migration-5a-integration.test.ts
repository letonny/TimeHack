import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync as runFile } from 'node:child_process';

const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binary = (name: string) => paths.map(path => join(path, name)).find(existsSync);
const initdb = binary('initdb'), pgCtl = binary('pg_ctl'), psql = binary('psql');

test('5A SET and correction RPCs enforce revisions, ownership and idempotency', { skip: !initdb || !pgCtl || !psql }, () => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-m5a-'));
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
    const query = (sql: string) => run(psql!, [...base, '-Atc', sql]).trim().split('\n').at(-1) ?? '';
    const rejectCode = (sql: string, code: string) => {
      assert.throws(() => run(psql!, [...base, '-v', 'VERBOSITY=verbose', '-Atc', sql]), cause => {
        assert.match(String(cause), new RegExp(`\\b${code}\\b`));
        return true;
      });
    };
    const user = '00000000-0000-0000-0000-000000000001';
    const other = '00000000-0000-0000-0000-000000000002';
    const start = Date.parse('2026-10-29T10:00:00Z'), end = start + 60_000;
    query(`insert into public.activity_sessions(user_id,id,name,started_at,ended_at,entry_type) values('${user}','s1','Gym',to_timestamp(${start}/1000.0),to_timestamp(${end}/1000.0),'timer')`);
    query(`insert into public.session_segments(user_id,session_id,position,kind,started_at,ended_at) values('${user}','s1',0,'study',to_timestamp(${start}/1000.0),to_timestamp(${end}/1000.0))`);
    const payload = JSON.stringify({ id: 'set-1', sessionId: 's1', description: 'Squats', segments: [{ startedAt: start + 10_000, endedAt: end - 10_000 }] });
    const event = '10000000-0000-0000-0000-000000000001';
    const command = `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('${event}','set','set-1','save',0,'${payload}'::jsonb,'2026-10-29T10:00:00Z')`;
    const setCall = (eventId: string, entityType: string, action: string, body: string) =>
      `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('${eventId}',${entityType},'bad-set',${action},0,${body},'2026-10-29T10:00:00Z')`;
    rejectCode(setCall('10000000-0000-0000-0000-000000000010', 'null::text', "'save'", `'${JSON.stringify({ ...JSON.parse(payload), id: 'bad-set' })}'::jsonb`), '22023');
    rejectCode(setCall('10000000-0000-0000-0000-000000000011', "'set'", 'null::text', `'${JSON.stringify({ ...JSON.parse(payload), id: 'bad-set' })}'::jsonb`), '22023');
    rejectCode(setCall('10000000-0000-0000-0000-000000000012', "'set'", "'save'", `'${JSON.stringify({ id: 'bad-set', sessionId: 's1', description: 'Bad' })}'::jsonb`), '22023');
    rejectCode(setCall('10000000-0000-0000-0000-000000000013', "'set'", "'save'", 'null::jsonb'), '22023');
    rejectCode(setCall('10000000-0000-0000-0000-000000000014', "'set'", "'save'", `'${JSON.stringify({ id: 'bad-set', sessionId: null, description: 'Bad', segments: [{ startedAt: start, endedAt: end }] })}'::jsonb`), '22023');
    rejectCode(setCall('10000000-0000-0000-0000-000000000015', "'set'", "'save'", `'${JSON.stringify({ id: 'bad-set', sessionId: 's1', description: 'Bad', segments: [{ startedAt: start }] })}'::jsonb`), '22023');
    assert.equal(query(command), '1');
    assert.equal(query(command), '1');
    assert.equal(query(`select count(*) from public.session_sets where user_id='${user}'`), '1');
    query(`insert into public.activity_sessions(user_id,id,name,started_at,entry_type) values('${user}','paused','Gym',to_timestamp(${start}/1000.0),'timer')`);
    query(`insert into public.session_segments(user_id,session_id,position,kind,started_at,ended_at) values('${user}','paused',0,'study',to_timestamp(${start}/1000.0),to_timestamp(${end}/1000.0))`);
    const openOnPaused = JSON.stringify({ id: 'set-paused', sessionId: 'paused', description: 'Invalid', segments: [{ startedAt: start + 10_000, endedAt: null }] });
    rejectCode(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000020','set','set-paused','save',0,'${openOnPaused}'::jsonb,'2026-10-29T10:00:00Z')`, '22023');
    const openOnFinished = JSON.stringify({ id: 'set-finished', sessionId: 's1', description: 'Invalid', segments: [{ startedAt: start + 10_000, endedAt: null }] });
    rejectCode(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000021','set','set-finished','save',0,'${openOnFinished}'::jsonb,'2026-10-29T10:00:00Z')`, '22023');
    query(`insert into public.session_segments(user_id,session_id,position,kind,started_at) values('${user}','paused',1,'study',to_timestamp(${end + 10_000}/1000.0))`);
    const activeSet = { id: 'set-active', sessionId: 'paused', description: 'Bench', segments: [{ startedAt: end + 20_000, endedAt: null }] };
    const activeSetCommand = `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000030','set','set-active','save',0,'${JSON.stringify(activeSet)}'::jsonb,'2026-10-29T10:00:00Z')`;
    assert.equal(query(activeSetCommand), '1');
    assert.equal(query(activeSetCommand), '1');
    rejectCode(`update public.session_segments set ended_at=to_timestamp(${end + 30_000}/1000.0) where session_id='paused' and position=1`, '22023');
    const closedSet = { ...activeSet, segments: [{ startedAt: end + 20_000, endedAt: end + 30_000 }] };
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000031','set','set-active','save',1,'${JSON.stringify(closedSet)}'::jsonb,'2026-10-29T10:00:00Z')`), '2');
    query(`update public.session_segments set ended_at=to_timestamp(${end + 30_000}/1000.0) where session_id='paused' and position=1`);
    query(`insert into public.session_segments(user_id,session_id,position,kind,started_at) values('${user}','paused',2,'study',to_timestamp(${end + 40_000}/1000.0))`);
    const finishSet = { id: 'set-finish', sessionId: 'paused', description: 'Finish', segments: [{ startedAt: end + 50_000, endedAt: null }] };
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000032','set','set-finish','save',0,'${JSON.stringify(finishSet)}'::jsonb,'2026-10-29T10:00:00Z')`), '1');
    rejectCode(`update public.activity_sessions set ended_at=to_timestamp(${end + 60_000}/1000.0) where id='paused'`, '22023');
    rejectCode("update public.activity_sessions set deleted_at=now() where id='paused'", '22023');
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000033','set','set-finish','save',1,'${JSON.stringify({ ...finishSet, segments: [{ startedAt: end + 50_000, endedAt: end + 60_000 }] })}'::jsonb,'2026-10-29T10:00:00Z')`), '2');
    query(`update public.session_segments set ended_at=to_timestamp(${end + 60_000}/1000.0) where session_id='paused' and position=2`);
    query(`update public.activity_sessions set ended_at=to_timestamp(${end + 60_000}/1000.0) where id='paused'`);
    const overlapPayload = JSON.stringify({ id: 'set-2', sessionId: 's1', description: 'Overlap', segments: [{ startedAt: start + 20_000, endedAt: end - 20_000 }] });
    assert.throws(() => query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000003','set','set-2','save',0,'${overlapPayload}'::jsonb,'2026-10-29T10:00:00Z')`));
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${other}'; select count(*) from public.session_sets`), '0');
    assert.throws(() => query(`set role authenticated; set request.jwt.claim.sub = '${other}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000002','set','set-x','save',0,'${JSON.stringify({ ...JSON.parse(payload), id: 'set-x' })}'::jsonb,'2026-10-29T10:00:00Z')`));
    const corrected = JSON.stringify({ id: 's1', entryType: 'timer', name: 'Gym', note: '', activityId: null, startedAt: start - 10_000, endedAt: end + 10_000, segments: [{ kind: 'study', startedAt: start - 10_000, endedAt: end + 10_000 }] });
    const correction = `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.correct_timehack_timer_session('20000000-0000-0000-0000-000000000001','session','s1','save',1,'${corrected}'::jsonb,'2026-10-29T10:00:00Z')`;
    const correctionCall = (eventId: string, entityType: string, action: string, body: object) =>
      `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.correct_timehack_timer_session('${eventId}',${entityType},'s1',${action},1,'${JSON.stringify(body)}'::jsonb,'2026-10-29T10:00:00Z')`;
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000010', 'null::text', "'save'", JSON.parse(corrected)), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000011', "'session'", 'null::text', JSON.parse(corrected)), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000012', "'session'", "'save'", { ...JSON.parse(corrected), endedAt: null, segments: [{ kind: 'study', startedAt: start - 10_000, endedAt: null }] }), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000013', "'session'", "'save'", { ...JSON.parse(corrected), endedAt: undefined }), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000014', "'session'", "'save'", { ...JSON.parse(corrected), startedAt: null }), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000015', "'session'", "'save'", { ...JSON.parse(corrected), segments: [{ kind: 'study', startedAt: start - 10_000 }] }), '22023');
    rejectCode(correctionCall('20000000-0000-0000-0000-000000000016', "'session'", "'save'", { ...JSON.parse(corrected), note: { private: 'bad' } }), '22023');
    assert.equal(query("select ended_at is not null from public.activity_sessions where id='s1'"), 't');
    assert.equal(query(correction), '2');
    assert.equal(query(correction), '2');
    const excludesSet = JSON.stringify({ ...JSON.parse(corrected), startedAt: start + 20_000, segments: [{ kind: 'study', startedAt: start + 20_000, endedAt: end + 10_000 }] });
    assert.throws(() => query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.correct_timehack_timer_session('20000000-0000-0000-0000-000000000003','session','s1','save',2,'${excludesSet}'::jsonb,'2026-10-29T10:00:00Z')`));
    assert.throws(() => query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.correct_timehack_timer_session('20000000-0000-0000-0000-000000000002','session','s1','save',1,'${corrected}'::jsonb,'2026-10-29T10:00:00Z')`));
    query("update public.activity_sessions set deleted_at = now() where id = 's1'");
    assert.equal(query(command), '1');
    rejectCode(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.apply_timehack_set_change('10000000-0000-0000-0000-000000000022','set','set-deleted','save',0,'${JSON.stringify({ ...JSON.parse(payload), id: 'set-deleted' })}'::jsonb,'2026-10-29T10:00:00Z')`, '23503');
    assert.equal(query("select count(*) from public.session_sets where session_id='s1'"), '1');
    assert.equal(query(`select count(*) from public.session_set_events`), '5');
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
