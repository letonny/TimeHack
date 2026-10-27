import { formatDuration, segmentDuration, type Session } from '@/lib/timer';
export function SegmentHistory({ session, now }: { session: Session; now: number }) {
    return <details className="mt-4 w-full text-sm text-slate-400"><summary className="cursor-pointer">Session segments ({session.segments.length})</summary><ol className="mt-3 space-y-2">{session.segments.map((segment, index) => <li key={index} className="flex justify-between gap-4"><span>{index + 1}. {segment.kind === 'break' ? 'Break' : 'Study'}{segment.endedAt === null ? ' · running' : ''}</span><span className="font-mono">{formatDuration(segmentDuration(segment, now))}</span></li>)}</ol></details>;
}
