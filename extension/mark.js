// Tell the DM Screen page the helper is here, and ask the background to open up frames in this tab.
document.documentElement.dataset.frameHelper = '1';
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.dataset.app === 'dm-screen') {
    chrome.runtime.sendMessage({ type: 'dm-screen' });
  }
});
