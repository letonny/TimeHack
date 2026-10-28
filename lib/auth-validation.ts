export function validateCredentials(email: string, password: string, signup = false): string | null {
  if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (!password) return 'Enter your password.';
  if (signup && password.length < 6) return 'Use a password with at least 6 characters.';
  return null;
}
