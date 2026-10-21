// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { fillLogin } from "../src/fill";

// The page is https://portal.test/login (vitest.config.ts). happy-dom has no layout, so these check everything but sizes.

const ORIGIN = "https://portal.test";
const LOGIN = { loginId: "MASTI-AGENT-01", password: "Spring-Visa-2026!" };
const run = (waitMs = 0, allowed = [ORIGIN]) => fillLogin(LOGIN, allowed, waitMs);

const $ = <T extends Element = HTMLInputElement>(selector: string) => document.querySelector<T>(selector)!;
const banner = () => document.getElementById("masti-crm-helper-banner")?.dataset.message;

/** Counts the form's submissions, and stops them navigating. */
function countSubmits(form: HTMLFormElement = $<HTMLFormElement>("form")) {
  const sent: number[] = [];
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sent.push(1);
  });
  return sent;
}

function countEvents(box: HTMLInputElement) {
  const seen: string[] = [];
  for (const name of ["input", "change", "blur"]) box.addEventListener(name, () => seen.push(name));
  return seen;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("fillLogin", () => {
  it("types the ID and password the way a person would, and presses Login once", async () => {
    document.body.innerHTML = `
      <form><label>User ID <input id="user"></label><label>Password <input id="pass" type="password"></label>
      <button type="submit">Login</button></form>`;
    const sent = countSubmits();
    const idEvents = countEvents($("#user"));
    const passwordEvents = countEvents($("#pass"));
    expect(await run()).toBe("SUBMITTED");
    expect($("#user").value).toBe(LOGIN.loginId);
    expect($("#pass").value).toBe(LOGIN.password);
    expect(idEvents.sort()).toEqual(["blur", "change", "input"]);
    expect(passwordEvents.sort()).toEqual(["blur", "change", "input"]);
    expect(sent).toHaveLength(1);
    expect(banner()).toBeUndefined();
  });

  it("skips search boxes, hidden boxes, decoys and switched-off boxes", async () => {
    document.body.innerHTML = `
      <input id="search" type="search" placeholder="Search">
      <input id="site-search" name="q" placeholder="Search the site">
      <form>
        <input id="hidden" type="hidden" name="token">
        <input id="gone" style="display:none">
        <input id="ghost" style="visibility:hidden">
        <input id="aria" aria-hidden="true">
        <span hidden><input id="in-hidden"></span>
        <input id="user" name="username">
        <input id="off" disabled>
        <input id="pass" type="password">
        <input type="submit" value="Sign in">
      </form>`;
    countSubmits();
    expect(await run()).toBe("SUBMITTED");
    expect($("#user").value).toBe(LOGIN.loginId);
    for (const id of ["search", "site-search", "gone", "ghost", "aria", "in-hidden", "off"]) expect($(`#${id}`).value, id).toBe("");
  });

  it("prefers the box marked as the username, and takes email, phone and number boxes", async () => {
    document.body.innerHTML = `
      <form><input id="user" autocomplete="username"><input id="branch" placeholder="Branch"><input id="pass" type="password">
      <button>Log in</button></form>`;
    countSubmits();
    expect(await run()).toBe("SUBMITTED");
    expect($("#user").value).toBe(LOGIN.loginId);
    expect($("#branch").value).toBe("");

    for (const type of ["email", "tel", "number"]) {
      document.body.innerHTML = `<form><input id="user" type="${type}"><input id="pass" type="password"><button>Login</button></form>`;
      countSubmits();
      expect(await run(), type).toBe("SUBMITTED");
    }
  });

  it("puts the password only in a password box, and does nothing on a page without one", async () => {
    document.body.innerHTML = `<form><input id="a"><input id="b"><button>Login</button></form>`;
    const sent = countSubmits();
    expect(await run()).toBe("NO_LOGIN_BOXES");
    expect($("#a").value).toBe("");
    expect($("#b").value).toBe("");
    expect(sent).toHaveLength(0);
    expect(banner()).toMatch(/couldn't log in here by itself/);
  });

  it("uses the login form, not the sign-up form beside it, and never a form with two password boxes", async () => {
    document.body.innerHTML = `
      <form id="signup"><input id="new-user"><input id="new-pass" type="password"><input id="again" type="password"><button>Register</button></form>
      <form id="login"><input id="user"><input id="pass" type="password"><button>Sign in</button></form>`;
    countSubmits($<HTMLFormElement>("#login"));
    expect(await run()).toBe("SUBMITTED");
    expect($("#user").value).toBe(LOGIN.loginId);
    expect($("#new-user").value).toBe("");
    expect($("#new-pass").value).toBe("");

    document.body.innerHTML = `<form><input id="user"><input type="password"><input type="password"><button>Save</button></form>`;
    expect(await run()).toBe("NO_LOGIN_BOXES");
    expect($("#user").value).toBe("");
  });

  it("types nothing on a page at another address", async () => {
    document.body.innerHTML = `<form><input id="user"><input id="pass" type="password"><button>Login</button></form>`;
    expect(await run(0, ["https://france-visas.gouv.fr"])).toBe("ADDRESS_CHANGED");
    expect($("#user").value).toBe("");
    expect($("#pass").value).toBe("");
  });

  describe("letters to type (a captcha)", () => {
    it("fills both boxes, leaves the letters to the staff member, and says so", async () => {
      document.body.innerHTML = `
        <form><input id="user"><input id="pass" type="password">
        <img id="captchaImage" src="/captcha.png" alt="Code"><input id="code" name="txtCaptcha">
        <button>Login</button></form>`;
      const sent = countSubmits();
      expect(await run()).toBe("WAITING_FOR_STAFF");
      expect($("#user").value).toBe(LOGIN.loginId);
      expect($("#pass").value).toBe(LOGIN.password);
      expect(document.activeElement).toBe($("#code"));
      expect(sent).toHaveLength(0);
      expect(banner()).toBe("Type the letters you see, then press Login.");
    });

    it("spots an image captcha with an unnamed box, a reCAPTCHA box and a site-key widget", async () => {
      const pages = [
        `<form><input id="user"><input type="password"><img src="/images/captcha.jpg"><input id="letters"><button>Login</button></form>`,
        `<form><input id="user"><input type="password"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal"></iframe><button>Login</button></form>`,
        `<form><input id="user"><input type="password"><div class="h-captcha" data-sitekey="abc"></div><button>Login</button></form>`,
      ];
      for (const html of pages) {
        document.body.innerHTML = html;
        const sent = countSubmits();
        expect(await run(), html).toBe("WAITING_FOR_STAFF");
        expect(sent).toHaveLength(0);
      }
      document.body.innerHTML = pages[0]!;
      await run();
      expect(document.activeElement).toBe($("#letters"));
    });

    it("ignores an invisible reCAPTCHA, which asks nothing of anyone", async () => {
      document.body.innerHTML = `
        <form><input id="user"><input type="password"><button>Login</button></form>
        <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"></iframe></div>`;
      countSubmits();
      expect(await run()).toBe("SUBMITTED");
    });
  });

  it("waits for a login form drawn late, but not for ever", async () => {
    setTimeout(() => {
      document.body.innerHTML = `<form><input id="user"><input id="pass" type="password"><button>Login</button></form>`;
      countSubmits();
    }, 200);
    expect(await run(1000)).toBe("SUBMITTED");
    expect($("#pass").value).toBe(LOGIN.password);

    document.body.innerHTML = `<p>Loading…</p>`;
    expect(await run(300)).toBe("NO_LOGIN_BOXES");
  });

  it("fills a box that stays read-only until clicked", async () => {
    document.body.innerHTML = `<form><input id="user" readonly><input id="pass" type="password" readonly><button>Login</button></form>`;
    for (const box of [$("#user"), $("#pass")]) box.addEventListener("focus", () => box.removeAttribute("readonly"));
    countSubmits();
    expect(await run()).toBe("SUBMITTED");
    expect($("#user").value).toBe(LOGIN.loginId);
    expect($("#pass").value).toBe(LOGIN.password);
  });

  it("presses Login, never Forgot password or Register", async () => {
    document.body.innerHTML = `
      <form><input id="user"><input id="pass" type="password">
      <button type="button" id="forgot">Forgot password?</button><button type="button" id="register">Register</button>
      <button type="submit" id="login">Login</button></form>`;
    const clicked: string[] = [];
    for (const id of ["forgot", "register", "login"]) $<HTMLButtonElement>(`#${id}`).addEventListener("click", () => clicked.push(id));
    countSubmits();
    expect(await run()).toBe("SUBMITTED");
    expect(clicked).toEqual(["login"]);
  });

  it("works without a <form>: presses the nearest Sign in", async () => {
    document.body.innerHTML = `
      <a href="#" id="top">Sign in</a>
      <div><input id="user"><input id="pass" type="password"><div role="button" id="go">Sign in</div></div>`;
    const clicked: string[] = [];
    for (const id of ["top", "go"]) $<HTMLElement>(`#${id}`).addEventListener("click", (e) => (e.preventDefault(), clicked.push(id)));
    expect(await run()).toBe("SUBMITTED");
    expect(clicked).toEqual(["go"]);
  });

  it("answers even when the page breaks", async () => {
    document.body.innerHTML = `<form><input id="user"><input id="pass" type="password"><button id="login">Login</button></form>`;
    $<HTMLButtonElement>("#login").click = () => {
      throw new Error("The portal's own script failed");
    };
    expect(await run()).toBe("FAILED");
  });

  it("still works when sent to a page as text", async () => {
    const rebuilt = new Function(`return (${fillLogin.toString()})`)() as typeof fillLogin;
    document.body.innerHTML = `<form><input id="user"><input id="pass" type="password"><button>Login</button></form>`;
    countSubmits();
    expect(await rebuilt(LOGIN, [ORIGIN], 0)).toBe("SUBMITTED");
    expect($("#pass").value).toBe(LOGIN.password);
  });
});
