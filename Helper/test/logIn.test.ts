import { describe, expect, it } from "vitest";
import { blockingExtensionNames, crmPageMatcher, handleMessage, HIDE_CSS, type Browser, type ExtensionInfo } from "../src/logIn";

// One press inside the helper, with stand-ins for Chrome: collect the login, open the portal, type it in, answer.

const CRM = "http://portal.localhost:5340";
const TICKET = "A".repeat(43);
const LOGIN = { loginUrl: "https://france-visas.gouv.fr/login", loginId: "MASTI-AGENT-01", password: "Spring-Visa-2026!" };
const isCrmPage = crmPageMatcher(["http://localhost/*", "http://127.0.0.1/*", "http://portal.localhost/*"]);

interface Options {
  response?: Response;
  tabs?: ({ status?: string; url?: string } | undefined)[];
  inject?: (() => unknown)[];
  /** Adding the CSS fails. */
  cssFails?: boolean;
  /** What chrome.management says (default: only the helper, installed normally). */
  extensions?: { self: ExtensionInfo; all: ExtensionInfo[] };
  /** The popup's developer switch. */
  enforceInDev?: boolean;
  /** Reading the extension list throws. */
  extensionsFail?: boolean;
}

const SELF: ExtensionInfo = { id: "self", name: "Masti CRM helper", enabled: true, type: "extension", installType: "normal" };

/** A stand-in Chrome that records what the helper did. Tabs answer in turn; the last answer repeats. */
function fakeBrowser(options: Options = {}) {
  const done = { fetched: [] as [string, RequestInit][], opened: [] as string[], focused: [] as number[], injected: [] as unknown[], steps: [] as string[] };
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
    async extensionsInfo() {
      done.steps.push("extensionsInfo");
      if (options.extensionsFail) throw new Error("no management permission");
      return { ...(options.extensions ?? { self: SELF, all: [SELF] }), enforceInDev: options.enforceInDev ?? false };
    },
    async insertCss(tabId, css) {
      done.steps.push(`css ${tabId} ${css}`);
      if (options.cssFails) throw new Error("Cannot access contents of the page");
    },
    async inject(tabId, args) {
      done.steps.push(`inject ${tabId}`);
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

describe("blockingExtensionNames", () => {
  const ext = (o: Partial<ExtensionInfo>): ExtensionInfo => ({ id: "x", name: "X", enabled: true, type: "extension", installType: "normal", ...o });

  it("names the user-installed extensions that are on, and leaves out the rest", () => {
    const all = [
      SELF,
      ext({ id: "a", name: "Ad Blocker" }),
      ext({ id: "b", name: "Dev Peeker", installType: "development" }),
      ext({ id: "c", name: "Masti Tool", installType: "admin" }),
      ext({ id: "d", name: "Switched off", enabled: false }),
      ext({ id: "e", name: "A Theme", type: "theme" }),
    ];
    expect(blockingExtensionNames(SELF, all)).toEqual(["Ad Blocker", "Dev Peeker"]);
  });

  it("blocks nothing while the helper is unpacked for development, unless the popup switch is on", () => {
    const dev = { ...SELF, installType: "development" };
    const others = [dev, ext({ name: "Ad Blocker" })];
    expect(blockingExtensionNames(dev, others)).toEqual([]);
    expect(blockingExtensionNames(dev, others, true)).toEqual(["Ad Blocker"]);
  });
});

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

  it("adds the CSS that draws the ID and password as dots before typing, and types anyway if it can't", async () => {
    const { browser, done } = fakeBrowser();
    expect(await press(browser)).toEqual({ outcome: "SUBMITTED" });
    expect(done.steps).toEqual(["extensionsInfo", `css 7 ${HIDE_CSS}`, "inject 7"]);
    const failing = fakeBrowser({ cssFails: true });
    expect(await press(failing.browser)).toEqual({ outcome: "SUBMITTED" });
    expect(failing.done.steps).toEqual(["extensionsInfo", `css 7 ${HIDE_CSS}`, "inject 7"]);
  });

  it("won't type while another extension that could read the login is on, and doesn't spend the ticket", async () => {
    const other: ExtensionInfo = { id: "other", name: "Password Peeker", enabled: true, type: "extension", installType: "normal" };
    const { browser, done } = fakeBrowser({ extensions: { self: SELF, all: [SELF, other] } });
    const res = (await press(browser)) as { outcome: string; message?: string };
    expect(res.outcome).toBe("REFUSED");
    expect(res.message).toContain("Password Peeker");
    expect(done.fetched).toEqual([]);
    expect(done.opened).toEqual([]);
  });

  it("logs in when only Masti's own (admin) extensions are on, and when the list can't be read", async () => {
    const admin: ExtensionInfo = { id: "ok", name: "Masti Tool", enabled: true, type: "extension", installType: "admin" };
    const allowed = fakeBrowser({ extensions: { self: SELF, all: [SELF, admin] } });
    expect(await press(allowed.browser)).toEqual({ outcome: "SUBMITTED" });
    const noPerm = fakeBrowser({ extensionsFail: true });
    expect(await press(noPerm.browser)).toEqual({ outcome: "SUBMITTED" });
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
