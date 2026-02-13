// Background service worker
// Handles context menu and keyboard shortcut (future)
chrome.runtime.onInstalled.addListener(() => {
  console.log('Poddit extension installed');
});
