'use client';

import { useState } from 'react';
import Image from 'next/image';

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
        <a href="/" className="text-sm text-poddit-500 hover:text-white inline-flex items-center gap-2 transition-colors">
          <Image src="/logo.png" alt="Poddit" width={20} height={20} className="rounded" />
          &larr; Back to Dashboard
        </a>
      </div>

      <h1 className="text-2xl font-extrabold text-white mb-2">iOS Share Shortcut</h1>
      <p className="text-poddit-400 mb-8">
        Add &quot;Send to Poddit&quot; to your iPhone share sheet. Takes about 2 minutes.
      </p>

      {/* Steps */}
      <div className="space-y-6 mb-10">
        <Step n={1} title="Create a new shortcut">
          <p>Open the <strong className="text-white">Shortcuts</strong> app &rarr; tap <strong className="text-white">+</strong> in the top-right.</p>
          <p className="mt-1">Tap the <strong className="text-white">shortcut name</strong> at the top &rarr; <strong className="text-white">Rename</strong> &rarr; type <strong className="text-white">&quot;Send to Poddit&quot;</strong>.</p>
        </Step>

        <Step n={2} title="Enable the share sheet">
          <p>Tap the <strong className="text-white">shortcut name</strong> at the top again &rarr; tap <strong className="text-white">&quot;Share Sheet&quot;</strong> (or look for the share icon).</p>
          <p className="mt-1">This tells iOS to show this shortcut when you tap Share in any app.</p>
          <div className="mt-2 p-3 bg-white/5 border border-white/10 rounded-lg text-xs text-poddit-400">
            <strong className="text-poddit-300">Note:</strong> On older iOS (pre-16), search for <strong className="text-white">&quot;Receive input from Share Sheet&quot;</strong> as an action instead.
          </div>
        </Step>

        <Step n={3} title="Add the URL action">
          <p>Tap <strong className="text-white">Add Action</strong> &rarr; search <strong className="text-white">&quot;URL&quot;</strong> &rarr; select the <strong className="text-white">URL</strong> action.</p>
          <p className="mt-2">Set it to:</p>
          <CopyBlock
            text={apiUrl}
            label="url"
            copied={copied}
            onCopy={copyText}
          />
        </Step>

        <Step n={4} title="Add Get Contents of URL">
          <p>Tap <strong className="text-white">+</strong> below the URL action &rarr; search <strong className="text-white">&quot;Get Contents&quot;</strong> &rarr; select <strong className="text-white">&quot;Get Contents of URL&quot;</strong>.</p>
          <p className="mt-2">Make sure it says it will get contents of <strong className="text-white">&quot;URL&quot;</strong> (from step 3). Then tap <strong className="text-white">&quot;Show More&quot;</strong> and configure:</p>

          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white w-16">Method:</span>
              <span className="font-mono bg-poddit-800 text-poddit-300 px-2 py-1 rounded text-xs">POST</span>
            </div>

            <div>
              <span className="font-medium text-white">Headers</span> &mdash; add two:
              <div className="mt-2 space-y-2 ml-2">
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="Authorization" label="auth-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
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
                        className="text-xs bg-poddit-800 px-3 py-1.5 rounded text-white hover:bg-poddit-700 transition-colors"
                      >
                        Tap to reveal API key
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2 ml-2">
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="Content-Type" label="ct-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
                  <CopyBlock text="application/json" label="ct-value" copied={copied} onCopy={copyText} compact />
                </div>
              </div>
            </div>

            <div>
              <span className="font-medium text-white">Request Body</span> &mdash; set to <strong className="text-white">JSON</strong>, then add:
              <div className="mt-2 ml-2 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Key:</span>
                  <CopyBlock text="url" label="body-key" copied={copied} onCopy={copyText} compact />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-poddit-500 text-xs w-12 mt-1 flex-shrink-0">Value:</span>
                  <span className="text-xs bg-white/10 text-white px-3 py-1.5 rounded font-medium">
                    Shortcut Input
                    <span className="text-poddit-400 font-normal ml-1">(tap to select the variable)</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Step>

        <Step n={5} title="Add a notification (optional)">
          <p>Tap <strong className="text-white">+</strong> &rarr; search <strong className="text-white">&quot;Notification&quot;</strong> &rarr; select <strong className="text-white">&quot;Show Notification&quot;</strong>.</p>
          <p className="mt-1">Set the text to: <strong className="text-white">Sent to Poddit</strong></p>
        </Step>

        <Step n={6} title="Done">
          <p>Tap <strong className="text-white">Done</strong> in the top-right. The shortcut will now appear in your share sheet.</p>
        </Step>
      </div>

      {/* Test it */}
      <section className="p-5 bg-white/5 border border-white/10 rounded-xl">
        <h2 className="font-semibold text-white mb-2">Test it</h2>
        <p className="text-sm text-poddit-400">
          Open any article in Safari &rarr; tap <strong className="text-white">Share</strong> &rarr; scroll down to find <strong className="text-white">&quot;Send to Poddit&quot;</strong>.
          You should see a notification, and the signal will appear on your dashboard.
        </p>
      </section>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white text-poddit-950 text-sm font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-white">{title}</h3>
        <div className="text-sm text-poddit-400 mt-1">{children}</div>
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
        className={`flex-1 bg-poddit-800 text-poddit-200 rounded text-xs break-all select-all ${compact ? 'px-3 py-1.5' : 'p-2.5'}`}
      >
        {text}
      </code>
      <button
        onClick={() => onCopy(text, label)}
        className="flex-shrink-0 text-xs text-poddit-400 hover:text-white px-2 py-1 transition-colors"
      >
        {copied === label ? '\u2713' : 'Copy'}
      </button>
    </div>
  );
}
