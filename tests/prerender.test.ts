import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard authentication waits for a request before Supabase validates JWT time', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const authenticatedDashboard = source.match(/async function AuthenticatedDashboard\(\) \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(authenticatedDashboard, 'AuthenticatedDashboard must exist');
  assert.ok(
    authenticatedDashboard.indexOf('await connection()') < authenticatedDashboard.indexOf('await createClient()'),
    'connection() must run before Supabase Auth reads the current time',
  );
});
