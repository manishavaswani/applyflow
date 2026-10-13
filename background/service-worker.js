/* ApplyFlow — background service worker (MV3) / event page (Firefox MV3)
   Deliberately minimal and fully self-contained (no importScripts, so it
   works in both Chrome MV3 service workers and Firefox MV3 event pages).
   No network access, no analytics — the whole extension is local-only. */
"use strict";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Open the profile manager on first install so the user can set up.
    chrome.runtime.openOptionsPage
      ? chrome.runtime.openOptionsPage()
      : chrome.tabs.create({ url: chrome.runtime.getURL("profile/profile.html") });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "applyflow:openOptions") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("profile/profile.html") });
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
