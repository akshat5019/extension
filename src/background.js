chrome.runtime.onInstalled.addListener(() => {
  // Prevent page content scripts from reading stored resume/profile data directly.
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
