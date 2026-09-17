import { NextRequest, NextResponse } from 'next/server';

// Edge runtime: verify the HMAC session cookie with Web Crypto.
async function validSession(cookie: string | undefined, secret: string): Promise<boolean> {
  if (!cookie) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(expected)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (expectedB64 !== sig) return false;
  try {
    const s = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return !!s.exp && s.exp > Date.now();
  } catch {
    return false;
  }
}

const PUBLIC_PATHS = ['/login', '/api/ingest/stripe', '/api/ingest/app'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  )
    return NextResponse.next();

  const secret = process.env.RECONCILE_SESSION_SECRET ?? 'reconcile-dev-secret';
  const ok = await validSession(req.cookies.get('reconcile_session')?.value, secret);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/'))
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
