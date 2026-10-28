export function authRedirect(path: string, authenticated: boolean): '/login' | '/' | null {
  if (path === '/' && !authenticated) return '/login';
  if ((path === '/login' || path === '/signup') && authenticated) return '/';
  return null;
}
