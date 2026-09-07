import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
export function middleware(request:NextRequest){
  const response=NextResponse.next();
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('X-Frame-Options','DENY');
  if(request.nextUrl.pathname.startsWith('/t/')||request.nextUrl.pathname.startsWith('/api/')){
    response.headers.set('Cache-Control','private, no-store, max-age=0');
    response.headers.set('X-Robots-Tag','noindex, nofollow');
  }
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
