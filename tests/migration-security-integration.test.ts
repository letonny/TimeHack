import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const binary = (name: string) => ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  .map(dir => join(dir, name)).find(existsSync);
const initdb = binary('initdb'), ctl = binary('pg_ctl'), psql = binary('psql');

test('hardening migrates a populated database with Supabase-style grants', {
  skip: !initdb || !ctl || !psql,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'timehack-hardening-'));
  const data = join(root, 'data'), socket = join(root, 'socket');
  mkdirSync(socket);
  const run = (bin: string, args: string[], input?: string) =>
    execFileSync(bin, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  let started = false;
  try {
    run(initdb!, ['-D', data, '-A', 'trust', '--no-instructions']);
    run(ctl!, ['-D', data, '-o', `-k ${socket} -p 5432 -c listen_addresses=''`, '-l', join(root, 'log'), '-w', 'start']);
    started = true;
    const args = ['-X', '-qAt', '-h', socket, '-p', '5432', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    const sql = (input: string) => run(psql!, args, input).trim();
    const file = (path: string) => run(psql!, [...args, '-f', path]);
    file('tests/sql/setup.sql');
    sql(`create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create function auth.role() returns text language sql stable as
        'select current_setting(''request.jwt.claim.role'', true)';`);

    const migrations = 'supabase/migrations/';
    const upgrade = '20261123000000_unify_change_replay_and_grants.sql';
    const revoke = migrations + '20261123000100_restrict_rls_auto_enable.sql';
    const files = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
    for (const name of files.filter(name => name < upgrade)) file(migrations + name);
    const owner = '00000000-0000-0000-0000-000000000001';
    const other = '00000000-0000-0000-0000-000000000002';
    const as = (uid: string, query: string) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${query}`);
    const change = (fn: string, event: number, type: string, id: string, action: string, rev: number, body: string) =>
      `select public.${fn}('10000000-0000-0000-0000-${String(event).padStart(12, '0')}',
        '${type}','${id}','${action}',${rev},${body},'2026-01-01Z')`;
    const base = 'apply_timehack_change', classified = 'apply_timehack_classified_change';
    const manual = `'{"entryType":"manual_duration","name":"Study","localDate":"2026-01-01","durationMilliseconds":60000}'::jsonb`;
    const pad = (body: string, bytes: number) =>
      `(${body} || jsonb_build_object('padding',repeat('x',${bytes}-octet_length((${body} || '{"padding":""}'::jsonb)::text))))`;
    const historical = change(base, 1, 'session', 'legacy', 'save', 0, pad(manual, 1048577));
    assert.equal(as(owner, historical), '1');
    for (const name of files.filter(name => name >= upgrade)) file(migrations + name);

    await t.test('ACL migration is repeatable with absent and present helper', () => {
      file(migrations + upgrade);
      file(revoke);
      sql(`create function public.rls_auto_enable() returns event_trigger language plpgsql as
        'begin return; end'; create event trigger fixture_auto_rls on ddl_command_end execute function public.rls_auto_enable();`);
      file(revoke);
      file(revoke);
      assert.equal(sql(`select evtenabled from pg_event_trigger where evtname='fixture_auto_rls'`), 'O');
      assert.equal(sql(`select has_function_privilege('service_role','public.rls_auto_enable()','execute')`), 't');
      assert.equal(sql(`select count(*) from pg_proc p, lateral aclexplode(p.proacl) a
        where p.oid='public.rls_auto_enable()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'`), '0');
      file('tests/sql/security-acls.sql');
    });

    await t.test('both populated owners independently replay identical IDs through either endpoint', () => {
      const activity = (name: string) => `'{"name":"${name}","icon":"circle","color":"#94a3b8","category":"Leisure","countsProductive":false}'::jsonb`;
      for (const [uid, name, first, second] of [[owner, 'Alice', base, classified], [other, 'Bob', classified, base]]) {
        for (const fn of [first, second]) {
          assert.equal(as(uid, change(fn, 2, 'activity', 'same', 'save', 0, activity(name))), '1');
        }
        assert.equal(as(uid, "select name||':'||category||':'||counts_productive from public.activities"), name + ':Leisure:false');
      }
      const snapshot = () => as(owner, `select md5(jsonb_build_array(
        (select jsonb_agg(to_jsonb(a) order by id) from public.activities a),
        (select jsonb_agg(to_jsonb(e) order by id) from public.activity_events e),
        (select jsonb_agg(to_jsonb(s) order by id) from public.activity_sessions s),
        (select jsonb_agg(to_jsonb(s) order by position) from public.session_segments s),
        (select jsonb_agg(to_jsonb(s) order by id) from public.session_sets s))::text)`);
      const timer = `'{"name":"Timer","startedAt":1000,"endedAt":2000,"segments":[{"kind":"study","startedAt":1000,"endedAt":2000}]}'::jsonb`;
      assert.equal(as(owner, change(base, 3, 'session', 'private', 'save', 0, timer)), '1');
      const before = snapshot();
      assert.equal(as(other, "select count(*) from public.activity_sessions where id='private'"), '0');
      assert.equal(as(other, "select count(*) from public.session_segments where session_id='private'"), '0');
      assert.equal(as(other, "select count(*) from public.activity_events where entity_id='private'"), '0');
      assert.throws(() => as(other, change(base, 3, 'session', 'private', 'save', 1, timer)), /revision conflict/);
      assert.throws(() => as(other, change(classified, 4, 'session', 'private', 'delete', 1, "'{}'")), /revision conflict/);
      assert.throws(() => as(other, change(base, 2, 'activity', 'same', 'save', 0, activity('Alice'))), /event id reused/);
      const child = `'{"id":"child","sessionId":"private","description":"work","segments":[{"startedAt":1000,"endedAt":2000}]}'`;
      assert.throws(() => as(other, change('apply_timehack_set_change', 5, 'set', 'child', 'save', 0, child)), /parent session unavailable/);
      assert.equal(as(other, change(base, 6, 'activity', 'same', 'delete', 1, "'{}'")), '2');
      // The delete was scoped to Bob despite the colliding keys.
      assert.equal(snapshot(), before);
      assert.equal(as(owner, change('apply_timehack_set_change', 5, 'set', 'child', 'save', 0, child)), '1');
      assert.equal(as(other, 'select count(*) from public.session_sets'), '0');
      assert.equal(as(other, 'select count(*) from public.session_set_events'), '0');
      // Now give Bob the same parent, child and event IDs. Their histories remain independent.
      const aliceWithChild = snapshot();
      assert.equal(as(other, change(classified, 3, 'session', 'private', 'save', 0, timer)), '1');
      assert.equal(as(other, change('apply_timehack_set_change', 5, 'set', 'child', 'save', 0, child)), '1');
      assert.equal(as(other, change('apply_timehack_set_change', 5, 'set', 'child', 'save', 0, child)), '1');
      assert.equal(as(other, "select count(*) from public.session_sets where session_id='private'"), '1');
      assert.equal(as(other, "select count(*) from public.session_set_events"), '1');
      assert.equal(snapshot(), aliceWithChild);

      const later = activity('Updated');
      assert.equal(as(owner, change(classified, 7, 'activity', 'same', 'save', 1, later)), '2');
      assert.throws(() => as(owner, change(base, 8, 'activity', 'same', 'save', 1, later)), /revision conflict/);
      const afterUpdate = snapshot();
      assert.equal(as(owner, change(classified, 2, 'activity', 'same', 'save', 0, activity('Alice'))), '1');
      assert.equal(snapshot(), afterUpdate);
    });

    await t.test('session limits accept boundaries, preserve historical retries and roll back rejected changes', () => {
      file('supabase/staged/20261123000200_bound_session_commands.sql');
      assert.equal(as(owner, historical.replace(base, classified)), '1');
      const timer = (count: number) => `jsonb_build_object('name','Intervals','startedAt',1,'endedAt',${count + 1},
        'segments',(select jsonb_agg(jsonb_build_object('kind','study','startedAt',n,'endedAt',n+1) order by n)
        from generate_series(1,${count}) n))`;
      assert.equal(as(owner, change(base, 10, 'session', 'limit', 'import', 0, timer(1000))), '1');
      assert.throws(() => as(owner, change(classified, 11, 'session', 'limit', 'save', 1, timer(1001))), /exceeds 1000 segments/);
      assert.equal(as(owner, "select count(*) from public.session_segments where session_id='limit'"), '1000');
      assert.equal(as(owner, change(classified, 12, 'session', 'bytes', 'save', 0, pad(manual, 1048576))), '1');
      assert.throws(() => as(owner, change(base, 13, 'session', 'bytes', 'save', 1, pad(manual, 1048577))), /exceeds 1 MiB/);
      assert.throws(() => as(owner, change(base, 14, 'session', 'limit', 'save', 1, `'{"name":"Intervals","startedAt":1,"endedAt":1001}'`)), /segments must be an array/);
      assert.equal(as(owner, "select count(*) from public.activity_events where entity_id in ('limit','bytes','legacy')"), '3');
      assert.equal(as(owner, "select revision from public.manual_duration_entries where id='bytes'"), '1');
    });
  } finally {
    if (started) run(ctl!, ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
  }
});
