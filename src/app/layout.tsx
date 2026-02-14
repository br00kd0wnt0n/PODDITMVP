import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Poddit — Your World, Explained',
  description: 'Save what catches your eye. Poddit explains what it all means — connecting the dots, weighing the evidence, cutting through the noise.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen bg-poddit-950 antialiased text-poddit-100">
        {/* Drifting bokeh background — CSS-only, GPU-composited */}
        <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="bokeh-orb bokeh-1 absolute -bottom-[10%] -left-[5%] w-[50vw] h-[50vw] rounded-full bg-amber-500/[0.03] blur-3xl" />
          <div className="bokeh-orb bokeh-2 absolute -top-[15%] -right-[10%] w-[40vw] h-[40vw] rounded-full bg-violet-500/[0.025] blur-3xl" />
          <div className="bokeh-orb bokeh-3 absolute top-[30%] -left-[8%] w-[25vw] h-[25vw] rounded-full bg-teal-500/[0.025] blur-2xl" />
          <div className="bokeh-orb bokeh-4 absolute bottom-[20%] right-[5%] w-[30vw] h-[30vw] rounded-full bg-amber-400/[0.02] blur-3xl" />
          <div className="bokeh-orb bokeh-5 absolute top-[60%] left-[40%] w-[20vw] h-[20vw] rounded-full bg-violet-400/[0.02] blur-2xl" />
        </div>
        <div className="relative z-10 flex flex-col min-h-screen">
          <div className="flex-1">
            <Providers>{children}</Providers>
          </div>
          <footer className="relative z-10 border-t border-stone-800/30 mt-auto">
            <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-stone-600">
                &copy; 2026 Heathen Digital LLC. All rights reserved. Poddit&trade;
              </p>
              <div className="flex items-center gap-4">
                <Link href="/terms" className="text-xs text-stone-600 hover:text-stone-400 transition-colors">
                  Terms
                </Link>
                <Link href="/privacy" className="text-xs text-stone-600 hover:text-stone-400 transition-colors">
                  Privacy
                </Link>
                <a href="mailto:Hello@poddit.com" className="text-xs text-stone-600 hover:text-stone-400 transition-colors">
                  Contact
                </a>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
