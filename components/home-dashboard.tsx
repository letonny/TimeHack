'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { activityForName, iconGlyph, recentActivityNames } from '@/lib/activity-metadata';
import { buildDayTimeline, habitGoalProgress, localDayKey } from '@/lib/analytics';
import { firstNameFor, greetingFor } from '@/lib/personalization';
import { createClient } from '@/lib/supabase/client';
import { activeSet, duration, formatDuration, isRunning, setDuration, type Session, type TimerState } from '@/lib/timer';
import { TodayActivityRing } from './today-activity-ring';
import { HomeSummaryDial } from './home-summary-dial';

function compactTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function CurrentSession({ session, now, ready, onOpenTimer, onPause, onResume, onFinish, onNextSet, onEndSet }: { session: Session | null; now: number; ready: boolean; onOpenTimer: () => void; onPause: () => boolean; onResume: () => boolean; onFinish: () => boolean; onNextSet: () => boolean; onEndSet: () => boolean }) {
  const currentSet = session ? activeSet(session) : null;
  return <section aria-labelledby="current-session-title" className="th-card th-session-card overflow-hidden p-5 sm:p-7 lg:p-8">
    <div className="flex items-center justify-between gap-3"><h2 id="current-session-title" className="text-sm font-bold tracking-[.12em] text-[#bdced0]">CURRENT SESSION</h2><span className={`rounded-full px-4 py-2 text-xs font-bold tracking-wide ${session && isRunning(session) ? 'th-live-status bg-[#194b39] text-[#75ed9b]' : 'bg-[#303a3d] text-[#c3d0d0]'}`}>{session ? isRunning(session) ? '● LIVE' : 'PAUSED' : 'READY'}</span></div>
    <p className="mt-5 truncate text-2xl font-semibold xl:text-3xl">{session?.name ?? 'Ready to start'}</p>
    {!session && <p className="mt-2 text-sm text-[#a3b5b8]">Choose an activity and make today count.</p>}
    <p className="mt-5 text-center text-[clamp(2.5rem,5vw,4.7rem)] font-bold leading-none tracking-tight tabular-nums">{session ? formatDuration(duration(session, now)) : '00:00:00'}</p>
    {session ? <><div className="mt-6 grid grid-cols-2 gap-3"><button type="button" disabled={!ready} onClick={isRunning(session) ? onPause : onResume} className="rounded-2xl border border-white/15 bg-white/8 px-3 py-4 text-base font-semibold">{isRunning(session) ? 'Ⅱ Pause' : '▶ Resume'}</button><button type="button" disabled={!ready} onClick={onFinish} className="rounded-2xl bg-[#e4555b] px-3 py-4 text-base font-bold text-white">■ Finish</button></div><div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold tracking-wide text-[#a8b9bb]">CURRENT SET</p><p className="mt-1 truncate text-base font-semibold">{currentSet ? currentSet.description : 'No SET running'}</p></div><span className="font-mono text-lg font-semibold text-[#8dd2de] tabular-nums">{currentSet ? formatDuration(setDuration(currentSet, now)) : '00:00'}</span></div><div className="mt-3 flex items-center gap-3"><button type="button" disabled={!ready || !isRunning(session)} onClick={onNextSet} className="rounded-xl bg-[#27535a] px-4 py-3 text-sm font-bold text-[#d4f5f5]">{currentSet ? 'Next SET' : 'Start SET'}</button>{currentSet && <button type="button" disabled={!ready} onClick={onEndSet} className="rounded-xl border border-white/15 px-4 py-3 text-sm text-slate-200">End SET</button>}<button type="button" onClick={onOpenTimer} className="ml-auto text-sm text-[#91cfda]">Details →</button></div></div></> : <button type="button" onClick={onOpenTimer} className="mt-6 w-full rounded-2xl bg-[#82c9d3] px-4 py-4 text-base font-bold text-[#102026]">Start Timer →</button>}
  </section>;
}

export function HomeDashboard({ state, initialNow, ready, onOpenTimer, onOpenHistory, onOpenHabits, onStartActivity, onPause, onResume, onFinish, onNextSet, onEndSet }: {
  state: TimerState; initialNow: number; ready: boolean;
  onOpenTimer: () => void; onOpenHistory: () => void; onOpenHabits: () => void;
  onStartActivity: (name: string) => boolean;
  onPause: () => boolean; onResume: () => boolean; onFinish: () => boolean; onNextSet: () => boolean; onEndSet: () => boolean;
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

  return <div className="home-shell min-w-0 space-y-7 lg:space-y-8">
    <section aria-labelledby="home-heading" className="py-1">
      <p className="eyebrow">{shortDate}</p>
      <h1 id="home-heading" className="mt-3 text-[clamp(2.1rem,4vw,3.5rem)] font-bold leading-tight tracking-tight text-white">{greetingFor(now)}{firstName && <>, <span className="text-cyan-300">{firstName}</span></>}</h1>
      <p className="mt-2 text-base text-[#aab8bc]">Your day in motion</p>
    </section>

    <section aria-label="Today metrics" className="home-dial-row grid grid-cols-3 gap-3 sm:gap-5">
      <HomeSummaryDial label="Tracked" value={compactTime(timeline.trackedMilliseconds)} progress={timeline.trackedMilliseconds / timeline.dayMilliseconds} color="#85b9d5" caption="Today"/>
      <HomeSummaryDial label="Sessions" value={String(sessionsToday)} color="#c4cbd0" caption="Today"/>
      <button type="button" onClick={onOpenHabits} className="min-w-0 rounded-[1.6rem] text-left"><HomeSummaryDial label="Goals" value={`${goalsCompleted}/${state.habits.length}`} progress={state.habits.length ? goalsCompleted / state.habits.length : 0} color="#52e776" caption="Completed today"/></button>
    </section>

    <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:items-start xl:grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)] xl:gap-7">
      <TodayActivityRing state={state} now={now} onOpenTimer={onOpenTimer}/>
      <div className="min-w-0 space-y-5 lg:space-y-7"><CurrentSession session={state.active} now={now} ready={ready} onOpenTimer={onOpenTimer} onPause={onPause} onResume={onResume} onFinish={onFinish} onNextSet={onNextSet} onEndSet={onEndSet}/>
        <section aria-labelledby="quick-actions-title"><h2 id="quick-actions-title" className="mb-4 text-xl font-bold sm:text-2xl">Quick actions</h2><div className="grid grid-cols-3 gap-2"><button type="button" onClick={onOpenTimer} className="th-card th-quick-start min-w-0 px-4 py-5 text-left hover:border-cyan-400"><span aria-hidden="true" className="block text-2xl text-cyan-300">▶</span><span className="mt-4 block text-sm font-semibold">{state.active ? 'Open Timer' : 'Start Timer'}</span></button><button type="button" disabled={!!state.active} onClick={onOpenTimer} title={state.active ? "Finish the current session to log time manually" : "Open manual time logging"} className="th-card th-quick-log min-w-0 px-4 py-5 text-left hover:border-violet-400"><span aria-hidden="true" className="block text-2xl text-violet-300">＋</span><span className="mt-4 block text-sm font-semibold">Log Time</span></button>{quickNames.length ? <button type="button" disabled={!ready || !!state.active} onClick={() => startRecent(quickNames[0])} style={{ '--shortcut-color': activityForName(state, quickNames[0]).color } as CSSProperties} className="th-card th-activity-shortcut min-w-0 px-4 py-5 text-left hover:border-green-400"><span aria-hidden="true" className="block text-2xl text-green-300">{iconGlyph(activityForName(state, quickNames[0]).icon)}</span><span className="mt-4 block truncate text-sm font-semibold">{quickNames[0]}</span></button> : <button type="button" onClick={onOpenHistory} className="th-card min-w-0 px-4 py-5 text-left"><span aria-hidden="true" className="block text-2xl text-amber-300">◷</span><span className="mt-4 block text-sm font-semibold">History</span></button>}</div></section>
        <section aria-labelledby="habits-title" className="th-card th-habits-card p-5 sm:p-7"><div className="flex items-center justify-between"><h2 id="habits-title" className="text-xl font-bold">Today&apos;s habits</h2><button type="button" onClick={onOpenHabits} className="text-xs text-cyan-300">View all →</button></div>{state.habits.length ? <div className="mt-4 space-y-4">{state.habits.slice(0, 3).map((habit, index) => { const progress = habitGoalProgress(state, habit, now); const colors = ['#24c4ff', '#6df879', '#ae6aff']; return <div key={habit.id}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="truncate">{habit.name}</span><span className="shrink-0 text-[#94a9c4]">{Math.floor(progress.minutes)} / {habit.goalMinutes} min</span></div><div className="h-2 rounded-full bg-[#293c55]"><div className="h-full rounded-full" style={{ width: `${progress.visualPercentage}%`, backgroundColor: colors[index] }}/></div></div>; })}</div> : <button type="button" onClick={onOpenHabits} className="mt-4 text-sm text-[#94a9c4]">Set your first habit goal →</button>}</section>
      </div>
    </div>
    <section aria-labelledby="recent-title" className="th-card th-recent-card p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><h2 id="recent-title" className="text-xl font-bold">Recent activity</h2><button type="button" onClick={onOpenHistory} className="text-xs text-cyan-300">View history →</button></div>{state.completed.length ? <ul className="mt-3 space-y-3">{state.completed.slice(0, 2).map(session => <li key={session.id} className="flex justify-between gap-4 text-sm"><span className="truncate">{session.name}</span><span className="shrink-0 text-xs text-[#94a9c4]">{session.startedAt === null ? 'Duration only' : new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul> : <p className="mt-3 text-sm text-[#94a9c4]">Your completed activities will appear here.</p>}</section>
  </div>;
}
