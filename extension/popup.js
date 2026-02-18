// ── Config ──
const SERVER_URL = 'https://app.poddit.com';

// ── State ──
let userEmail = '';
let inviteCode = '';

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  const settings = await chrome.storage.sync.get(['userEmail', 'inviteCode']);
  userEmail = settings.userEmail || '';
  inviteCode = settings.inviteCode || '';
  document.getElementById('userEmail').value = userEmail;
  document.getElementById('inviteCode').value = inviteCode;

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

  // Auto-show settings if not configured
  if (!userEmail || !inviteCode) {
    document.getElementById('settingsPanel').style.display = 'block';
  }
});

// ── Actions ──
async function sendPage(tab) {
  if (!checkSettings()) return;
  const btn = document.getElementById('sendPage');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await capture({ url: tab.url, title: tab.title });
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
    await capture({ text });
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
  const res = await fetch(`${SERVER_URL}/api/capture/extension`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      email: userEmail,
      inviteCode: inviteCode,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ── Settings ──
function checkSettings() {
  if (!userEmail || !inviteCode) {
    showStatus('error', 'Enter your Poddit email and invite code in Settings');
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
  userEmail = document.getElementById('userEmail').value.trim().toLowerCase();
  inviteCode = document.getElementById('inviteCode').value.trim();

  if (!userEmail || !inviteCode) {
    showStatus('error', 'Both email and invite code are required');
    return;
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    showStatus('error', 'Please enter a valid email address');
    return;
  }

  await chrome.storage.sync.set({ userEmail, inviteCode });
  showStatus('success', 'Settings saved');
}

// ── UI ──
function showStatus(type, message) {
  const el = document.getElementById('status');
  el.className = `status ${type}`;
  el.textContent = message;
}
