// Service Worker for Pilgrim QuickFill for TTD (Manifest V3)

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Pilgrim QuickFill] Installed successfully.');
  } else if (details.reason === 'update') {
    console.log('[Pilgrim QuickFill] Updated to version', chrome.runtime.getManifest().version);
  }
});

// Route keyboard commands to the active tab's content script
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'fill_all') {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE_FILL', mode: 'auto' });
    } catch (e) {
      console.warn('[Pilgrim QuickFill] Content script not responding on active tab:', e);
    }
  } else if (command === 'fill_and_continue') {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE_FILL', mode: 'auto_continue' });
    } catch (e) {
      console.warn('[Pilgrim QuickFill] Content script not responding on active tab:', e);
    }
  }
});

// Handle messages from popup or content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'GET_EXTENSION_INFO') {
    sendResponse({
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name
    });
    return true;
  }
  return false;
});
