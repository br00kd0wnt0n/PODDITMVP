'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0a0a0a', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '20rem' }}>
            <h2 style={{ color: '#fff', fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#a8a29e', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Try refreshing — if the problem persists, clear your browser cache.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '0.625rem 1.25rem',
                backgroundColor: 'rgba(45, 212, 191, 0.15)',
                color: '#2dd4bf',
                fontSize: '0.875rem',
                fontWeight: 600,
                border: '1px solid rgba(45, 212, 191, 0.2)',
                borderRadius: '0.75rem',
                cursor: 'pointer',
                marginRight: '0.75rem',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.625rem 1.25rem',
                backgroundColor: 'transparent',
                color: '#78716c',
                fontSize: '0.875rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Hard refresh
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
