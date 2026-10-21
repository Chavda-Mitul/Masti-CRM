import { fillLogin } from "./fill.js";
import { crmPageMatcher, handleMessage, type Browser } from "./logIn.js";
import { turnOffPasswordSaving } from "./passwordSaving.js";

// The Masti CRM helper's service worker (docs/decisions/0024-portal-logins.md). Only the CRM's pages, listed in the
// manifest's externally_connectable, can message it; no other extension can. It keeps nothing: each press's ID and
// password live only while that press runs.

const manifest = chrome.runtime.getManifest();
const isCrmPage = crmPageMatcher(manifest.externally_connectable?.matches ?? []);

const browser: Browser = {
  fetch: (url, init) => fetch(url, init),
  async createTab(url) {
    return (await chrome.tabs.create({ url, active: true })).id;
  },
  async getTab(id) {
    try {
      return await chrome.tabs.get(id);
    } catch {
      return undefined;
    }
  },
  async focusTab(id) {
    try {
      await chrome.tabs.update(id, { active: true });
    } catch {
      // The CRM tab was closed: nothing to bring back.
    }
  },
  async inject(tabId, args) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: fillLogin, args });
    return result?.result;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

// Registered at the top, so a message that wakes the worker isn't missed. Not async, and returning true, so Chrome keeps
// the answer channel open until the press is done.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, browser, isCrmPage, manifest.version).then(sendResponse, () => sendResponse({ outcome: "FAILED" }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => void turnOffPasswordSaving(chrome.privacy.services.passwordSavingEnabled));
chrome.runtime.onStartup.addListener(() => void turnOffPasswordSaving(chrome.privacy.services.passwordSavingEnabled));
