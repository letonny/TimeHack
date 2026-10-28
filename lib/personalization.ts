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
