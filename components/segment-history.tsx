import { formatDurationMilliseconds, sessionIntervals, setDuration, type Session } from '@/lib/timer';
export function SegmentHistory({ session, now }: { session: Session; now: number }) {
    const intervals = sessionIntervals(session, now);
    let study = 0, breaks = 0;
    return <div className="mt-5 w-full border-t border-white/8 pt-4 text-sm text-slate-400">{!!session.sets?.length && <div><h3 className="font-medium text-slate-200">SET history ({session.sets.length})</h3><ol className="mt-3 space-y-2">{session.sets.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/[.025] px-3 py-2"><span>{item.description}{item.segments.at(-1)?.endedAt === null ? ' · running' : ''}</span><span className="font-mono text-xs text-teal-200">{formatDurationMilliseconds(setDuration(item, now))}</span></li>)}</ol></div>}
    {intervals.some(item => item.kind !== 'study') && <details className="mt-4"><summary className="cursor-pointer">Session intervals ({intervals.length})</summary><ol className="mt-3 space-y-2">{intervals.map((interval, index) => {
        const number = interval.kind === 'study' ? ++study : interval.kind === 'break' ? ++breaks : null;
        const label = interval.kind === 'study' ? session.name : interval.kind === 'break' ? 'Break' : interval.kind === 'travel_out' ? 'Outbound travel' : 'Return travel';
        return <li key={index} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/[.025] px-3 py-2"><span>{label}{number !== null ? ` #${number}` : ''}{interval.endedAt === null ? ' · running' : ''}{interval.segmentCount > 1 ? ' · paused time excluded' : ''}</span><span className="text-xs text-slate-500">{new Date(interval.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} – {interval.endedAt === null ? 'now' : new Date(interval.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span><span className="font-mono text-xs text-slate-300">{formatDurationMilliseconds(interval.milliseconds)}</span></li>;
    })}</ol></details>}</div>;
}
