import { formatDurationMilliseconds, isDurationOnly, setDuration, summarizeSession, type Session } from '@/lib/timer';

const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dateTime = (timestamp: number) => new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function SessionReport({ session, now, title = 'Session complete' }: { session: Session; now: number; title?: string }) {
  const summary = summarizeSession(session, now);
  let study = 0;
  let breaks = 0;
  return <div className="w-full">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{title.toUpperCase()}</p><h3 className="mt-2 text-xl font-semibold">{session.name}</h3><p className="mt-1 text-xs text-slate-400">{isDurationOnly(session) ? `${session.localDate} · Unscheduled / time not specified` : `${dateTime(session.startedAt!)} – ${dateTime(session.endedAt ?? now)}`}</p></div><p className="font-mono text-lg text-white">{formatDurationMilliseconds(summary.trackedMilliseconds)}</p></div>
    {session.note && <p className="mt-4 whitespace-pre-wrap rounded-lg border border-white/8 bg-white/[.025] p-3 text-sm text-slate-300">{session.note}</p>}
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-lg bg-teal-300/8 p-3"><p className="text-xs text-slate-400">Activity time</p><p className="mt-1 font-mono text-sm text-teal-200">{formatDurationMilliseconds(summary.studyMilliseconds)}</p></div>
      <div className="rounded-lg bg-amber-300/8 p-3"><p className="text-xs text-slate-400">Historical breaks</p><p className="mt-1 font-mono text-sm text-amber-200">{formatDurationMilliseconds(summary.breakMilliseconds)}</p></div>
      <div className="rounded-lg bg-white/5 p-3"><p className="text-xs text-slate-400">Total Tracked</p><p className="mt-1 font-mono text-sm text-white">{formatDurationMilliseconds(summary.trackedMilliseconds)}</p></div>
      <div className="rounded-lg bg-white/5 p-3"><p className="text-xs text-slate-400">Activity share</p><p className="mt-1 text-sm font-semibold text-white">{Math.round(summary.studyShare)}%</p></div>
    </div>
    <p className="mt-3 text-xs text-slate-500">{summary.breakCount} {summary.breakCount === 1 ? 'break' : 'breaks'} · Paused time is excluded from every interval.</p>
    {!!session.sets?.length && <div className="mt-5"><h4 className="text-sm font-semibold text-teal-200">SET history</h4><ol className="mt-3 space-y-2">{session.sets.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-teal-300/15 p-3 text-sm"><span>{item.description}</span><span className="font-mono">{formatDurationMilliseconds(setDuration(item, now))}</span></li>)}</ol><p className="mt-2 text-xs text-slate-500">SET time is included in the parent activity total and never added again.</p></div>}
    {!!summary.intervals.length && <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-[var(--background)]" aria-label="Study and break interval timeline">{summary.intervals.map((interval, index) => <span key={index} className={interval.kind === 'study' ? 'bg-teal-300' : 'bg-amber-300'} style={{ width: `${summary.trackedMilliseconds ? interval.milliseconds / summary.trackedMilliseconds * 100 : 0}%` }} title={`${interval.kind === 'study' ? 'Study' : 'Break'} ${formatDurationMilliseconds(interval.milliseconds)}`} />)}</div>}
    <ol className="mt-5 space-y-2">{summary.intervals.map((interval, index) => {
      const number = interval.kind === 'study' ? ++study : ++breaks;
      return <li key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 px-3 py-2 text-sm"><span><span className={`mr-2 inline-block size-2 rounded-full ${interval.kind === 'study' ? 'bg-teal-300' : 'bg-amber-300'}`}/>{interval.kind === 'study' ? 'Study' : 'Break'} #{number}</span><span className="text-xs text-slate-500">{clock(interval.startedAt)} – {clock(interval.endedAt ?? now)}{interval.segmentCount > 1 ? ' · paused time excluded' : ''}</span><span className="font-mono text-xs text-slate-300">{formatDurationMilliseconds(interval.milliseconds)}</span></li>;
    })}</ol>
  </div>;
}
