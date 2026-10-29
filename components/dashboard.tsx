'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { logout } from '@/app/auth/actions';
import { useTimer } from '@/hooks/use-timer';
import { buildDayTimeline, formatDashboardDate, localDayKey } from '@/lib/analytics';
import { greetingFor } from '@/lib/personalization';
import { activeSet, formatCompletedDuration, isRunning } from '@/lib/timer';
import { AccountSettings } from './account-settings';
import { ActivityCalendar } from './activity-calendar';
import { ActivityHistory } from './activity-history';
import { HabitTracker } from './habit-tracker';
import { DailyTimeline } from './daily-timeline';
import { LiveSessionTimer } from './live-session-timer';
import { QuickLog } from './quick-log';
import { SegmentHistory } from './segment-history';
import { SessionReport } from './session-report';
import { TodayActivityRing } from './today-activity-ring';
import { NotificationSettings } from './notification-settings';

function SignOutButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10">{pending ? 'Signing out…' : 'Sign out'}</button>;
}

export function Dashboard() {
  const timer = useTimer();
  const [screen, setScreen] = useState<'home' | 'timer' | 'history' | 'habits' | 'settings'>('home');
  const [name, setName] = useState('');
  const [activeNote, setActiveNote] = useState('');
  const [setDescription, setSetDescription] = useState('');
  const [recentSessionId, setRecentSessionId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const active = timer.state.active;
  const running = active ? isRunning(active) : false;
  const currentSet = active ? activeSet(active) : null;
  const onBreak = active?.segments.at(-1)?.kind === 'break';
  const date = timer.now === null ? null : formatDashboardDate(timer.now);
  const greeting = timer.now === null ? null : greetingFor(timer.now, timer.state.profile.displayName);
  const recentSession = recentSessionId ? timer.state.completed.find(session => session.id === recentSessionId) : null;
  const syncLabel = timer.syncing ? 'Syncing' : timer.pending ? `${timer.pending} pending` : timer.syncError ? 'Sync issue' : timer.ready ? 'Synced' : 'Loading';

  return <div className="min-h-screen">
    <header className="border-b border-white/8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-3 text-xl font-bold tracking-tight"><span aria-hidden="true" className="flex size-9 items-center justify-center rounded-xl bg-teal-300 text-lg text-[#0b1424]">↗</span>TimeHack<span className="sr-only"> home</span></Link>
      <div className="flex items-center gap-3"><div role="status" className="flex items-center gap-2 text-[11px] text-slate-400" title={timer.syncError || 'Account synchronization status'}><span className={`size-1.5 rounded-full ${timer.syncError ? 'bg-amber-300' : timer.syncing || timer.pending ? 'bg-sky-300' : timer.ready ? 'bg-teal-300' : 'bg-slate-500'}`}/><span className="hidden sm:inline">{syncLabel}</span></div><form action={logout} onSubmit={() => { navigator.serviceWorker?.controller?.postMessage({ type: 'timehack-account', userId: '' }); }}><SignOutButton/></form></div>
    </div></header>

    <main className="mx-auto max-w-6xl px-5 py-7 pb-28 sm:px-8 sm:py-9 sm:pb-32">
      <div className="mb-6 text-center" aria-live="polite">{date ? <><p className="mb-4 text-lg text-slate-300 sm:text-xl">{screen === 'home' ? greeting : screen[0].toUpperCase() + screen.slice(1)}</p><p className="text-sm font-semibold tracking-[.28em] text-teal-300 sm:text-base">{date.weekday}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-5xl">{date.date}</h1></> : <h1 className="text-xl text-slate-400">Loading today…</h1>}</div>

      {timer.error && <p role="alert" className="mb-5 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">{timer.error}</p>}
      {timer.syncError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-xs text-amber-100"><span>{timer.syncError}</span>{timer.conflict ? <button type="button" onClick={timer.useCloudVersion} className="rounded-lg bg-white/10 px-3 py-2 text-teal-100">Back up changes and load cloud version</button> : <button type="button" onClick={timer.retry} className="rounded-lg bg-white/10 px-3 py-2 text-teal-100">Retry sync</button>}</div>}
      {timer.legacyAvailable && <details className="mb-5 rounded-xl border border-white/8 bg-white/[.025] px-4 py-3 text-xs text-slate-400"><summary className="cursor-pointer text-slate-300">Older browser data is available</summary><div className="mt-3"><p>Review this only if this browser profile is yours. Original local data will be preserved.</p><button type="button" disabled={!timer.ready || timer.pending > 0 || timer.syncing} onClick={timer.previewLegacy} className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-teal-200">Review browser data</button>{timer.legacyPreview && <div className="mt-3 space-y-2"><p>{timer.legacyPreview.habits.length} habits and {timer.legacyPreview.completed.length + (timer.legacyPreview.active ? 1 : 0)} sessions found.</p><button type="button" disabled={!timer.ready || timer.pending > 0 || timer.syncing} onClick={timer.importLegacy} className="rounded-lg bg-teal-300 px-3 py-2 font-medium text-slate-950">Import into this account</button></div>}</div></details>}

      {screen === 'home' && <div>{timer.now !== null && <TodayActivityRing state={timer.state} initialNow={timer.now}/>}<div className="panel mt-6 p-5"><h2 className="text-lg font-semibold">Today at a glance</h2><p className="mt-3 text-sm text-slate-300">{active ? `Current activity: ${active.name}` : 'No activity is running'}</p><p className="mt-2 text-sm text-slate-400">{timer.now !== null ? `${formatCompletedDuration(buildDayTimeline(timer.state, timer.now).trackedMilliseconds)} tracked today` : 'Loading activity…'}</p><button type="button" onClick={() => setScreen('timer')} className="primary mt-4">{active ? 'Open timer' : 'Start activity'}</button></div></div>}

      {screen === 'timer' && <section aria-labelledby="timer-title" className="panel relative mt-8 overflow-hidden"><div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-teal-400/5 blur-3xl"/><div className="relative p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4"><div><p className="eyebrow">LIVE SESSION</p><h2 id="timer-title" className="mt-2 text-xl font-semibold">Activity timer</h2></div><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{!timer.ready ? 'Loading' : active ? running ? onBreak ? 'Legacy break' : active.name : 'Paused' : 'Ready'}</span></div>
        <form onSubmit={event => { event.preventDefault(); if (timer.start(name)) setName(''); }} className="mt-6"><label htmlFor="activity" className="text-sm text-slate-300">What are you tracking?</label><input id="activity" list="timer-activity-names" value={active?.name ?? name} onChange={event => setName(event.target.value)} disabled={!!active || !timer.ready} maxLength={120} autoComplete="off" placeholder="e.g. Studying, gym, cooking…" className="mt-3 w-full rounded-xl border border-white/10 bg-[#0b1424] px-4 py-3.5 text-base text-white placeholder:text-slate-500 disabled:opacity-70"/><datalist id="timer-activity-names">{timer.state.activities.map(activity => <option key={activity.id} value={activity.name}/>)}</datalist>
          {active && timer.now !== null ? <LiveSessionTimer session={active} initialNow={timer.now}/> : <div className="py-9 text-center sm:py-12"><p className="text-2xl font-medium text-slate-300">Ready for your next activity</p><p className="mt-2 text-sm text-slate-500">Start a session to see live study, break, and tracked time.</p></div>}
          {active && <div className="mx-auto mb-4 max-w-2xl space-y-3 text-left"><label className="block text-xs text-slate-400">SET description<input maxLength={120} value={setDescription} onChange={event => setSetDescription(event.target.value)} placeholder="Squats, Rest, Warm-up…" className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1424] p-3 text-base text-white"/></label><label className="block text-xs text-slate-400">Session note <span className="text-slate-600">(optional)</span><textarea maxLength={2000} value={activeNote} onChange={event => setActiveNote(event.target.value)} rows={2} placeholder="Add a note before finishing…" className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#0b1424] p-3 text-sm text-white"/></label></div>}
          <div className="mx-auto flex max-w-md flex-wrap gap-3">{!active ? <button type="submit" disabled={!timer.ready || !name.trim()} className="primary flex-1">▶ <span className="ml-2">Start Timer</span></button> : <><button type="button" disabled={!timer.ready || !running} onClick={() => { if (timer.set(setDescription, currentSet?.id ?? null)) setSetDescription(''); }} className="primary flex-1" aria-label={currentSet ? 'Start another SET' : 'Start SET'}>{currentSet ? 'Next SET' : 'Start SET'}</button>{currentSet && <button type="button" disabled={!timer.ready} onClick={timer.endSet} className="rounded-xl border border-teal-300/30 px-4 py-3 text-sm text-teal-200">End SET</button>}<button type="button" disabled={!timer.ready} onClick={running ? timer.pause : timer.resume} className="primary flex-1">{running ? 'Ⅱ Pause' : '▶ Resume'}</button><button type="button" disabled={!timer.ready} onClick={() => { const id = active.id; if (timer.stop(activeNote)) { setRecentSessionId(id); setActiveNote(''); setSetDescription(''); } }} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold hover:bg-white/10">■ Finish</button></>}</div>
        </form>
        {!active && timer.now !== null && <div className="mx-auto max-w-md"><QuickLog state={timer.state} now={timer.now} ready={timer.ready} onSave={timer.logManual}/></div>}
        {active && timer.now !== null && <SegmentHistory session={active} now={timer.now}/>}
        <p className="mt-5 text-center text-xs text-slate-500">Timestamp-based and saved to your account. Paused time is excluded.</p>
      </div></section>}

      {screen === 'timer' && recentSession && <section className="panel mt-5 p-5 sm:p-8" aria-label="Most recently completed session"><div className="flex justify-end"><button type="button" onClick={() => setRecentSessionId(null)} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white/5 hover:text-white">Dismiss</button></div><SessionReport session={recentSession} now={recentSession.endedAt ?? timer.now ?? 0}/></section>}

      {screen === 'habits' && <HabitTracker state={timer.state} now={timer.now} ready={timer.ready} onSave={timer.saveHabit} onDelete={timer.deleteHabit} onTrack={name => { if (timer.start(name)) setScreen('timer'); }} onSaveReminder={timer.saveReminder} onDeleteReminder={timer.deleteReminder}/>}
      {screen === 'history' && <>{timer.now !== null && <ActivityCalendar state={timer.state} now={timer.now} selectedDay={selectedDay ?? undefined} onSelectDay={setSelectedDay}/>}{timer.now !== null && <DailyTimeline state={timer.state} now={timer.now} dayKey={selectedDay ?? localDayKey(timer.now)} onSelectDay={setSelectedDay} onSave={timer.updateSession}/>}{timer.now !== null && <ActivityHistory state={timer.state} now={timer.now} onDelete={timer.remove} onSave={timer.updateSession}/>}</>}
      {screen === 'settings' && <><AccountSettings key={`${timer.state.profile.displayName}:${timer.state.activities.map(activity => `${activity.id}:${activity.name}:${activity.icon}:${activity.color}`).join('|')}`} profile={timer.state.profile} activities={timer.state.activities} ready={timer.ready} onSaveProfile={timer.saveProfile} onSaveActivity={timer.saveActivity} onDeleteActivity={timer.deleteActivity}/><NotificationSettings /></>}
      <footer className="mt-8 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><p>Your time, clearly recorded.</p><p>Habits and sessions sync with your account.</p></footer>
    </main>
    <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b1424]/95 px-2 pt-2 backdrop-blur" style={{ paddingBottom: 'max(.5rem, env(safe-area-inset-bottom))' }}><div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">{(['home', 'timer', 'history', 'habits', 'settings'] as const).map(item => <button key={item} type="button" aria-current={screen === item ? 'page' : undefined} onClick={() => setScreen(item)} className={`rounded-xl px-1 py-3 text-xs font-medium capitalize ${screen === item ? 'bg-teal-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>{item}</button>)}</div></nav>
  </div>;
}
