export function greetingFor(timestamp: number, displayName = ''): string {
  const hour = new Date(timestamp).getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = displayName.trim();
  return name ? `${greeting}, ${name}` : greeting;
}

export function validateDisplayName(value: string): string {
  const name = value.trim();
  if (name.length > 80) throw new Error('Display name must be 80 characters or fewer.');
  return name;
}

/** Choose a short, display-safe first name without exposing an email address. */
export function firstNameFor(displayName: string, account?: { givenName?: unknown; fullName?: unknown; email?: string | null }): string | null {
  const candidates = [displayName, account?.givenName, account?.fullName, account?.email?.split('@')[0]];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const first = candidate.trim().split(/[\s._-]+/u)[0]?.replace(/[^\p{L}\p{M}'’]/gu, '');
    if (first && first.length <= 40) return first[0].toLocaleUpperCase() + first.slice(1);
  }
  return null;
}
