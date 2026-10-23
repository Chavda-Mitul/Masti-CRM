import type { FillLoginArgs, FillOutcome } from "./fill.js";
import { TICKET_PATTERN, type LoginResponse, type Outcome, type PingResponse } from "./protocol.js";

// One press of "Log in for me" inside the helper (docs/decisions/0024-portal-logins.md): collect the login with the
// ticket, open the portal, type it in, and say what happened. Chrome's APIs come in as `Browser`, so tests can stand in
// for them. The ID and password live only in this function's variables; nothing is stored.

/** The bits of Chrome a press uses. background.ts passes the real ones. */
export interface Browser {
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** Opens the portal in a new tab, in front; its id. */
  createTab(url: string): Promise<number | undefined>;
  /** The tab, or undefined once it's closed. */
  getTab(id: number): Promise<{ status?: string; url?: string } | undefined>;
  /** Brings the CRM's tab back to the front, to show what went wrong. */
  focusTab(id: number): Promise<void>;
  /**
   * The helper itself and every extension and app Chrome has, so other password-reading extensions can be caught, plus
   * the developer switch (`enforceInDev`, set in the popup) that turns the check on while the helper is unpacked.
   */
  extensionsInfo(): Promise<{ self: ExtensionInfo; all: ExtensionInfo[]; enforceInDev: boolean }>;
  /** Adds the helper's own CSS to the tab's page, as the person's own (the page can't override it). */
  insertCss(tabId: number, css: string): Promise<void>;
  /** Runs fillLogin in the tab's page and returns what it answered. */
  inject(tabId: number, args: [FillLoginArgs, string[], number]): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** A whole press, from ticket to answer. Keeps the service worker within its 30-second idle limit by polling. */
const TOTAL_MS = 50_000;
const REDEEM_MS = 10_000;
const POLL_MS = 500;
/** How long fillLogin waits for a login form drawn late. */
const FILL_WAIT_MS = 8_000;

/**
 * Draws the boxes fillLogin marks (the ID and password) as dots, whatever the portal's own CSS or "show password" eye
 * says, and stops their text being selected. Added as the person's CSS, which beats the page's, and which the page's
 * security rules (CSP) can't block.
 */
export const HIDE_CSS =
  "[data-masti-crm-hidden]{-webkit-text-security:disc !important;-webkit-user-select:none !important;user-select:none !important}";

const FILL_OUTCOMES: readonly string[] = ["SUBMITTED", "WAITING_FOR_STAFF", "NO_LOGIN_BOXES", "ADDRESS_CHANGED", "FAILED"] satisfies FillOutcome[];

/** The bit of chrome.management.ExtensionInfo the helper reads. */
export interface ExtensionInfo {
  id: string;
  name: string;
  enabled: boolean;
  /** "extension", "theme", "hosted_app", … — only a real extension can read the page. */
  type: string;
  /** "admin" (installed by Masti's Chrome rules), "normal", "development", "sideload", "other". */
  installType: string;
}

/**
 * Other extensions could read the ID and password the helper types, so the office PCs block them (component 4). As a
 * second guard, the helper itself won't type while one is on. Which ones block:
 * - the helper is left out, and so are themes and apps (only an extension runs in the page);
 * - an extension Masti's own Chrome rules installed (`installType: "admin"`) is allowed: that's how Masti says yes to one;
 * - a switched-off extension is ignored.
 * While the helper is loaded unpacked for development (`installType: "development"`), nothing blocks unless the popup's
 * `enforceInDev` switch is on: that's the building PC, not an office one. The office build always checks.
 */
export function blockingExtensionNames(self: ExtensionInfo, all: ExtensionInfo[], enforceInDev = false): string[] {
  if (self.installType === "development" && !enforceInDev) return [];
  return all
    .filter((e) => e.id !== self.id && e.enabled && e.type === "extension" && e.installType !== "admin")
    .map((e) => e.name);
}

/** The CRM pages that may ask, from the manifest's externally_connectable patterns ("http://localhost/*": any port). */
export function crmPageMatcher(patterns: string[]): (origin: string) => boolean {
  const allowed = patterns.flatMap((pattern) => {
    const match = /^(https?):\/\/([^/:*]+)\//.exec(pattern);
    return match ? [{ protocol: `${match[1]}:`, hostname: match[2]! }] : [];
  });
  return (origin) => {
    try {
      const url = new URL(origin);
      return allowed.some((a) => a.protocol === url.protocol && a.hostname === url.hostname);
    } catch {
      return false;
    }
  };
}

function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function originOf(raw: string | undefined): string | null {
  try {
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

/** Waits for the tab to finish opening; undefined if it closes or takes too long. */
async function loaded(tabId: number, deadline: number, browser: Browser) {
  while (browser.now() < deadline) {
    const tab = await browser.getTab(tabId);
    if (!tab) return undefined;
    if (tab.status === "complete" && tab.url && !tab.url.startsWith("about:")) return tab;
    await browser.sleep(POLL_MS);
  }
  return undefined;
}

/** A press: collect the login with the ticket, open the portal, type it in. */
export async function logIn(
  ticket: unknown,
  sender: { origin?: string; tabId?: number },
  browser: Browser,
  isCrmPage: (origin: string) => boolean,
): Promise<LoginResponse> {
  if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) return { outcome: "FAILED" };
  if (!sender.origin || !isCrmPage(sender.origin)) return { outcome: "FAILED" };

  // Before the ticket is spent: no typing while another extension that could read the login is on.
  try {
    const { self, all, enforceInDev } = await browser.extensionsInfo();
    const blockers = blockingExtensionNames(self, all, enforceInDev);
    if (blockers.length > 0) {
      const list = blockers.join(", ");
      return { outcome: "REFUSED", message: `Switch off your other Chrome extensions to use Log in for me: ${list}. Ask your HOD if you need one of them.` };
    }
  } catch {
    // Can't read the list (no management permission in development): carry on.
  }

  const deadline = browser.now() + TOTAL_MS;
  const back = async (outcome: Outcome): Promise<LoginResponse> => {
    if (sender.tabId !== undefined) await browser.focusTab(sender.tabId);
    return { outcome };
  };

  let login: { loginUrl?: unknown; loginId?: unknown; password?: unknown; extraLabel?: unknown; extra?: unknown };
  try {
    const res = await browser.fetch(`${sender.origin}/api/portal-helper/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(REDEEM_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: unknown };
    if (!res.ok) return { outcome: "REFUSED", ...(typeof body.message === "string" ? { message: body.message } : {}) };
    login = body as typeof login;
  } catch {
    return { outcome: "FAILED" };
  }
  const target = httpUrl(login.loginUrl);
  if (!target || typeof login.loginId !== "string" || typeof login.password !== "string") return { outcome: "FAILED" };
  // The saved address, and its https version: many portals move from http to https on their own.
  const allowed = [target.origin, ...(target.protocol === "http:" ? [`https://${target.host}`] : [])];
  const extra =
    typeof login.extraLabel === "string" && typeof login.extra === "string" ? { label: login.extraLabel, value: login.extra } : undefined;
  const args: [FillLoginArgs, string[], number] = [{ loginId: login.loginId, password: login.password, ...(extra ? { extra } : {}) }, allowed, FILL_WAIT_MS];

  let tabId: number | undefined;
  try {
    tabId = await browser.createTab(target.href);
  } catch {
    return back("FAILED");
  }
  if (tabId === undefined) return back("FAILED");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const tab = await loaded(tabId, deadline, browser);
    if (!tab) return back("DIDNT_OPEN");
    const origin = originOf(tab.url);
    if (!origin || !allowed.includes(origin)) return back("ADDRESS_CHANGED");
    try {
      // Before anything is typed. If it can't be added, fillLogin's own dots still hide the boxes.
      await browser.insertCss(tabId, HIDE_CSS).catch(() => undefined);
      const answer = await browser.inject(tabId, args);
      const outcome: Outcome = typeof answer === "string" && FILL_OUTCOMES.includes(answer) ? (answer as FillOutcome) : "FAILED";
      // The portal's own tab shows a note for these; for the rest the CRM tab comes back to say what happened.
      return outcome === "SUBMITTED" || outcome === "WAITING_FOR_STAFF" || outcome === "NO_LOGIN_BOXES" ? { outcome } : back(outcome);
    } catch {
      // The page moved on while we typed (a redirect): wait for the next one, once.
      if (attempt === 2) return back("FAILED");
      await browser.sleep(POLL_MS);
    }
  }
  return back("FAILED");
}

/** Everything the CRM page may ask. */
export async function handleMessage(
  message: unknown,
  sender: { origin?: string; tab?: { id?: number } },
  browser: Browser,
  isCrmPage: (origin: string) => boolean,
  version: string,
): Promise<PingResponse | LoginResponse> {
  const ask = (message ?? {}) as { type?: unknown; ticket?: unknown };
  if (ask.type === "ping") return { ok: true, version };
  if (ask.type === "login") {
    const from = { ...(sender.origin ? { origin: sender.origin } : {}), ...(sender.tab?.id !== undefined ? { tabId: sender.tab.id } : {}) };
    return logIn(ask.ticket, from, browser, isCrmPage);
  }
  return { outcome: "FAILED" };
}
