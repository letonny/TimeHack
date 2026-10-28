# TimeHack

A productivity dashboard built with Next.js, TypeScript, Tailwind CSS, and Supabase. Track daily habits and activities with start, SET study/break transitions, pause/resume, and Finish controls. Review productive time and individual session segments across devices.

## Development

Use Node.js 22.18+ (native TypeScript stripping is used by tests).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Production: `npm run build`, then `npm start`.

## Supabase authentication

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using your Supabase project URL and publishable key. Do not use a service-role key. In Supabase Authentication, enable the Email provider and set the Site URL to `http://localhost:3000` for local development. Add `http://localhost:3000/auth/callback` to allowed redirect URLs. Add the corresponding deployed callback URL when deploying. If email confirmation is enabled, keep the confirmation email link directed to `{{ .ConfirmationURL }}` (the default) so Supabase redirects back with an auth code. A custom token-hash template can also point to `/auth/callback?token_hash={{ .TokenHash }}&type=signup`.

Visit `/signup` to create an account, confirm by email if required, then sign in at `/login`. The dashboard at `/` requires a verified session. Sign out from the dashboard header.

## Database migration and review

The Supabase CLI generated [the Milestone 3B SQL migration](supabase/migrations/20261028003144_milestone_3b_database.sql). It has **not** been applied to the hosted Supabase project. Review it before running any remote migration command. Once approved, link the correct project with `npx supabase link --project-ref YOUR_PROJECT_REF` and apply with `npx supabase db push`. Never put a service-role key in the browser. No additional dashboard table or policy setup is needed: the SQL creates the tables, RLS policies, grants, indexes, and write function. After applying it, verify in the Supabase dashboard that all four tables have RLS enabled. Existing Email authentication settings remain as described above.

The migration creates `habits` (daily targets), `activity_sessions` (active and completed timers), `session_segments` (ordered study/break intervals), and `activity_events` (raw, uniquely identified actions). Each row carries an account ID. Primary and foreign keys, unique active-session and habit-name indexes, timestamp checks, and RLS policies prevent cross-account access. `apply_timehack_change` applies one action and its event in a database transaction, rejects stale revisions, and returns the original result for a duplicate event ID.

The dashboard polls for cloud changes every eight seconds and refreshes on visibility. A per-account browser cache retains pending writes during a network failure and restores the timer on refresh. Failed writes can be retried; stale edits require an explicit choice, with a browser backup before loading the cloud version. The original `timehack.sessions.v1` data is never uploaded automatically. A signed-in user can review and confirm an import only into an empty cloud account. The browser records which account claimed that old data, and the old key is never deleted.

## Checks

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests cover SET transitions, study/break durations, pause/resume, local-day progress, goal validation, refresh recovery, database mapping, account cache isolation, pending event IDs, migration structure, and storage errors. `tests/sql/` contains executable PostgreSQL assertions for RLS, duplicate events, and stale writes; run `setup.sql`, the migration, then `assertions.sql` against a **fresh local test database** with `psql -v ON_ERROR_STOP=1 -f FILE`. Those scripts must not be run against the hosted project.

## Structure

- `app/`: route, document metadata, and global Tailwind styles.
- `components/`: dashboard, reusable overview cards, and session history.
- `hooks/use-timer.ts`: browser clock, account cache, cloud sync, import confirmation, and user actions.
- `lib/timer.ts`: pure session transitions and duration calculations.
- `lib/habits.ts`: habit validation, name matching, and daily goal calculations.
- `lib/storage.ts`: validation of the preserved pre-database browser data.
- `lib/cloud.ts` and `lib/cloud-repository.ts`: account-scoped cache, database mapping, and Supabase calls.
- `supabase/migrations/`: versioned database schema, grants, RLS, and transactional writes.
- `tests/`: Node test runner tests with an in-memory storage adapter.

Sessions contain timestamped study and break segments. SET closes the current segment and starts the opposite mode within the same session. Pause closes the current segment; resume opens another in the same mode. SET is disabled while paused. Finish saves the session even while paused or on break. Productive totals exclude breaks and pauses, include active sessions, and clip intervals at local midnight. Completed count uses each session's completion date.

Habits have unique names (ignoring case and surrounding spaces) and whole-minute daily goals from 1 to 1440. Use Track on a habit or enter its name in the timer to match it. Progress derives from matching activity records, including the active study segment; editing a goal recalculates progress immediately. Renaming a habit matches activities with the new name. Deleting a habit keeps its activity history; deleting an activity removes its contribution to progress. Goals reset at local midnight without deleting history. Progress is capped at 100%, while completed minutes may exceed the goal.

Schema version 2 reads Milestone 1 sessions as study segments during the optional browser import. The original `timehack.sessions.v1` key remains unchanged. Cloud account caches use separate keys per user. If storage is unavailable, the app shows an error rather than claiming a change was saved. Invalid old data is preserved and cannot be imported until repaired. Simultaneous edits to the same record on separate devices raise a conflict rather than silently overwriting one device's work.

## Manual acceptance check

1. Run `npm run dev`. On desktop and iPhone Safari (or 375px/390px mobile viewports), create Study with a 120-minute goal and Gym with a 60-minute goal. Edit a goal, refresh, and verify both persist. Try a duplicate name and an invalid goal.
2. Press Track on Study. Wait, press SET to start a break, wait, then press SET to resume studying. Repeat. Verify productive time and habit progress freeze during breaks. Expand Session segments to inspect each duration.
3. Pause during study, wait, refresh, and resume. Repeat during a break. Confirm SET is disabled while paused and resume keeps the previous mode. Paused time must never increase progress.
4. Refresh during running study and during a running break. Verify name, mode, segments, goals, and elapsed durations recover correctly. Switch tabs for a minute and return.
5. Finish while studying, while on break, and while paused in separate sessions. Expand each saved session's segments. Verify productive totals exclude breaks and pauses.
6. Start an activity named `study` to verify case-insensitive matching; start an unrelated activity to verify Study progress stays fixed. Check that a new local day starts progress at zero.
7. Rename and delete habits; verify session history remains. Delete a matching saved session, confirm the prompt, and refresh to verify progress and history update.
8. Use keyboard navigation and long habit/activity names. Check visible focus indicators, readable controls, and no horizontal overflow on mobile.

Notifications, analytics dashboards, and ML are outside this milestone.
