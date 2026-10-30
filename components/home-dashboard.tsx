'use client';

import { useEffect, useState } from 'react';
import { activityForSession, iconGlyph, recentActivityNames } from '@/lib/activity-metadata';
import { buildDayTimeline, formatDashboardDate, habitGoalProgress, localDayKey } from '@/lib/analytics';
import { firstNameFor, greetingFor } from '@/lib/personalization';
import { createClient } from '@/lib/supabase/client';
import { activeSet, duration, formatDuration, isRunning, setDuration, type Session, type TimerState } from '@/lib/timer';
import { TodayActivityRing } from './today-activity-ring';

function CurrentSession({ state, session, now, onOpenTimer }: { state: TimerState; session: Session | null; now: number; onOpenTimer: () => void }) {
  const activity = session ? activityForSession(state, session) : null;
  const currentSet = session ? activeSet(session) : null;
  return <section aria-labelledby="current-session-title" className="rounded-[1.6rem] border border-white/10 bg-[#111f33] p-5 shadow-[0_24px_60px_rgba(0,0,0,.12)] sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">RIGHT NOW</p><h2 id="current-session-title" className="mt-2 text-lg font-semibold text-white">Current session</h2></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${session && isRunning(session) ? 'bg-teal-300/10 text-teal-200' : 'bg-white/5 text-slate-400'}`}>{session ? isRunning(session) ? '● Running' : 'Ⅱ Paused' : 'Ready'}</span></div>
    {session ? <><div className="mt-5 flex items-center gap-3"><span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg text-slate-950" style={{ backgroundColor: activity!.color }}>{iconGlyph(activity!.icon)}</span><div className="min-w-0"><p className="truncate text-base font-medium text-white">{session.name}</p><p className="text-xs text-slate-400">Main activity</p></div></div><p className="mt-5 font-mono text-[clamp(2rem,8vw,3rem)] leading-none tracking-tight tabular-nums text-white" aria-label={`${session.name} elapsed ${formatDuration(duration(session, now))}`}>{formatDuration(duration(session, now))}</p>{currentSet && <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-teal-300/15 bg-teal-300/5 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-teal-200">SET · {currentSet.description}</p><p className="text-xs text-slate-400">Nested stopwatch</p></div><span className="shrink-0 font-mono text-sm tabular-nums text-white">{formatDuration(setDuration(currentSet, now))}</span></div>}</> : <p className="mt-5 text-sm leading-relaxed text-slate-400">Start an activity to see its live timer and any active SET here.</p>}
    <button type="button" onClick={onOpenTimer} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200">{session ? 'Open timer' : 'Start an activity'} <span aria-hidden="true">↗</span></button>
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

  const date = formatDashboardDate(now);
  const firstName = firstNameFor(state.profile.displayName, { givenName: accountFirstName });
  const timeline = buildDayTimeline(state, now, undefined, { includeBreaks: true });
  const dayKey = localDayKey(now);
  const sessionsToday = new Set([
    ...timeline.slices.flatMap(slice => slice.sessionId ? [slice.sessionId] : []),
    ...state.completed.filter(session => session.entryType === 'manual_duration' && session.localDate === dayKey).map(session => session.id),
  ]).size;
  const goalsCompleted = state.habits.filter(habit => habitGoalProgress(state, habit, now).percentage >= 100).length;
  const recent = recentActivityNames(state, 4);
  const startRecent = (name: string) => { if (onStartActivity(name)) onOpenTimer(); };

  return <div className="space-y-5 sm:space-y-6">
    <section aria-labelledby="home-heading" className="relative overflow-hidden rounded-[1.7rem] border border-teal-300/10 bg-[radial-gradient(circle_at_50%_-30%,rgba(45,212,191,.16),transparent_65%),#111f33] px-5 py-8 text-center shadow-[0_24px_70px_rgba(0,0,0,.12)] sm:px-10 sm:py-10">
      <p className="text-lg font-medium text-slate-100 sm:text-xl">{greetingFor(now)}{firstName && <>, <span className="text-teal-300">{firstName}</span></>}</p>
      <p className="mt-5 text-[11px] font-bold tracking-[.26em] text-teal-300 uppercase sm:text-xs">{date.weekday}</p>
      <h1 id="home-heading" className="mt-2 text-[clamp(2rem,7vw,3.7rem)] font-semibold leading-tight tracking-tight text-white">{date.date}</h1>
    </section>

    <section aria-label="Today metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111f33] p-4 sm:p-5"><p className="text-xs text-slate-400">Tracked today</p><p className="mt-2 font-mono text-lg font-semibold tabular-nums text-white sm:text-3xl">{formatDuration(timeline.trackedMilliseconds)}</p></div>
      <div className="rounded-2xl border border-white/10 bg-[#111f33] p-4 sm:p-5"><p className="text-xs text-slate-400">Sessions</p><p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{sessionsToday}</p></div>
      <button type="button" onClick={onOpenHabits} className="col-span-2 rounded-2xl border border-white/10 bg-[#111f33] p-4 text-left hover:border-teal-300/30 hover:bg-[#16283d] sm:col-span-1 sm:p-5"><p className="text-xs text-slate-400">{state.habits.length ? 'Goals completed' : 'Daily goals'}</p>{state.habits.length ? <p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{goalsCompleted}<span className="ml-1 text-base font-normal text-slate-500">/ {state.habits.length}</span></p> : <p className="mt-2 text-sm font-medium text-teal-200">Set your first goal ↗</p>}</button>
    </section>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.8fr)] lg:items-start lg:gap-6">
      <TodayActivityRing state={state} now={now}/>
      <div className="space-y-5"><CurrentSession state={state} session={state.active} now={now} onOpenTimer={onOpenTimer}/>
        <section aria-labelledby="quick-actions-title" className="rounded-[1.6rem] border border-white/10 bg-[#111f33] p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">COMMAND CENTER</p><h2 id="quick-actions-title" className="mt-2 text-lg font-semibold text-white">Quick actions</h2></div><span aria-hidden="true" className="text-xl text-teal-300">↗</span></div>
          {!state.active && recent.length > 0 && <><p className="mt-4 text-xs text-slate-400">Start a recent activity</p><div className="mt-3 flex flex-wrap gap-2">{recent.map(name => <button key={name} type="button" disabled={!ready} onClick={() => startRecent(name)} className="rounded-full border border-teal-300/20 bg-teal-300/5 px-3.5 py-2 text-xs font-medium text-teal-100 hover:bg-teal-300/15">{name}</button>)}</div></>}
          {state.active && <p className="mt-4 text-sm text-slate-400">Your activity keeps running while you move between screens.</p>}
          <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={onOpenHistory} className="rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-200 hover:bg-white/5">View history</button><button type="button" onClick={onOpenHabits} className="rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-200 hover:bg-white/5">View habits</button></div>
        </section>
      </div>
    </div>
  </div>;
}
