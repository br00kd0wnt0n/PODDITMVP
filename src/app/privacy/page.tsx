import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-extrabold text-white mb-2 font-display tracking-tight">Privacy Policy</h1>
      <p className="text-sm text-stone-500 mb-8">Last updated: February 14, 2026</p>

      <div className="space-y-6 text-sm text-stone-300 leading-relaxed">
        <section>
          <h2 className="text-white font-semibold mb-2">Who We Are</h2>
          <p>
            Poddit&trade; is operated by Heathen Digital LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo;
            or &ldquo;our&rdquo;). This policy describes how we collect, use, and protect your
            information when you use the Poddit platform, including the web application, Chrome
            extension, and any related services.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">What Poddit Does</h2>
          <p>
            Poddit is a personal podcast tool that turns links, topics, and voice notes into
            personalized audio episodes. You save content that interests you, and Poddit
            researches, synthesizes, and narrates it back to you as an audio episode.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Data We Collect</h2>
          <p>We collect the following types of information:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-stone-400">
            <li><strong className="text-stone-300">Account information</strong> &mdash; your name, email address, and phone number (if provided for SMS notifications)</li>
            <li><strong className="text-stone-300">Signals</strong> &mdash; the links, topics, voice notes, and text you submit to Poddit</li>
            <li><strong className="text-stone-300">Voice recordings</strong> &mdash; audio submitted via the dashboard or feedback module, which is transcribed and then discarded (we do not store raw audio files of your voice input)</li>
            <li><strong className="text-stone-300">Generated episodes</strong> &mdash; the audio episodes created from your signals</li>
            <li><strong className="text-stone-300">Feedback</strong> &mdash; any text or voice feedback you submit through the feedback module</li>
            <li><strong className="text-stone-300">Usage data</strong> &mdash; basic interaction data such as when episodes are generated</li>
          </ul>
          <p className="mt-2">
            When you use the Poddit Chrome extension, we collect only the page URL and title of
            pages you actively choose to save. The extension does not passively monitor your
            browsing activity.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">How We Use Your Data</h2>
          <p>Your data is used to:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-stone-400">
            <li>Generate your personalized audio episodes</li>
            <li>Improve the Poddit platform and user experience</li>
            <li>Send notifications about your episodes (via SMS or email, if opted in)</li>
            <li>Provide customer support and respond to feedback</li>
          </ul>
          <p className="mt-2">
            We do not use your data for advertising or sell it to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Third-Party Services</h2>
          <p>
            To provide Poddit&apos;s core functionality, your submitted content is processed by:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-stone-400">
            <li><strong className="text-stone-300">Anthropic (Claude)</strong> &mdash; for researching and synthesizing episode content</li>
            <li><strong className="text-stone-300">ElevenLabs</strong> &mdash; for text-to-speech audio generation</li>
            <li><strong className="text-stone-300">OpenAI (Whisper)</strong> &mdash; for voice note transcription</li>
            <li><strong className="text-stone-300">Cloudflare R2</strong> &mdash; for audio file storage</li>
            <li><strong className="text-stone-300">Twilio</strong> &mdash; for SMS notifications</li>
          </ul>
          <p className="mt-2">
            These services process your data solely to fulfill their respective functions.
            We do not sell, trade, or transfer your data to any other third parties.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Data Storage &amp; Security</h2>
          <p>
            Your data is stored on secure servers hosted by Railway. Audio files are stored on
            Cloudflare R2. We use industry-standard security measures including encrypted
            connections (HTTPS), secure authentication, and access controls to protect your data.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Chrome Extension Permissions</h2>
          <ul className="list-disc list-inside space-y-1 text-stone-400">
            <li><strong className="text-stone-300">activeTab</strong> &mdash; reads the current tab&apos;s URL and title only when you click Save</li>
            <li><strong className="text-stone-300">storage</strong> &mdash; saves your server URL locally so you don&apos;t have to re-enter it</li>
            <li><strong className="text-stone-300">host_permissions</strong> &mdash; sends saved links to your Poddit server</li>
          </ul>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-stone-400">
            <li>Delete any signal from your queue at any time</li>
            <li>Request deletion of your account and all associated data</li>
            <li>Opt out of SMS or email notifications</li>
            <li>Uninstall the Chrome extension to stop extension-based data collection</li>
          </ul>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify you of any
            material changes by posting the updated policy on this page with a revised date.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold mb-2">Contact</h2>
          <p>
            If you have questions about this privacy policy, contact us at{' '}
            <a href="mailto:Hello@poddit.com" className="text-teal-400 hover:text-teal-300 transition-colors">
              Hello@poddit.com
            </a>.
          </p>
          <p className="mt-2 text-stone-500 text-xs">
            Heathen Digital LLC
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-stone-800/50 flex items-center justify-between">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">
          &larr; Back to Poddit
        </Link>
        <Link href="/terms" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">
          Terms of Service &rarr;
        </Link>
      </div>
    </main>
  );
}
