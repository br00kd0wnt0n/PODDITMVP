import { auth } from '@/lib/auth-config';

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;

  // Auth pages are always accessible
  if (pathname.startsWith('/auth')) return;

  // Admin has its own API_SECRET auth
  if (pathname.startsWith('/admin')) return;

  // API routes handle their own auth
  if (pathname.startsWith('/api')) return;

  // Privacy page is public
  if (pathname === '/privacy') return;

  // Everything else requires login
  if (!isLoggedIn) {
    const signInUrl = new URL('/auth/signin', req.nextUrl.origin);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon\\.ico|logo\\.png|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|manifest\\.json|audio/|globals\\.css).*)',
  ],
};
