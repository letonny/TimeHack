'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { activityForName, activityForSession, iconGlyph, recentActivityNames } from '@/lib/activity-metadata';
import { activityNames, addLocalDays, buildDayTimeline, localDayKey, localDayStart } from '@/lib/analytics';
import { firstNameFor, greetingFor } from '@/lib/personalization';
import { dayActivityBuckets, habitPeriodProgress, periodDayKeys, periodSummary, productiveTrend, shiftPeriod, type AnalyticsPeriod } from '@/lib/productivity-analytics';
import { createClient } from '@/lib/supabase/client';
import { activeSet, duration, formatDuration, isDurationOnly, isRunning, setDuration, type Session, type TimerState } from '@/lib/timer';
import { ActivityOverDayChart, AnalyticsMetric, ProductivityTrendChart } from './home-analytics';
import { TodayActivityRing } from './today-activity-ring';
import type { IntervalCorrection } from '@/lib/session-corrections';

function compactTime(milliseconds: number) {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  return totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m` : `${totalMinutes}m`;
}

function CurrentSession({ session, now, ready, onOpenTimer, onPause, onResume, onFinish, onNextSet, onEndSet }: {
  session: Session | null; now: number; ready: boolean; onOpenTimer: () => void;
  onPause: () => boolean; onResume: () => boolean; onFinish: () => boolean; onNextSet: () => boolean; onEndSet: () => boolean;
}) {
  const currentSet = session ? activeSet(session) : null;
  return <section aria-labelledby="current-session-title" className={`th-card th-session-card analytics-session min-w-0 overflow-hidden p-5 sm:p-6 ${session && isRunning(session) ? 'analytics-session--live' : ''}`}>
    <div className="flex items-center justify-between gap-3"><p className="analytics-eyebrow">CURRENT SESSION</p><span className={`rounded-full px-3 py-1 text-[11px] font-bold tracking-wide ${session && isRunning(session) ? 'th-live-status bg-[#194b39] text-[#75ed9b]' : 'bg-[#303a3d] text-[#c3d0d0]'}`}>{session ? isRunning(session) ? '● LIVE' : 'PAUSED' : 'READY'}</span></div>
    <h2 id="current-session-title" className="mt-4 truncate text-xl font-bold sm:text-2xl">{session?.name ?? 'Ready to start'}</h2>
    {!session && <p className="mt-1 text-sm text-[#9ba8b8]">Choose an activity to start tracking.</p>}
    <p className="mt-4 text-center text-[clamp(2.2rem,4vw,3.7rem)] font-bold leading-none tracking-tight tabular-nums">{session ? formatDuration(duration(session, now)) : '00:00:00'}</p>
    <p className="mt-2 text-center text-xs text-[#9ba8b8]">{session?.countsProductive === false ? 'Personal activity time' : 'Productive activity time'} · breaks and pauses excluded</p>
    {session ? <>{session.tripPhase ? <button type="button" onClick={onOpenTimer} className="mt-5 w-full rounded-xl bg-[#35c9f4] px-4 py-3 text-sm font-bold text-[#0d1117]">Continue Trip →</button> : <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={!ready} onClick={isRunning(session) ? onPause : onResume} className="rounded-xl border border-white/15 bg-white/8 px-3 py-3 text-sm font-semibold">{isRunning(session) ? 'Ⅱ Pause' : '▶ Resume'}</button><button type="button" disabled={!ready} onClick={onFinish} className="rounded-xl bg-[#d85b67] px-3 py-3 text-sm font-bold text-white">■ Finish</button></div>}
      <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold tracking-wide text-[#9ba8b8]">CURRENT SET</p><p className="mt-1 truncate text-sm font-semibold">{currentSet ? currentSet.description : 'No SET running'}</p></div><span className="shrink-0 font-mono text-base font-semibold text-[#8dd2de] tabular-nums">{currentSet ? formatDuration(setDuration(currentSet, now)) : '00:00'}</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!ready || !isRunning(session) || !!session.tripPhase && session.tripPhase !== 'activity'} onClick={onNextSet} className="rounded-lg bg-[#27535a] px-3 py-2 text-xs font-bold text-[#d4f5f5]">{currentSet ? 'Next SET' : 'Start SET'}</button>{currentSet && <button type="button" disabled={!ready} onClick={onEndSet} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200">End SET</button>}<button type="button" onClick={onOpenTimer} className="ml-auto rounded-lg px-2 py-2 text-xs text-[#91cfda]">Details →</button></div></div>
    </> : <button type="button" onClick={onOpenTimer} className="mt-5 w-full rounded-xl bg-[#35c9f4] px-4 py-3 text-sm font-bold text-[#0d1117]">Start Timer →</button>}
  </section>;
}

export function HomeDashboard({ state, initialNow, ready, onOpenTimer, onOpenHistory, onOpenHabits, onStartActivity, onPause, onResume, onFinish, onNextSet, onEndSet, revisions = {}, onSaveSession, onCorrectIntervals }: {
  state: TimerState; initialNow: number; ready: boolean;
  onOpenTimer: () => void; onOpenHistory: () => void; onOpenHabits: () => void;
  onStartActivity: (name: string) => boolean;
  onPause: () => boolean; onResume: () => boolean; onFinish: () => boolean; onNextSet: () => boolean; onEndSet: () => boolean;
  revisions?: Record<string, number>; onSaveSession?: (session: Session) => boolean;
  onCorrectIntervals?: (sessionId: string, correction: IntervalCorrection) => Promise<string | null>;
}) {
  const [now, setNow] = useState(initialNow);
  const [accountFirstName, setAccountFirstName] = useState<string | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>('day');
  const [anchorKey, setAnchorKey] = useState(localDayKey(initialNow));
  const [selectedActivity, setSelectedActivity] = useState('');
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
    void client.auth.getUser().then(({ data }) => { if (mounted) setAccountFirstName(nameForUser(data.user)); }).catch(() => { if (mounted) setAccountFirstName(null); });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => { if (mounted) setAccountFirstName(nameForUser(session?.user ?? null)); });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const todayKey = localDayKey(now);
  const analyticsNow = Math.floor(now / 60_000) * 60_000;
  const availableActivities = activityNames(state);
  const chartActivity = availableActivities.includes(selectedActivity) ? selectedActivity : '';
  const analytics = useMemo(() => {
    const keys = periodDayKeys(anchorKey, period);
    const summary = periodSummary(state, analyticsNow, keys);
    const prior = periodSummary(state, analyticsNow, periodDayKeys(shiftPeriod(anchorKey, period, -1), period));
    const trendKeys = period === 'day' ? Array.from({ length: 7 }, (_, index) => addLocalDays(anchorKey, index - 6)) : keys;
    return {
      keys, summary, prior, trend: productiveTrend(state, analyticsNow, trendKeys),
      buckets: dayActivityBuckets(state, analyticsNow, anchorKey, chartActivity),
      day: buildDayTimeline(state, analyticsNow, anchorKey, { activity: chartActivity, includeBreaks: true }),
      goalProgress: habitPeriodProgress(state, analyticsNow, keys),
      todayGoals: habitPeriodProgress(state, analyticsNow, [localDayKey(analyticsNow)]),
    };
  }, [state, analyticsNow, anchorKey, period, chartActivity]);
  const firstName = firstNameFor(state.profile.displayName, { givenName: accountFirstName });
  const shortDate = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const firstKey = analytics.keys[0];
  const lastKey = analytics.keys.at(-1)!;
  const periodLabel = period === 'month' ? new Date(localDayStart(firstKey)).toLocaleDateString([], { month: 'long', year: 'numeric' })
    : period === 'week' ? `${new Date(localDayStart(firstKey)).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(localDayStart(lastKey)).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      : new Date(localDayStart(anchorKey)).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const nextKey = shiftPeriod(anchorKey, period, 1);
  const canGoNext = periodDayKeys(nextKey, period)[0] <= todayKey;
  const comparison = analytics.prior.productiveMilliseconds > 0 ? `${analytics.summary.productiveMilliseconds >= analytics.prior.productiveMilliseconds ? '+' : '−'}${compactTime(Math.abs(analytics.summary.productiveMilliseconds - analytics.prior.productiveMilliseconds))} vs previous ${period}` : null;
  const recent = recentActivityNames(state, 4);
  const quickName = [...new Set([...recent, ...state.activities.map(activity => activity.name)])][0];
  const startRecent = (name: string) => { if (onStartActivity(name)) onOpenTimer(); };

  return <div className="home-shell analytics-home min-w-0 space-y-5 sm:space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="analytics-eyebrow">{shortDate}</p><h1 className="mt-2 text-[clamp(2rem,3vw,3rem)] font-bold leading-tight tracking-tight">{greetingFor(now)}{firstName && <>, <span className="text-[#35c9f4]">{firstName}</span></>}</h1><p className="mt-1 text-sm text-[#9ba8b8]">Understand where your time goes.</p></div>
      <div className="flex flex-col items-start gap-2 sm:items-end"><div role="group" aria-label="Analytics period" className="flex rounded-xl border border-white/10 bg-[#1b222b] p-1">{(['day', 'week', 'month'] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize sm:px-4 ${period === value ? 'bg-[#35434e] text-white' : 'text-[#9ba8b8] hover:text-white'}`}>{value}</button>)}</div><div className="flex items-center gap-2 text-xs text-[#b7c5d1]"><button type="button" onClick={() => setAnchorKey(shiftPeriod(anchorKey, period, -1))} className="rounded-lg border border-white/10 px-2 py-1.5" aria-label={`Previous ${period}`}>←</button><span className="min-w-32 text-center">{periodLabel}</span><button type="button" disabled={!canGoNext} onClick={() => setAnchorKey(nextKey)} className="rounded-lg border border-white/10 px-2 py-1.5" aria-label={`Next ${period}`}>→</button>{anchorKey !== todayKey && <button type="button" onClick={() => setAnchorKey(todayKey)} className="rounded-lg border border-white/10 px-2 py-1.5 text-[#8ce4ef]">Today</button>}</div></div>
    </header>

    <section aria-label="Period metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5"><AnalyticsMetric label="Tracked activity" value={compactTime(analytics.summary.trackedMilliseconds)} note="Activity + breaks; travel separate" tone="cyan"/><AnalyticsMetric label="Productive time" value={compactTime(analytics.summary.productiveMilliseconds)} note="Classified active time" tone="emerald"/><AnalyticsMetric label="Leisure / personal" value={compactTime(analytics.summary.personalMilliseconds)} note="Active time outside productivity" tone="violet"/><AnalyticsMetric label="Travel time" value={compactTime(analytics.summary.travelMilliseconds)} note="Included in trip commitment" tone="cyan"/><AnalyticsMetric label="Goals met" value={String(analytics.summary.goalsCompleted)} note={state.habits.length ? 'Configured daily habits' : 'No goals configured'} tone="amber"/></section>

    <section aria-label="Quick actions" className="grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap"><button type="button" onClick={onOpenTimer} className="analytics-action analytics-action--cyan">▶ {state.active ? 'Open Timer' : 'Start Timer'}</button><button type="button" disabled={!!state.active} onClick={onOpenTimer} className="analytics-action analytics-action--violet">＋ Log Time</button>{quickName && <button type="button" disabled={!ready || !!state.active} onClick={() => startRecent(quickName)} style={{ '--shortcut-color': activityForName(state, quickName).color } as CSSProperties} className="analytics-action analytics-action--activity">↗ {quickName}</button>}<button type="button" onClick={onOpenHistory} className="analytics-action">History →</button></section>

    <div className="analytics-layout min-w-0">
      <CurrentSession session={state.active} now={now} ready={ready} onOpenTimer={onOpenTimer} onPause={onPause} onResume={onResume} onFinish={onFinish} onNextSet={onNextSet} onEndSet={onEndSet}/>
      <ActivityOverDayChart buckets={analytics.buckets} selectedActivity={chartActivity} activityNames={availableActivities} onSelectActivity={setSelectedActivity} dayLabel={new Date(localDayStart(anchorKey)).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} untimedMilliseconds={analytics.day.unscheduledMilliseconds}/>
      <TodayActivityRing state={state} now={now} dayKey={anchorKey} onOpenTimer={onOpenTimer} revisions={revisions} onSave={onSaveSession} onCorrect={onCorrectIntervals}/>
      <ProductivityTrendChart points={analytics.trend} label={period === 'day' ? 'Past 7 days' : periodLabel} comparison={comparison}/>
      <section aria-labelledby="goals-title" className="th-card analytics-card min-w-0 p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="analytics-eyebrow">DAILY HABITS</p><h2 id="goals-title" className="mt-1 text-xl font-bold sm:text-2xl">Goal progress</h2></div><button type="button" onClick={onOpenHabits} className="text-xs font-semibold text-[#35c9f4]">View habits →</button></div>
        {analytics.goalProgress.length ? <><p className="mt-2 text-xs text-[#9ba8b8]">{period === 'day' ? 'Selected day' : `Current daily targets across elapsed days in this ${period}`}</p><ul className="mt-5 space-y-4">{analytics.goalProgress.slice(0, 4).map(progress => { const today = analytics.todayGoals.find(item => item.habit.id === progress.habit.id); const color = activityForName(state, progress.habit.name).color; return <li key={progress.habit.id} className="min-w-0"><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate font-semibold"><span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: color }}/>{progress.habit.name}</span><span className="shrink-0 tabular-nums text-[#b7c5d1]">{compactTime(progress.minutes * 60_000)} / {compactTime(progress.targetMinutes * 60_000)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#34404a]"><div className="h-full rounded-full" style={{ width: `${progress.percentage}%`, backgroundColor: color }}/></div><p className="mt-1 text-[11px] text-[#9ba8b8]">{progress.completedDays}/{progress.eligibleDays} daily goals met · {progress.remainingMinutes > 0 ? `${compactTime(progress.remainingMinutes * 60_000)} to combined target` : 'Combined time target reached'}</p><p className="mt-1 text-[11px] text-[#9ba8b8]">Today: {compactTime((today?.minutes ?? 0) * 60_000)} / {compactTime(progress.habit.goalMinutes * 60_000)}</p></li>; })}</ul>{analytics.goalProgress.length > 4 && <button type="button" onClick={onOpenHabits} className="mt-4 text-xs text-[#35c9f4]">See all {analytics.goalProgress.length} habits →</button>}</> : <div className="mt-5 rounded-xl border border-dashed border-white/10 bg-white/[.025] p-5"><p className="font-medium">Give an activity a daily goal</p><p className="mt-2 text-sm text-[#9ba8b8]">Time-based habits show real progress here, without a default target.</p><button type="button" onClick={onOpenHabits} className="mt-4 rounded-lg bg-[#293e48] px-4 py-2 text-xs font-bold text-[#86dff6]">Create a habit →</button></div>}
      </section>
      <section aria-labelledby="recent-title" className="th-card analytics-card min-w-0 p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="analytics-eyebrow">YOUR RECORD</p><h2 id="recent-title" className="mt-1 text-xl font-bold sm:text-2xl">Recent activity</h2></div><button type="button" onClick={onOpenHistory} className="text-xs font-semibold text-[#35c9f4]">View history →</button></div>{state.completed.length ? <ul className="mt-5 divide-y divide-white/8">{state.completed.slice(0, 4).map(session => { const activity = activityForSession(state, session); const when = isDurationOnly(session) ? `${session.localDate} · Duration only` : new Date(session.startedAt!).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); return <li key={session.id} className="flex min-w-0 items-center gap-3 py-3"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[#0d1117]" style={{ backgroundColor: activity.color }}>{iconGlyph(activity.icon)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{session.name}</span><span className="mt-1 block truncate text-xs text-[#9ba8b8]">{when}</span></span><span className="shrink-0 font-mono text-sm tabular-nums text-[#d6e3ee]">{compactTime(duration(session, session.endedAt ?? now))}</span></li>; })}</ul> : <div className="mt-5 rounded-xl border border-dashed border-white/10 bg-white/[.025] p-6 text-sm text-[#9ba8b8]">Completed sessions will appear here after your first timer or manual log.</div>}</section>
    </div>
  </div>;
}
