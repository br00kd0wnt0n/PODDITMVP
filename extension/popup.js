// ── Defaults ──
const DEFAULT_SERVER = 'https://poddit-mvp.up.railway.app';

// ── State ──
let serverUrl = '';
let apiKey = '';

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings (with sensible defaults)
  const settings = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  serverUrl = settings.serverUrl || DEFAULT_SERVER;
  apiKey = settings.apiKey || '';
  document.getElementById('serverUrl').value = serverUrl;
  document.getElementById('apiKey').value = apiKey;

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('pageTitle').textContent = tab.title || 'Untitled';
    document.getElementById('pageUrl').textContent = tab.url || '';
  }

  // Event listeners
  document.getElementById('sendPage').addEventListener('click', () => sendPage(tab));
  document.getElementById('sendTopic').addEventListener('click', sendTopic);
  document.getElementById('toggleSettings').addEventListener('click', toggleSettings);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  // Enter key in topic input
  document.getElementById('topicInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTopic(); }
  });
});

// ── Actions ──
async function sendPage(tab) {
  if (!checkSettings()) return;
  const btn = document.getElementById('sendPage');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await capture({ url: tab.url, title: tab.title, source: 'extension' });
    showStatus('success', 'Added to your Poddit queue');
    btn.textContent = 'Sent!';
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    showStatus('error', err.message);
    btn.disabled = false;
    btn.textContent = 'Poddit this page';
  }
}

async function sendTopic() {
  if (!checkSettings()) return;
  const input = document.getElementById('topicInput');
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('sendTopic');
  btn.disabled = true;

  try {
    await capture({ text, source: 'extension' });
    showStatus('success', 'Topic added to your queue');
    input.value = '';
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    showStatus('error', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ── API ──
async function capture(data) {
  const res = await fetch(`${serverUrl}/api/capture/extension`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ── Settings ──
function checkSettings() {
  if (!serverUrl || !apiKey) {
    showStatus('error', 'Set your server URL and API key in Settings');
    document.getElementById('settingsPanel').style.display = 'block';
    return false;
  }
  return true;
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function saveSettings() {
  serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
  apiKey = document.getElementById('apiKey').value.trim();
  await chrome.storage.sync.set({ serverUrl, apiKey });
  showStatus('success', 'Settings saved');
}

// ── UI ──
function showStatus(type, message) {
  const el = document.getElementById('status');
  el.className = `status ${type}`;
  el.textContent = message;
}
