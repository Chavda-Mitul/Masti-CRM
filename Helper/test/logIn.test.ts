import { describe, expect, it } from "vitest";
import { crmPageMatcher, handleMessage, type Browser } from "../src/logIn";

// One press inside the helper, with stand-ins for Chrome: collect the login, open the portal, type it in, answer.

const CRM = "http://portal.localhost:5340";
const TICKET = "A".repeat(43);
const LOGIN = { loginUrl: "https://france-visas.gouv.fr/login", loginId: "MASTI-AGENT-01", password: "Spring-Visa-2026!" };
const isCrmPage = crmPageMatcher(["http://localhost/*", "http://127.0.0.1/*", "http://portal.localhost/*"]);

interface Options {
  response?: Response;
  tabs?: ({ status?: string; url?: string } | undefined)[];
  inject?: (() => unknown)[];
}

/** A stand-in Chrome that records what the helper did. Tabs answer in turn; the last answer repeats. */
function fakeBrowser(options: Options = {}) {
  const done = { fetched: [] as [string, RequestInit][], opened: [] as string[], focused: [] as number[], injected: [] as unknown[] };
  let clock = 0;
  let tabCall = 0;
  let injectCall = 0;
  const tabs = options.tabs ?? [{ status: "complete", url: LOGIN.loginUrl }];
  const browser: Browser = {
    async fetch(url, init) {
      done.fetched.push([url, init]);
      return options.response ?? new Response(JSON.stringify(LOGIN), { status: 200 });
    },
    async createTab(url) {
      done.opened.push(url);
      return 7;
    },
    async getTab() {
      return tabs[Math.min(tabCall++, tabs.length - 1)];
    },
    async focusTab(id) {
      done.focused.push(id);
    },
    async inject(_tabId, args) {
      done.injected.push(args);
      const answer = options.inject?.[Math.min(injectCall++, options.inject.length - 1)];
      return answer ? answer() : "SUBMITTED";
    },
    async sleep(ms) {
      clock += ms;
    },
    now: () => clock,
  };
  return { browser, done };
}

const press = (browser: Browser, ticket: unknown = TICKET, origin = CRM) =>
  handleMessage({ type: "login", ticket }, { origin, tab: { id: 3 } }, browser, isCrmPage, "0.1.0");

describe("the helper", () => {
  it("answers a ping with its version", async () => {
    const { browser } = fakeBrowser();
    expect(await handleMessage({ type: "ping" }, { origin: CRM }, browser, isCrmPage, "0.1.0")).toEqual({ ok: true, version: "0.1.0" });
  });

  it("collects the login from the CRM that asked, without cookies, then opens the portal and types it in", async () => {
    const { browser, done } = fakeBrowser();
    expect(await press(browser)).toEqual({ outcome: "SUBMITTED" });
    const [url, init] = done.fetched[0]!;
    expect(url).toBe(`${CRM}/api/portal-helper/redeem`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", body: JSON.stringify({ ticket: TICKET }) });
    expect(done.opened).toEqual([LOGIN.loginUrl]);
    expect(done.injected).toEqual([[{ loginId: LOGIN.loginId, password: LOGIN.password }, ["https://france-visas.gouv.fr"], 8000]]);
    expect(done.focused).toEqual([]);
  });

  it("passes on the server's refusal and opens nothing", async () => {
    const refused = new Response(JSON.stringify({ message: "Log in for me works only in the office." }), { status: 403 });
    const { browser, done } = fakeBrowser({ response: refused });
    expect(await press(browser)).toEqual({ outcome: "REFUSED", message: "Log in for me works only in the office." });
    expect(done.opened).toEqual([]);
  });

  it("types nothing when the portal opens at another address, and brings the CRM back", async () => {
    const { browser, done } = fakeBrowser({ tabs: [{ status: "complete", url: "https://login.example.com/sso" }] });
    expect(await press(browser)).toEqual({ outcome: "ADDRESS_CHANGED" });
    expect(done.injected).toEqual([]);
    expect(done.focused).toEqual([3]);
  });

  it("accepts the same portal moving from http to https", async () => {
    const http = new Response(JSON.stringify({ ...LOGIN, loginUrl: "http://www.hiaceindia.in/" }), { status: 200 });
    const { browser, done } = fakeBrowser({ response: http, tabs: [{ status: "complete", url: "https://www.hiaceindia.in/" }] });
    expect(await press(browser)).toEqual({ outcome: "SUBMITTED" });
    expect(done.injected[0]).toEqual([{ loginId: LOGIN.loginId, password: LOGIN.password }, ["http://www.hiaceindia.in", "https://www.hiaceindia.in"], 8000]);
  });

  it("gives up on a page that never finishes opening, or a tab that's closed", async () => {
    const slow = fakeBrowser({ tabs: [{ status: "loading", url: LOGIN.loginUrl }] });
    expect(await press(slow.browser)).toEqual({ outcome: "DIDNT_OPEN" });
    expect(slow.done.focused).toEqual([3]);
    const closed = fakeBrowser({ tabs: [undefined] });
    expect(await press(closed.browser)).toEqual({ outcome: "DIDNT_OPEN" });
  });

  it("tries once more when the page moves on while typing", async () => {
    const { browser, done } = fakeBrowser({
      inject: [
        () => {
          throw new Error("Frame with ID 0 was removed.");
        },
        () => "WAITING_FOR_STAFF",
      ],
    });
    expect(await press(browser)).toEqual({ outcome: "WAITING_FOR_STAFF" });
    expect(done.injected).toHaveLength(2);
  });

  it("refuses before asking the server: a bad ticket, a page that isn't the CRM, an address that isn't a web page", async () => {
    for (const [ticket, origin] of [["short", CRM], [TICKET, "https://evil.example"], [5, CRM]] as const) {
      const { browser, done } = fakeBrowser();
      expect(await press(browser, ticket, origin)).toEqual({ outcome: "FAILED" });
      expect(done.fetched).toEqual([]);
    }
    const script = new Response(JSON.stringify({ ...LOGIN, loginUrl: "javascript:alert(1)" }), { status: 200 });
    const { browser, done } = fakeBrowser({ response: script });
    expect(await press(browser)).toEqual({ outcome: "FAILED" });
    expect(done.opened).toEqual([]);
  });

  it("knows the CRM's pages by host, whatever the port", () => {
    expect(isCrmPage("http://localhost:5173")).toBe(true);
    expect(isCrmPage("http://portal.localhost:5340")).toBe(true);
    expect(isCrmPage("https://localhost:5173")).toBe(false);
    expect(isCrmPage("http://evil.localhost:5340")).toBe(false);
    expect(isCrmPage("not a url")).toBe(false);
  });
});
