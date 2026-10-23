// For each tab showing the DM Screen, remove the headers that forbid framing (X-Frame-Options and
// Content-Security-Policy) from frames loaded inside that tab only. Other tabs are untouched, and the
// rule goes away when the tab closes.
const BASE = 1000;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'dm-screen' || !sender.tab) return;
  const tabId = sender.tab.id;
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [BASE + tabId],
    addRules: [{
      id: BASE + tabId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
        ],
      },
      condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
    }],
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BASE + tabId] });
});
