import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/', url.origin));
  } else if (tokenHash && type === 'signup') {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' });
    if (!error) return NextResponse.redirect(new URL('/', url.origin));
  }
  const destination = new URL('/login', url.origin);
  destination.searchParams.set('error', 'The confirmation link is invalid or expired. Please try signing in or sign up again.');
  return NextResponse.redirect(destination);
}
