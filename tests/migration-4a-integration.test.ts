import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const binaries = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binary = (name: string) => binaries.map(directory => join(directory, name)).find(existsSync);
const initdb = binary('initdb'), pgCtl = binary('pg_ctl'), psql = binary('psql');

test('Milestone 4A applies after 3D and enforces reminder ownership and revisions', { skip: !initdb || !pgCtl || !psql }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-m4a-postgres-'));
  const data = join(root, 'data'), socket = join(root, 'socket'), log = join(root, 'postgres.log');
  const port = String(61000 + process.pid % 4000);
  mkdirSync(socket);
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  const runAsync = (command: string, args: string[]) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, LC_ALL: 'C' } });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
  });
  try {
    run(initdb!, ['-D', data, '-A', 'trust', '--no-instructions']);
    run(pgCtl!, ['-D', data, '-o', `-k ${socket} -p ${port} -c listen_addresses=''`, '-l', log, '-w', 'start']);
    const base = ['-X', '-h', socket, '-p', port, '-v', 'ON_ERROR_STOP=1'];
    run(psql!, [...base, '-d', 'postgres', '-c', 'create database timehack_m4a_test']);
    for (const file of [
      'tests/sql/setup.sql',
      'supabase/migrations/20261028003144_milestone_3b_database.sql',
      'tests/sql/milestone-3d-pre-upgrade.sql',
      'supabase/migrations/20261028020000_milestone_3d_manual_time.sql',
      'supabase/migrations/20261028030000_milestone_4a_habit_reminders.sql',
      'tests/sql/milestone-4a-assertions.sql',
    ]) run(psql!, [...base, '-d', 'timehack_m4a_test', '-f', file]);

    const update = (eventId: string, localTime: string) => `set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; select public.apply_timehack_reminder_change('${eventId}', 'reminder', 'legacy-habit', 'save', 4, '{"habitId":"legacy-habit","enabled":true,"localTime":"${localTime}","timeZone":"America/Chicago","weekdays":[1,2,3,4,5,6,7],"skipIfGoalComplete":true}', now());`;
    const results = await Promise.all([
      runAsync(psql!, [...base, '-d', 'timehack_m4a_test', '-c', update('40000000-0000-0000-0000-000000000008', '07:30')]),
      runAsync(psql!, [...base, '-d', 'timehack_m4a_test', '-c', update('40000000-0000-0000-0000-000000000009', '07:45')]),
    ]);
    assert.equal(results.filter(result => result.code === 0).length, 1, results.map(result => result.stderr).join('\n'));
    assert.equal(results.filter(result => result.stderr.includes('timehack revision conflict')).length, 1);
    const rows = run(psql!, [...base, '-d', 'timehack_m4a_test', '-Atc', "select count(*) || ':' || revision from public.habit_reminders where habit_id = 'legacy-habit' group by revision"]);
    assert.equal(rows.trim(), '1:5');
  } catch (cause) {
    const details = existsSync(log) ? readFileSync(log, 'utf8') : '';
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${details}`);
  } finally {
    if (existsSync(join(data, 'postmaster.pid'))) {
      try { run(pgCtl!, ['-D', data, '-m', 'fast', '-w', 'stop']); } catch { /* preserve original failure */ }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
