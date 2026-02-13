export default function PrivacyPolicy() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-extrabold text-white mb-2 font-display tracking-tight">Privacy Policy</h1>
      <p className="text-sm text-stone-500 mb-8">Last updated: February 13, 2025</p>

      <div className="space-y-6 text-sm text-stone-300 leading-relaxed">
        <section>
          <h2 className="text-white font-semibold mb-2">What Poddit Does</h2>
          <p>
            Poddit is a personal podcast tool that turns links, topics, and voice notes into
            personalized audio episodes. The Poddit Chrome extension allows you to save the
            current page&apos;s URL and title to your Poddit queue with one click.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Data We Collect</h2>
          <p>When you use the Poddit Chrome extension, we collect:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-stone-400">
            <li><strong className="text-stone-300">Page URL</strong> — the web address of the page you choose to save</li>
            <li><strong className="text-stone-300">Page title</strong> — the title of the page you choose to save</li>
          </ul>
          <p className="mt-2">
            This data is only collected when you actively click the &ldquo;Save to Poddit&rdquo; button.
            The extension does not passively monitor your browsing activity.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">How We Use Your Data</h2>
          <p>
            Saved URLs and titles are stored in your personal Poddit queue and used solely to
            generate your personalized audio episodes. We do not use this data for advertising,
            analytics, or any purpose unrelated to creating your episodes.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Data Sharing</h2>
          <p>
            We do not sell, trade, or transfer your data to third parties. Your saved links
            are processed using AI services (Anthropic Claude) to generate episode content
            and text-to-speech services (ElevenLabs) to produce audio. These services process
            your data solely to fulfill the core functionality of Poddit.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Data Storage</h2>
          <p>
            The extension stores your Poddit server URL locally in your browser using
            Chrome&apos;s storage API. Your saved signals are stored on your Poddit server
            hosted on Railway.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Permissions</h2>
          <ul className="list-disc list-inside space-y-1 text-stone-400">
            <li><strong className="text-stone-300">activeTab</strong> — reads the current tab&apos;s URL and title only when you click Save</li>
            <li><strong className="text-stone-300">storage</strong> — saves your server URL locally so you don&apos;t have to re-enter it</li>
            <li><strong className="text-stone-300">host_permissions</strong> — sends saved links to your Poddit server on Railway</li>
          </ul>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Your Rights</h2>
          <p>
            You can delete any saved signal from your Poddit queue at any time through the
            dashboard. You can uninstall the extension at any time to stop all data collection.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Contact</h2>
          <p>
            If you have questions about this privacy policy, contact us at{' '}
            <a href="mailto:brook@poddit.com" className="text-teal-400 hover:text-teal-300 transition-colors">
              brook@poddit.com
            </a>.
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-stone-800/50">
        <a href="/" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">
          &larr; Back to Poddit
        </a>
      </div>
    </main>
  );
}
