'use client';

import { useState } from 'react';

export default function ShortcutPage() {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const apiUrl = 'https://poddit-mvp.up.railway.app/api/capture/extension';

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <a href="/" className="text-sm text-indigo-500 hover:text-indigo-600">← Back to Dashboard</a>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">iOS Share Shortcut</h1>
      <p className="text-gray-500 mb-8">
        Add &quot;Send to Poddit&quot; to your iPhone share sheet. Takes about 2 minutes.
      </p>

      {/* Steps */}
      <div className="space-y-6 mb-10">
        <Step n={1} title="Open Shortcuts app">
          Open the <strong>Shortcuts</strong> app on your iPhone and tap <strong>+</strong> to create a new shortcut.
        </Step>

        <Step n={2} title="Accept Share Sheet input">
          <p>Tap <strong>Add Action</strong> → search for <strong>&quot;Share&quot;</strong> → select <strong>&quot;Receive input from Share Sheet&quot;</strong>.</p>
          <p className="mt-1">Tap the blue <strong>&quot;Anywhere&quot;</strong> word and make sure <strong>URLs</strong> and <strong>Safari web pages</strong> are selected.</p>
        </Step>

        <Step n={3} title="Set the API URL">
          <p>Add action → search <strong>&quot;URL&quot;</strong> → select the <strong>URL</strong> action.</p>
          <p className="mt-2">Set it to:</p>
          <CopyBlock
            text={apiUrl}
            label="url"
            copied={copied}
            onCopy={copyText}
          />
        </Step>

        <Step n={4} title="Send the request">
          <p>Add action → search <strong>&quot;Get Contents&quot;</strong> → select <strong>&quot;Get Contents of URL&quot;</strong>.</p>
          <p className="mt-2">Tap the blue &quot;URL&quot; to make sure it says <strong>&quot;URL&quot;</strong> (from step 3). Then tap <strong>&quot;Show More&quot;</strong> and set:</p>

          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 w-16">Method:</span>
              <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">POST</span>
            </div>

            <div>
              <span className="font-medium text-gray-900">Headers</span> — add two:
              <div className="mt-2 space-y-2 ml-2">
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="Authorization" label="auth-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
                  <div className="flex-1">
                    {showKey ? (
                      <CopyBlock
                        text="Bearer o3p94ntDyniHpYT3DkVhI8huOZ43mBUagYf2i2+Ardg="
                        label="auth-value"
                        copied={copied}
                        onCopy={copyText}
                        compact
                      />
                    ) : (
                      <button
                        onClick={() => setShowKey(true)}
                        className="text-xs bg-gray-100 px-3 py-1.5 rounded text-indigo-600 hover:bg-gray-200 transition-colors"
                      >
                        Tap to reveal API key
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2 ml-2">
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="Content-Type" label="ct-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
                  <CopyBlock text="application/json" label="ct-value" copied={copied} onCopy={copyText} compact />
                </div>
              </div>
            </div>

            <div>
              <span className="font-medium text-gray-900">Request Body</span> — set to <strong>JSON</strong>, then add:
              <div className="mt-2 ml-2 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="url" label="body-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded font-medium">
                    Shortcut Input
                    <span className="text-indigo-400 font-normal ml-1">(tap to select variable)</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Step>

        <Step n={5} title="Add confirmation">
          <p>Add action → search <strong>&quot;Notification&quot;</strong> → select <strong>&quot;Show Notification&quot;</strong>.</p>
          <p className="mt-1">Set the text to: <strong>✓ Sent to Poddit</strong></p>
        </Step>

        <Step n={6} title="Name it and enable share sheet">
          <p>Tap the <strong>dropdown arrow ▾</strong> at the very top → <strong>Rename</strong> → type <strong>&quot;Send to Poddit&quot;</strong>.</p>
          <p className="mt-1">Then tap the <strong>ⓘ</strong> icon → toggle on <strong>&quot;Show in Share Sheet&quot;</strong>.</p>
          <p className="mt-1">Tap <strong>Done</strong>.</p>
        </Step>
      </div>

      {/* Test it */}
      <section className="p-5 bg-green-50 border border-green-200 rounded-lg">
        <h2 className="font-semibold text-gray-900 mb-2">Test it</h2>
        <p className="text-sm text-gray-600">
          Open any article in Safari → tap <strong>Share</strong> → scroll down to find <strong>&quot;Send to Poddit&quot;</strong>.
          You should see a &quot;✓ Sent to Poddit&quot; notification, and the signal will appear on your dashboard.
        </p>
      </section>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <div className="text-sm text-gray-600 mt-1">{children}</div>
      </div>
    </div>
  );
}

function CopyBlock({ text, label, copied, onCopy, compact }: {
  text: string;
  label: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${compact ? '' : 'mt-2'}`}
    >
      <code
        className={`flex-1 bg-gray-100 rounded text-xs break-all select-all ${compact ? 'px-3 py-1.5' : 'p-2.5'}`}
      >
        {text}
      </code>
      <button
        onClick={() => onCopy(text, label)}
        className="flex-shrink-0 text-xs text-indigo-500 hover:text-indigo-600 px-2 py-1"
      >
        {copied === label ? '✓' : 'Copy'}
      </button>
    </div>
  );
}
