import Image from 'next/image';

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="p-6 bg-poddit-900/60 border border-stone-800/60 rounded-xl text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Image src="/logo.png" alt="Poddit" width={32} height={32} className="rounded-lg" />
            <h1 className="text-xl font-extrabold text-white font-display">PODDIT</h1>
          </div>

          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-teal-500/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                 className="text-teal-400">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>

          <h2 className="text-lg font-semibold text-white mb-2">Check your email</h2>
          <p className="text-stone-400 text-sm mb-1">
            We sent you a magic link to sign in.
          </p>
          <p className="text-stone-500 text-xs">
            Click the link in the email to continue. It may take a minute to arrive.
          </p>

          <a
            href="/auth/signin"
            className="inline-block mt-6 text-xs text-teal-400 hover:text-teal-300 transition-colors"
          >
            Try a different email
          </a>
        </div>
      </div>
    </div>
  );
}
