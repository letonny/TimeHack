'use client';

import { useEffect, useState } from 'react';
import { activityForName, iconGlyph, recentActivityNames } from '@/lib/activity-metadata';
import { buildDayTimeline, habitGoalProgress, localDayKey } from '@/lib/analytics';
import { firstNameFor, greetingFor } from '@/lib/personalization';
import { createClient } from '@/lib/supabase/client';
import { activeSet, duration, formatDuration, isRunning, setDuration, type Session, type TimerState } from '@/lib/timer';
import { TodayActivityRing } from './today-activity-ring';

function compactTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function CurrentSession({ session, now, onOpenTimer }: { session: Session | null; now: number; onOpenTimer: () => void }) {
  const currentSet = session ? activeSet(session) : null;
  return <section aria-labelledby="current-session-title" className="th-card p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h2 id="current-session-title" className="text-[11px] font-semibold tracking-wide text-[#94a9c4]">CURRENT SESSION</h2><span className={`rounded-xl px-3 py-1 text-xs font-semibold ${session && isRunning(session) ? 'bg-[#174a48] text-[#2dd4c6]' : 'bg-[#293c55] text-[#94a9c4]'}`}>{session ? isRunning(session) ? '● LIVE' : 'PAUSED' : 'READY'}</span></div>
    <p className="mt-2 truncate text-2xl font-semibold">{session?.name ?? 'Ready to start'}</p>
    <p className="mt-2 text-3xl font-semibold tabular-nums">{session ? formatDuration(duration(session, now)) : '00:00:00'}</p>
    {currentSet && <p className="mt-3 truncate text-xs text-[#2dd4c6]">SET · {currentSet.description} &nbsp; {formatDuration(setDuration(currentSet, now))}</p>}
    <button type="button" onClick={onOpenTimer} className="mt-3 text-xs text-[#2dd4c6]">{session ? 'Open timer' : 'Start an activity'} →</button>
  </section>;
}

export function HomeDashboard({ state, initialNow, ready, onOpenTimer, onOpenHistory, onOpenHabits, onStartActivity }: {
  state: TimerState; initialNow: number; ready: boolean;
  onOpenTimer: () => void; onOpenHistory: () => void; onOpenHabits: () => void;
  onStartActivity: (name: string) => boolean;
}) {
  const [now, setNow] = useState(initialNow);
  const [accountFirstName, setAccountFirstName] = useState<string | null>(null);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    let mounted = true;
    const client = createClient();
    const nameForUser = (user: { email?: string | null; user_metadata?: Record<string, unknown> } | null) => user
      ? firstNameFor('', { givenName: user.user_metadata?.given_name, fullName: user.user_metadata?.full_name ?? user.user_metadata?.name, email: user.email }) : null;
    void client.auth.getUser().then(({ data }) => { if (mounted) setAccountFirstName(nameForUser(data.user)); }).catch(() => {
      if (mounted) setAccountFirstName(null);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (mounted) setAccountFirstName(nameForUser(session?.user ?? null));
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const shortDate = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const firstName = firstNameFor(state.profile.displayName, { givenName: accountFirstName });
  const timeline = buildDayTimeline(state, now, undefined, { includeBreaks: true });
  const dayKey = localDayKey(now);
  const sessionsToday = new Set([
    ...timeline.slices.flatMap(slice => slice.sessionId ? [slice.sessionId] : []),
    ...state.completed.filter(session => session.entryType === 'manual_duration' && session.localDate === dayKey).map(session => session.id),
  ]).size;
  const goalsCompleted = state.habits.filter(habit => habitGoalProgress(state, habit, now).percentage >= 100).length;
  const recent = recentActivityNames(state, 4);
  const quickNames = [...new Set([...recent, ...state.activities.map(activity => activity.name)])].slice(0, 2);
  const startRecent = (name: string) => { if (onStartActivity(name)) onOpenTimer(); };

  return <div className="space-y-5 sm:space-y-6">
    <section aria-labelledby="home-heading" className="py-1">
      <p className="eyebrow">{shortDate}</p>
      <h1 id="home-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{greetingFor(now)}{firstName && <>, <span className="text-teal-300">{firstName}</span></>}</h1>
      <p className="mt-1 text-sm text-[#94a9c4]">Your daily command center</p>
    </section>

    <section aria-label="Today metrics" className="grid grid-cols-3 gap-2 sm:gap-4">
      <div className="th-card flex min-w-0 items-center gap-2 px-2 py-4 sm:gap-3 sm:px-4 sm:py-5"><span className="h-9 w-1 shrink-0 rounded-full bg-[#2dd4c6]"/><div className="min-w-0"><p className="truncate text-[clamp(.8rem,3.5vw,1.8rem)] font-semibold tabular-nums" title={formatDuration(timeline.trackedMilliseconds)}>{compactTime(timeline.trackedMilliseconds)}</p><p className="mt-1 text-[10px] text-[#94a9c4] sm:text-xs">Time tracked</p></div></div>
      <div className="th-card flex min-w-0 items-center gap-2 px-2 py-4 sm:gap-3 sm:px-4 sm:py-5"><span className="h-9 w-1 shrink-0 rounded-full bg-[#ac91fa]"/><div><p className="text-[clamp(1.2rem,3.5vw,1.8rem)] font-semibold">{sessionsToday}</p><p className="mt-1 text-[10px] text-[#94a9c4] sm:text-xs">Sessions</p></div></div>
      <button type="button" onClick={onOpenHabits} className="th-card flex min-w-0 items-center gap-2 px-2 py-4 text-left hover:border-[#ffd06d] sm:gap-3 sm:px-4 sm:py-5"><span className="h-9 w-1 shrink-0 rounded-full bg-[#ffd06d]"/><span className="min-w-0"><span className="block whitespace-nowrap text-[clamp(1rem,3.5vw,1.8rem)] font-semibold">{goalsCompleted} / {state.habits.length}</span><span className="mt-1 block text-[10px] text-[#94a9c4] sm:text-xs">Goals</span></span></button>
    </section>

    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.42fr)_minmax(0,1fr)] lg:items-stretch">
      <TodayActivityRing state={state} now={now}/>
      <div className="min-w-0 space-y-5"><CurrentSession session={state.active} now={now} onOpenTimer={onOpenTimer}/>
        <section aria-labelledby="quick-actions-title"><h2 id="quick-actions-title" className="mb-3 text-lg font-semibold">Quick start</h2><div className="grid grid-cols-3 gap-2">{quickNames.map(name => <button key={name} type="button" disabled={!ready || !!state.active} onClick={() => startRecent(name)} className="th-card min-w-0 px-3 py-4 text-left hover:border-[#2dd4c6]"><span aria-hidden="true" className="block text-xl text-[#2dd4c6]">{iconGlyph(activityForName(state, name).icon)}</span><span className="mt-3 block truncate text-xs font-semibold">{name}</span></button>)}<button type="button" onClick={onOpenTimer} className="th-card min-w-0 px-3 py-4 text-left hover:border-[#2dd4c6]"><span aria-hidden="true" className="block text-xl text-[#2dd4c6]">＋</span><span className="mt-3 block text-xs font-semibold">Custom</span></button></div></section>
        <section aria-labelledby="habits-title" className="th-card hidden p-5 lg:block"><div className="flex items-center justify-between"><h2 id="habits-title" className="font-semibold">Today&apos;s habits</h2><button type="button" onClick={onOpenHabits} className="text-xs text-[#2dd4c6]">View all →</button></div>{state.habits.length ? <div className="mt-4 space-y-4">{state.habits.slice(0, 3).map(habit => { const progress = habitGoalProgress(state, habit, now); return <div key={habit.id}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="truncate">{habit.name}</span><span className="shrink-0 text-[#94a9c4]">{Math.floor(progress.minutes)} / {habit.goalMinutes} min</span></div><div className="h-2 rounded-full bg-[#293c55]"><div className="h-full rounded-full bg-[#2dd4c6]" style={{ width: `${progress.visualPercentage}%` }}/></div></div>; })}</div> : <button type="button" onClick={onOpenHabits} className="mt-4 text-sm text-[#94a9c4]">Set your first habit goal →</button>}</section>
      </div>
    </div>
    <section aria-labelledby="recent-title" className="th-card hidden px-5 py-4 lg:block"><div className="flex items-center justify-between gap-3"><h2 id="recent-title" className="font-semibold">Recent activity</h2><button type="button" onClick={onOpenHistory} className="text-xs text-[#2dd4c6]">View history →</button></div>{state.completed.length ? <ul className="mt-3 space-y-3">{state.completed.slice(0, 2).map(session => <li key={session.id} className="flex justify-between gap-4 text-sm"><span className="truncate">{session.name}</span><span className="shrink-0 text-xs text-[#94a9c4]">{session.startedAt === null ? 'Duration only' : new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul> : <p className="mt-3 text-sm text-[#94a9c4]">Your completed activities will appear here.</p>}</section>
  </div>;
}
