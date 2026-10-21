// Types a portal's ID and password into its login page (docs/decisions/0024-portal-logins.md).

/** What fillLogin can answer. */
export type FillOutcome = "SUBMITTED" | "WAITING_FOR_STAFF" | "NO_LOGIN_BOXES" | "ADDRESS_CHANGED" | "FAILED";

export interface FillLoginArgs {
  loginId: string;
  password: string;
}

/**
 * Runs inside the portal's page: chrome.scripting.executeScript sends it there as text, so it must stand alone, with no
 * imports and nothing from outside its own body. It never throws: every path ends in an outcome.
 *
 * No per-portal setup: it finds the boxes the way a browser's password filling does. The login form is the one with
 * exactly one visible password box (a sign-up form has two); the ID box is the visible text box just before it (one
 * marked autocomplete="username" first). The password only ever goes into a password box. With letters to type (a
 * captcha) it fills both boxes and leaves the rest to the staff member; otherwise it presses the form's login button.
 *
 * @param allowedOrigins where this page may be: the portal's saved address (and its https version).
 * @param waitMs how long to wait for a page that draws its login form late.
 */
export async function fillLogin(login: FillLoginArgs, allowedOrigins: string[], waitMs: number): Promise<FillOutcome> {
  const BANNER_ID = "masti-crm-helper-banner";
  const TEXT_TYPES = ["text", "email", "tel", "number"];
  const GOOD_BUTTON = /log\s*-?\s*in|sign\s*-?\s*in|submit|continue|proceed/i;
  const BAD_BUTTON = /forgot|reset|register|sign\s*-?\s*up|create|new\s*user|cancel|clear|back|help|close|otp/i;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const visible = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden || el.closest('[aria-hidden="true"]')) return false;
    if (el instanceof HTMLInputElement && el.type === "hidden") return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    // Pages laid out by a real browser: a box with no size isn't there. (A test page has no layout at all.)
    if (document.documentElement.getBoundingClientRect().width > 0) {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
    }
    return true;
  };

  const labelOf = (el: Element): string => {
    const byFor = el.id ? [...document.querySelectorAll("label")].find((label) => label.htmlFor === el.id) : undefined;
    return (byFor ?? el.closest("label"))?.textContent ?? "";
  };

  /** Everything a person or a page says about an element, in lower case. */
  const describe = (el: Element): string =>
    [
      el.id,
      el.getAttribute("name"),
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("alt"),
      el.getAttribute("autocomplete"),
      el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button") ? el.value : "",
      el.tagName === "INPUT" ? labelOf(el) : el.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  const isAfter = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  const isTextBox = (el: Element): el is HTMLInputElement =>
    el instanceof HTMLInputElement && TEXT_TYPES.includes(el.type) && !el.disabled && visible(el) && !/captcha|search/.test(describe(el));

  /** The login form: one visible password box, and a text box before it. */
  const findLogin = () => {
    const passwords = [...document.querySelectorAll("input")].filter((el) => el.type === "password" && !el.disabled && visible(el));
    const byForm = new Map<HTMLFormElement | null, HTMLInputElement[]>();
    for (const box of passwords) byForm.set(box.form, [...(byForm.get(box.form) ?? []), box]);
    for (const [form, boxes] of byForm) {
      // Two password boxes: a sign-up or change-password form, not a login.
      if (boxes.length !== 1) continue;
      const passwordBox = boxes[0]!;
      const before = [...(form ?? document).querySelectorAll("input")].filter((el) => isTextBox(el) && isAfter(el, passwordBox));
      if (before.length === 0) continue;
      const idBox = before.find((el) => /username|email/.test(el.getAttribute("autocomplete") ?? "")) ?? before[before.length - 1]!;
      return { form, idBox, passwordBox };
    }
    return null;
  };

  /** Letters to type: the box for them if there is one, true if there's only a widget, null if none. */
  const findCaptcha = (scope: ParentNode, passwordBox: HTMLInputElement, idBox: HTMLInputElement): HTMLInputElement | true | null => {
    const inputs = [...scope.querySelectorAll("input")].filter((el) => el !== passwordBox && el !== idBox && !el.disabled && visible(el));
    const box = inputs.find((el) => /captcha/.test(describe(el)));
    if (box) return box;
    const image = [...scope.querySelectorAll("img")].find(
      (el) => visible(el) && /captcha/i.test([el.id, el.className, el.getAttribute("src"), el.getAttribute("alt")].join(" ")),
    );
    const widget = [...document.querySelectorAll("iframe, [data-sitekey]")].find((el) => {
      if (!visible(el)) return false;
      const src = el.getAttribute("src") ?? "";
      if (el.tagName === "IFRAME" && !/recaptcha|hcaptcha|turnstile/i.test(src)) return false;
      // An invisible reCAPTCHA (v3) asks nothing of anyone.
      return !/size=invisible/.test(src) && el.getAttribute("data-size") !== "invisible";
    });
    if (!image && !widget) return null;
    return inputs.find((el) => el.type !== "password" && TEXT_TYPES.includes(el.type) && !el.value && isAfter(passwordBox, el)) ?? true;
  };

  /** The form's login button: says log in or sign in, or is its only submit button; never "Forgot password?" or "Register". */
  const findButton = (form: HTMLFormElement | null, passwordBox: HTMLInputElement): HTMLElement | null => {
    const scope: ParentNode = form ?? document;
    const buttons = [...scope.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="image"], input[type="button"], [role="button"], a')].filter(
      (el) => visible(el) && !(el as HTMLButtonElement).disabled && !BAD_BUTTON.test(describe(el)),
    );
    const named = buttons.filter((el) => GOOD_BUTTON.test(describe(el)));
    const after = named.filter((el) => isAfter(passwordBox, el));
    if (after[0] ?? named[0]) return after[0] ?? named[0]!;
    if (!form) return null;
    const submits = buttons.filter(
      (el) => (el instanceof HTMLButtonElement && el.type === "submit") || (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image")),
    );
    return submits.length === 1 ? submits[0]! : null;
  };

  /** Types into a box so the page's own scripts (React, Angular…) notice, as if a person had. */
  const type = (box: HTMLInputElement, value: string) => {
    box.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(box, value);
    else box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    box.blur();
  };

  /** A note at the top of the portal's page, in the CRM's colours, out of the page's own styles' reach. */
  const showBanner = (text: string) => {
    document.getElementById(BANNER_ID)?.remove();
    const host = document.createElement("div");
    host.id = BANNER_ID;
    host.dataset.message = text;
    host.style.cssText = "all:initial;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;";
    const note = document.createElement("div");
    note.setAttribute("role", "status");
    note.style.cssText =
      "display:flex;gap:12px;align-items:center;max-width:520px;padding:12px 16px;border:2px solid #1e5aa8;border-radius:14px;" +
      "background:#fbf8f3;color:#1f2a37;font:500 15px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);";
    const name = document.createElement("strong");
    name.textContent = "Masti CRM";
    name.style.color = "#1e5aa8";
    const words = document.createElement("span");
    words.textContent = text;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.style.cssText = "border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#1f2a37;";
    close.addEventListener("click", () => host.remove());
    note.append(name, words, close);
    host.attachShadow({ mode: "closed" }).append(note);
    (document.body ?? document.documentElement).append(host);
  };

  try {
    if (!allowedOrigins.includes(location.origin)) return "ADDRESS_CHANGED";

    let found = findLogin();
    for (let waited = 0; !found && waited < waitMs; waited += 150) {
      await sleep(150);
      found = findLogin();
    }
    if (!found) {
      showBanner("Masti CRM couldn't log in here by itself. Your HOD can see this on Portal logins.");
      return "NO_LOGIN_BOXES";
    }

    const { form, idBox, passwordBox } = found;
    type(idBox, login.loginId);
    type(passwordBox, login.password);

    const captcha = findCaptcha(form ?? document, passwordBox, idBox);
    if (captcha) {
      if (captcha !== true) captcha.focus();
      showBanner("Type the letters you see, then press Login.");
      return "WAITING_FOR_STAFF";
    }

    const button = findButton(form, passwordBox);
    if (button) button.click();
    else if (form) form.requestSubmit();
    else {
      showBanner("Press the Login button to finish.");
      return "WAITING_FOR_STAFF";
    }
    return "SUBMITTED";
  } catch {
    return "FAILED";
  }
}
