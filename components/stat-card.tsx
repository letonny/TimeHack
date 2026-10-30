export function StatCard({ label, value, note }: {
    label: string;
    value: string;
    note: string;
}) {
    return <div className="rounded-2xl border border-white/8 bg-[var(--surface)] p-6"><p className="text-sm text-slate-400">{label}</p><p className="mt-3 font-mono text-3xl font-medium tracking-tight text-white sm:text-4xl">{value}</p><p className="mt-3 text-xs text-slate-400">{note}</p></div>;
}
