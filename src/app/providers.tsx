'use client';

import { SessionProvider } from 'next-auth/react';
import { usePathname } from 'next/navigation';

// Routes where SessionProvider should NOT mount.
// The sign-in page uses signIn() directly (standalone, no React context needed)
// and wrapping it in SessionProvider causes BroadcastChannel feedback loops
// and hydration state churn that trigger full hard page reloads.
const NO_SESSION_PROVIDER = ['/auth/'];

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (NO_SESSION_PROVIDER.some(p => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
}
