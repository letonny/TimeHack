# TimeHack

A local-first productivity dashboard built with Next.js, TypeScript, and Tailwind CSS. Track daily habits and activities with start, SET study/break transitions, pause/resume, and Finish controls. Review productive time and individual session segments.

## Development

Use Node.js 22.18+ (native TypeScript stripping is used by tests).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Production: `npm run build`, then `npm start`.

## Supabase authentication

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using your Supabase project URL and publishable key. Do not use a service-role key. In Supabase Authentication, enable the Email provider and set the Site URL to `http://localhost:3000` for local development. Add `http://localhost:3000/auth/callback` to allowed redirect URLs. Add the corresponding deployed callback URL when deploying. If email confirmation is enabled, keep the confirmation email link directed to `{{ .ConfirmationURL }}` (the default) so Supabase redirects back with an auth code. A custom token-hash template can also point to `/auth/callback?token_hash={{ .TokenHash }}&type=signup`.

Visit `/signup` to create an account, confirm by email if required, then sign in at `/login`. The dashboard at `/` requires a verified session. Sign out from the dashboard header. Habits and timer sessions remain in browser localStorage on this origin and are not tied to an account or synced to Supabase, so accounts sharing a browser profile see the same local data.

## Checks

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests cover SET transitions, study/break durations, pause/resume in either mode, overnight habit progress, goal edits and validation, refresh recovery, legacy migration, formatting, malformed data, and storage errors.

## Structure

- `app/`: route, document metadata, and global Tailwind styles.
- `components/`: dashboard, reusable overview cards, and session history.
- `hooks/use-timer.ts`: browser clock, storage initialization, and user actions.
- `lib/timer.ts`: pure session transitions and duration calculations.
- `lib/habits.ts`: habit validation, name matching, and daily goal calculations.
- `lib/storage.ts`: versioned localStorage serialization and validation.
- `tests/`: Node test runner tests with an in-memory storage adapter.

Sessions contain timestamped study and break segments. SET closes the current segment and starts the opposite mode within the same session. Pause closes the current segment; resume opens another in the same mode. SET is disabled while paused. Finish saves the session even while paused or on break. Productive totals exclude breaks and pauses, include active sessions, and clip intervals at local midnight. Completed count uses each session's completion date.

Habits have unique names (ignoring case and surrounding spaces) and whole-minute daily goals from 1 to 1440. Use Track on a habit or enter its name in the timer to match it. Progress derives from matching activity records, including the active study segment; editing a goal recalculates progress immediately. Renaming a habit matches activities with the new name. Deleting a habit keeps its activity history; deleting an activity removes its contribution to progress. Goals reset at local midnight without deleting history. Progress is capped at 100%, while completed minutes may exceed the goal.

Schema version 2 automatically reads Milestone 1 sessions as study segments and preserves them on the next save. The storage key remains unchanged for migration. Data is stored under `timehack.sessions.v1` in this browser, on this origin. Clearing browser data removes it; it does not sync between devices. Storage changes in other tabs are reflected automatically; simultaneous actions in multiple tabs are not transactional, so use one tab for timer controls. If storage is unavailable, the app shows an error rather than claiming a change was saved. Invalid data is preserved and tracking is disabled until it is repaired or cleared.

## Manual acceptance check

1. Run `npm run dev`. On desktop and iPhone Safari (or 375px/390px mobile viewports), create Study with a 120-minute goal and Gym with a 60-minute goal. Edit a goal, refresh, and verify both persist. Try a duplicate name and an invalid goal.
2. Press Track on Study. Wait, press SET to start a break, wait, then press SET to resume studying. Repeat. Verify productive time and habit progress freeze during breaks. Expand Session segments to inspect each duration.
3. Pause during study, wait, refresh, and resume. Repeat during a break. Confirm SET is disabled while paused and resume keeps the previous mode. Paused time must never increase progress.
4. Refresh during running study and during a running break. Verify name, mode, segments, goals, and elapsed durations recover correctly. Switch tabs for a minute and return.
5. Finish while studying, while on break, and while paused in separate sessions. Expand each saved session's segments. Verify productive totals exclude breaks and pauses.
6. Start an activity named `study` to verify case-insensitive matching; start an unrelated activity to verify Study progress stays fixed. Check that a new local day starts progress at zero.
7. Rename and delete habits; verify session history remains. Delete a matching saved session, confirm the prompt, and refresh to verify progress and history update.
8. Use keyboard navigation and long habit/activity names. Check visible focus indicators, readable controls, and no horizontal overflow on mobile.

No database persistence, reminders, or AI services are included in this milestone.
