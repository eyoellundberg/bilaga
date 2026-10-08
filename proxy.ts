import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/_next/image')
    return new Response('Not found', { status: 404 });
  // /api/*, non-GET requests and server actions never get here: worker.ts handles them first.
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))),
  );
  const dev = process.env.NODE_ENV !== 'production';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(!dev ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  headers.delete('Content-Security-Policy-Report-Only');
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (!dev)
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Nonces and transfer metadata must never be cached or shared between visitors.
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  if (path.startsWith('/t/') || path.startsWith('/r/'))
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = {
  matcher: ['/((?!_next/static|favicon.svg|bilaga.py|llms.txt|robots.txt).*)'],
};
