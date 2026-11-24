# TimeHack

**A full-stack productivity and time-tracking application built to help users understand where their time goes.**

TimeHack combines real-time activity tracking, customizable habits, detailed session breakdowns, and productivity analytics into a responsive dashboard.

Built with Next.js, TypeScript, Tailwind CSS, and Supabase, the application emphasizes accurate time accounting, user-specific data isolation, and reliable persistence.

**Status:** Active development — portfolio project

[Live Preview](https://timehack-eight.vercel.app) · [GitHub Repository](https://github.com/letonny/TimeHack)

---

## Features

### Real-Time Activity Tracking

- Start, pause, resume, and finish timestamp-based activity sessions.
- Create nested SET intervals to track individual work periods within a larger activity.
- Distinguish productive time, breaks, and paused intervals without double-counting.
- Automatically restore active sessions after page refreshes.
- View detailed session reports with chronological interval breakdowns.

### Habits and Daily Goals

- Create customizable activities and habits with daily time targets.
- Track goal completion using recorded activity sessions.
- Monitor daily progress, streaks, and activity history.
- Edit, rename, and organize habits without automatically deleting historical sessions.

### Productivity Dashboard and Analytics

- Explore daily timelines with a 24-hour activity visualization.
- Review productivity trends across 7-day, 30-day, 90-day, and custom date ranges.
- Compare productive time, leisure time, breaks, and tracked activities.
- Inspect individual sessions and nested SET breakdowns.
- Handle overnight sessions and daylight-saving-time transitions accurately.

### Trip Mode and Manual Tracking

- Track outbound travel, activity time, and return travel separately.
- Keep travel time distinct from productive activity totals.
- Create manual entries with exact timestamps or duration-only records.
- Correct completed session intervals while preserving validation and revision controls.

### Authentication and Cloud Persistence

- Email-based authentication through Supabase Auth.
- PostgreSQL storage with Row Level Security.
- Account-specific browser caching and pending-write recovery.
- Transactional, revision-controlled database operations.
- Idempotent event processing to prevent duplicate changes.
- Conflict detection for concurrent edits.
- Reminder scheduling and web-push infrastructure.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 16, React, TypeScript |
| Styling | Tailwind CSS |
| Authentication | Supabase Auth |
| Database | PostgreSQL / Supabase |
| Backend | Supabase RPCs, Edge Functions |
| Testing | Node.js Test Runner, PostgreSQL integration tests |
| Deployment | Vercel |
| Local persistence | Browser storage with account-specific caching |

---

## Getting Started

### Prerequisites

- Node.js 22.18 or later
- npm
- A Supabase project

### 1. Clone the Repository

```bash
git clone https://github.com/letonny/TimeHack.git
cd TimeHack
npm ci
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Use your project's URL and publishable key from Supabase.

**Never include a Supabase service-role key or other private credentials in client-side environment variables.**

### 3. Configure Supabase Authentication

In the Supabase Dashboard:

1. Enable the Email authentication provider.
2. Set the local development Site URL to `http://localhost:3000`.
3. Add `http://localhost:3000/auth/callback` to the allowed redirect URLs.
4. Configure the corresponding production callback URL when deploying.

Email confirmation can be enabled according to your project's authentication requirements.

### 4. Set Up the Database

Versioned SQL migrations are located in:

```text
supabase/migrations/
```

These migrations define the database schema, ownership policies, access grants, indexes, and transactional functions.

For a new Supabase project, review the migration history and verify the destination project before applying migrations through the Supabase CLI.

Do not run destructive migration or test scripts against a database containing real user data.

Reminder delivery and push notifications require additional deployment configuration for the relevant Edge Functions and server-side secrets.

### 5. Start the Development Server

```bash
npm run dev
```

Open `http://localhost:3000`.

Create an account through `/signup` or sign in through `/login`.

---

## Architecture and Engineering Decisions

### Event-Driven Persistence

TimeHack records activity changes using uniquely identified events.

Database operations use revision checks and transactional functions to protect against stale writes, duplicate submissions, and partially applied changes.

Exact retries can return previously recorded results without applying the same event twice.

### Account-Level Data Isolation

TimeHack uses Supabase authentication and PostgreSQL Row Level Security to restrict access to user-owned data.

Security measures include:

- Authenticated ownership policies.
- Account-scoped data queries.
- Restricted database function permissions.
- Explicit search paths for privileged functions.
- Validation of session ownership and revision history.

Privileged RPCs handle operations requiring transactional coordination. Their authorization behavior is covered by SQL integration tests, with additional cross-account security verification ongoing.

### Accurate Time Calculations

TimeHack uses recorded timestamps rather than relying exclusively on timer ticks.

Its calculations account for:

- Paused intervals and recorded breaks.
- Nested SETs and parent activity durations.
- Overlapping sessions.
- Sessions crossing local midnight.
- Daylight-saving-time changes.
- Manual records without exact timestamps.

These rules help prevent inaccurate totals across the dashboard, history, and analytics.

### Offline Resilience and Conflict Handling

The application maintains an account-specific browser cache and queues pending changes when cloud synchronization fails.

Revision checks help detect conflicting edits, allowing the application to surface conflicts rather than silently overwrite data.

Cross-device synchronization reliability remains under active investigation.

---

## Testing and Validation

Run the available project checks:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

The automated test suite covers timer transitions, session calculations, local-day boundaries, authentication validation, database migrations, account ownership, event replay, and synchronization recovery.

PostgreSQL integration tests also exercise RLS policies, revision conflicts, transaction behavior, and authorization rules.

**Database integration tests should run only against disposable local test environments—not the hosted production database.**

---

## Project Structure

```text
TimeHack/
├── app/                  # Next.js routes and layouts
├── components/           # Dashboard and UI components
├── hooks/                # Timer and application state
├── lib/                  # Business logic and persistence
├── supabase/
│   ├── migrations/       # PostgreSQL schema and RLS
│   └── functions/        # Supabase Edge Functions
├── tests/                # Unit and integration tests
└── package.json
```

---

## Current Status

TimeHack is an actively developed portfolio project.

Core features—including activity tracking, habits, analytics, manual records, and database persistence—have been implemented and covered by automated tests.

**Known limitations and ongoing work:**

- Cross-device synchronization can be inconsistent, particularly between the installed iOS PWA and desktop browser.
- Additional end-to-end authentication and cross-account authorization testing is planned.
- Security hardening and dependency maintenance are ongoing.
- Push-notification availability depends on the deployed environment and its configuration.

TimeHack is not yet presented as a fully audited production service.

---

## Project Goals

TimeHack is designed as both a practical productivity tool and an engineering project focused on full-stack application development.

Its technical priorities are accurate data modeling, secure account isolation, reliable event processing, synchronization integrity, and meaningful analytics.

---

## License

No open-source license has been specified. All rights are reserved unless a license is added to this repository.
