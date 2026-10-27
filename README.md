# TimeHack

A local-first productivity dashboard built with Next.js, TypeScript, and Tailwind CSS. Track activities with start, pause/resume, and stop controls; review today's active time and completed session history.

## Development

Use Node.js 22.18+ (native TypeScript stripping is used by tests).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Production: `npm run build`, then `npm start`.

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests cover timestamp calculations, pause/resume segments, overnight totals, formatting, storage round trips, deletion persistence, malformed data, and storage errors.

## Structure

- `app/`: route, document metadata, and global Tailwind styles.
- `components/`: dashboard, reusable overview cards, and session history.
- `hooks/use-timer.ts`: browser clock, storage initialization, and user actions.
- `lib/timer.ts`: pure session transitions and duration calculations.
- `lib/storage.ts`: versioned localStorage serialization and validation.
- `tests/`: Node test runner tests with an in-memory storage adapter.

Sessions contain timestamped running segments. Pause closes a segment; resume opens another. This leaves an extension point for a future SET action that splits activity segments or records breaks. Today's tracked time includes active sessions and clips intervals at local midnight. Completed count uses each session's completion date. History includes all completed sessions.

Data is stored under `timehack.sessions.v1` in this browser, on this origin. Clearing browser data removes it; it does not sync between devices. Storage changes in other tabs are reflected automatically; simultaneous actions in multiple tabs are not transactional, so use one tab for timer controls. If storage is unavailable, the app shows an error rather than claiming a change was saved. Invalid data is preserved and tracking is disabled until it is repaired or cleared.

## Manual acceptance check

1. On desktop and a 390px-wide mobile viewport, enter an activity and start it.
2. Wait, pause, and confirm elapsed time stays fixed; refresh while paused.
3. Resume, switch to another tab for a minute, and return. Elapsed time should include the running time in the background.
4. Refresh while running. The active name, state, and elapsed time should recover.
5. Stop and save. Verify history, today's tracked time, and completed count; refresh again.
6. Delete the session, confirm the prompt, and refresh to verify deletion persists.
7. Navigate using the keyboard and check visible focus indicators. Try a long activity name and confirm the mobile layout stays within the viewport.

No authentication, database, reminders, or AI services are included in this milestone.
