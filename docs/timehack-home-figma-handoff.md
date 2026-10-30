# TimeHack — Home Dashboard Visual Handoff

Figma file: https://www.figma.com/design/nK6DhtsgscRKDtaV3CrdeF

- Mobile frame (390 px): https://www.figma.com/design/nK6DhtsgscRKDtaV3CrdeF?node-id=1-84
- Desktop frame (1440 px): https://www.figma.com/design/nK6DhtsgscRKDtaV3CrdeF?node-id=1-2
- Implementation specification: https://www.figma.com/design/nK6DhtsgscRKDtaV3CrdeF?node-id=1-143

## Important precedence

The original Figma frame is a layout reference, NOT the final exact styling for two elements. Apply these newer user-requested overrides even if the Figma screen disagrees:

1. Greeting: remove the waving-hand emoji, show a local-time-dependent 'Good morning/afternoon/evening, FirstName' and style ONLY the signed-in user's first name in turquoise. Prefer existing account profile display name, falling back safely where it is absent. Never hard-code Tonny.
2. 24-hour ring: replace visually chunky/oversized wedge arcs with smooth, consistently thin concentric-track-aligned arcs. Each arc must have the same stroke width as the base track, centered along the same circular radius so no color protrudes from the track. Use subtle gaps without shifting timing or distorting duration. Rounded caps are acceptable where they don't cause short segments to overlap.

## Mobile layout — 390 px baseline

- Dark navy full-screen canvas; restrained turquoise accent; readable off-white text.
- Compact date and personalized greeting at the top.
- Three compact summary cards: actual tracked time, session count, completed habit goals / total goals.
- One prominent but proportionate 24-hour activity ring card with total tracked time and legend; don't let it dominate the entire screen.
- Current session card: true activity name, live primary elapsed duration, and active nested SET description/time if present.
- Quick start shortcuts tied to existing activity creation flow, not mock interactions.
- Persistent bottom tabs: Home, Timer, History, Habits, Settings, with iPhone safe-area padding.
- Responsiveness must avoid overflow, text clipping, and accidental double-tap actions.

## Desktop layout — 1440 px baseline

- Dark left sidebar with the same five destinations and sync status.
- Greeting/date and summary metrics near top.
- Two-column command center: 24-hour ring on left, current-session and quick-start cards on right.
- Habits summary and recent activity are visible without excessive empty vertical space.
- Max-width content region, consistent spacing, a balanced visual hierarchy.

## Existing application behavior that MUST remain

- Next.js/React/Tailwind app; keep existing Supabase Auth and user/account data flow.
- Existing timestamp-based parent session timer and nested SET stopwatch; SET advances inside parent time and is never added to totals twice.
- Correct day-boundary logic for 24-hour ring, including paused/break exclusions, midnight and time zones.
- Offline event queue, replay idempotency, revision conflict checks, cloud sync state, and per-account data isolation.
- Session history editing, previous-day manual logging, SET descriptions, habits, reminders, push notifications and PWA service worker.
- Five-screen navigation and timer persistence when switching screens.
- One intentional tap for Start/SET/Pause/Resume/Finish and ordinary saves; guard rapid duplicate taps.

## Acceptance criteria

- No greeting emoji; first name only colored turquoise and taken from real profile.
- Consistent smooth arc thickness and correct time-of-day angular mapping; no chunky wedges.
- No hard-coded sample activity/goal/session numbers from Figma.
- Active Gym + Squats SET both advance, but ring and habits count tracked parent time once.
- One tap finishes a session on iPhone; saved history survives refresh and sync.
- Mobile 390 px and desktop 1440 px compare well visually with the provided frame exports.
- Existing tests/lint/TypeScript/build pass; any unrelated modified files, especially hooks/use-timer.ts, are reviewed but not overwritten or committed blindly.

## Recommended Codex workflow

1. Read the three screenshots exported from Figma and this document.
2. Compare implemented Home screenshot at mobile and desktop widths with references; list layout discrepancies.
3. Apply minimal presentational edits (avoid timer/storage/backend changes).
4. Re-run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`.
5. Report changed files, a precise visual difference list, and iPhone manual test results still outstanding.
6. Do not commit, push, deploy or migrate automatically.
