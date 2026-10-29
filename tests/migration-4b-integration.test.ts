import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync as runFile } from 'node:child_process';

const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binary = (name: string) => paths.map(path => join(path, name)).find(existsSync);
const initdb = binary('initdb'), pgCtl = binary('pg_ctl'), psql = binary('psql');

test('4B migration protects subscriptions and serializes delivery claims', { skip: !initdb || !pgCtl || !psql }, () => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-m4b-'));
  const data = join(root, 'data'), socket = join(root, 'socket'), log = join(root, 'postgres.log');
  mkdirSync(socket);
  const port = String(62000 + process.pid % 3000);
  const run = (command: string, args: string[]) => runFile(command, args, { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
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
    run(psql!, [...base, '-f', 'supabase/migrations/20261029010000_milestone_4b_push.sql']);
    const query = (sql: string) => run(psql!, [...base, '-Atc', sql]).trim();
    const user = '00000000-0000-0000-0000-000000000001';
    const endpoint = 'https://fcm.googleapis.com/fcm/send/test-device-1';
    const add = `set role authenticated; set request.jwt.claim.sub = '${user}'; select public.save_timehack_push_subscription('${endpoint}', repeat('a', 65), repeat('b', 22), 'Test');`;
    query(add); query(add);
    assert.equal(query(`select count(*) from public.push_subscriptions where endpoint = '${endpoint}'`), '1');
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.timehack_push_subscription_active('${endpoint}')` ).split('\n').at(-1), 't');
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'; select public.timehack_push_subscription_active('${endpoint}')`).split('\n').at(-1), 'f');
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.claim_timehack_push_test()`).split('\n').at(-1), 't');
    assert.equal(query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.claim_timehack_push_test()`).split('\n').at(-1), 'f');
    const id = query(`select id from public.push_subscriptions where endpoint = '${endpoint}'`);
    const claim = `set role service_role; set request.jwt.claim.role = 'service_role'; select public.claim_timehack_push_delivery('${id}', 'h1', '2026-10-29', '2026-10-29T14:00:00Z')`;
    assert.match(query(claim).split('\n').at(-1) ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(query(claim).split('\n').at(-1), '');
    assert.equal(query('select count(*) from public.push_deliveries'), '1');
    query("update public.push_deliveries set state = 'failed', lease_until = now() - interval '1 second'");
    assert.match(query(claim).split('\n').at(-1) ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(query('select attempts from public.push_deliveries'), '2');
    query("update public.push_deliveries set state = 'sent', lease_until = now() - interval '1 second'");
    assert.equal(query(claim).split('\n').at(-1), '');
    query(`insert into public.habits (user_id,id,name,goal_minutes) values ('${user}','push-habit','Study',30)`);
    query(`insert into public.manual_duration_entries (user_id,id,name,local_date,duration_milliseconds) values ('${user}','push-log','Study','2026-10-29',1800000)`);
    const complete = `set role service_role; set request.jwt.claim.role = 'service_role'; select public.timehack_habit_goal_complete('${user}','push-habit','2026-10-29','America/Chicago')`;
    assert.equal(query(complete).split('\n').at(-1), 't');
    query(`insert into public.habit_reminders (user_id,habit_id,local_time,time_zone,weekday_mask) values ('${user}','push-habit','09:00','America/Chicago',127)`);
    assert.equal(query("select count(*) from public.habit_reminder_delivery_candidates where habit_id = 'push-habit'"), '1');
    query("update public.habits set deleted_at = now() where id = 'push-habit'");
    assert.equal(query("select count(*) from public.habit_reminder_delivery_candidates where habit_id = 'push-habit'"), '0');
    query(`set role authenticated; set request.jwt.claim.sub = '${user}'; select public.disable_timehack_push_subscription('${endpoint}')`);
    assert.equal(query(`select status from public.push_subscriptions where endpoint = '${endpoint}'`), 'disabled');
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
