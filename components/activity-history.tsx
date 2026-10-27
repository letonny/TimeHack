import { SegmentHistory } from './segment-history';
import { duration, formatDuration, type Session } from '@/lib/timer';
export function ActivityHistory({ sessions, onDelete }: {
    sessions: Session[];
    onDelete: (id: string) => void;
}) {
    return <section aria-labelledby="history-title" className="panel mt-8"><div className="flex items-center justify-between gap-4 border-b border-white/8 p-6"><div><h2 id="history-title" className="text-lg font-semibold">Activity history</h2><p className="mt-1 text-sm text-slate-400">A little progress, recorded.</p></div><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{sessions.length} saved</span></div>
    {sessions.length === 0 ? <div className="px-6 py-14 text-center"><div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-teal-300/10 text-xl text-teal-300" aria-hidden="true">↗</div><p className="font-medium">Your first session starts here</p><p className="mt-2 text-sm text-slate-400">Choose an activity above. We’ll keep track of the time.</p></div> : <ul className="divide-y divide-white/8">{sessions.map(session => <li key={session.id} className="flex flex-wrap items-center gap-4 p-5 sm:px-6"><span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-300/10 text-teal-300">✓</span><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{session.name}</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">{new Date(session.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {session.segments.length} {session.segments.length === 1 ? 'segment' : 'segments'}</p></div><span className="font-mono text-sm text-slate-200">{formatDuration(duration(session, session.endedAt!))}</span><button className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`Delete session ${session.name}`} onClick={() => { if (window.confirm(`Delete “${session.name}”? This cannot be undone.`))
        onDelete(session.id); }}>Delete</button><SegmentHistory session={session} now={session.endedAt!}/></li>)}</ul>}
  </section>;
}
