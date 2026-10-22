# Masti CRM helper

A small Chrome extension. When someone presses **Log in for me** in the CRM (Settings → Portal logins), the helper
collects the portal's saved ID and password from the CRM with a one-time ticket, opens the portal and types them in.
Staff never see them. The full design is in [docs/decisions/0024-portal-logins.md](../docs/decisions/0024-portal-logins.md).

It needs no setup per portal: it finds the login boxes the way Chrome's own password filling does. If a portal asks
for letters (a captcha), it fills the rest and leaves the letters to the person.

## Build it

```
cd Helper
npm install
npm run build
```

The extension is the `Helper/dist` folder.

## Load it in Chrome (development)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Press **Load unpacked** and choose the `Helper/dist` folder.
3. Check the ID on its card is `cbgfmlcnmcldkginifhpfcgpgfclmhfg`. It must be in `PORTAL_HELPER_IDS` in `Backend/.env`.
4. After every `npm run build`, press the reload arrow on the helper's card.

**While the helper is installed, Chrome stops offering to save passwords in that profile.** Otherwise "Save password?"
would hand a portal's password to whoever clicked it. Remove the helper and the offer comes back. Use a separate
Chrome profile for testing if you'd rather keep it.

The CRM pages that may talk to the helper are listed under `externally_connectable` in `manifest.json`: `localhost`,
`127.0.0.1` and `portal.localhost` for development. The build for the office PCs lets only Masti's own CRM address talk
to it (below).

## For the office PCs

```
npm run build:store -- --crm https://<Masti's CRM address>
```

This writes `dist-store/`, the helper as it's uploaded to the Chrome Web Store: the CRM at that address is the only page
that may talk to it, and the development key is left out, because the store gives the helper its own ID. The office PCs
install it from there. [office-pc/README.md](office-pc/README.md) is the whole setup for Masti's IT person, with
`office-pc/Set-ChromeRules.ps1`, which sets each PC's Chrome rules.

## Try it on pretend portals

```
npm run serve:test-portals
```

The pretend portals are at http://localhost:5199. In the CRM, add a portal with the address
`http://localhost:5199/plain.html`, the ID `test-agent` and the password `Test-Pass-2026!`, then press **Log in for me**.
The other pages show the other cases: an agency code, letters to type, a "Show password" eye (the helper empties the
password the moment it's shown), a form drawn late, a page with no login, and a login that moved to another address.

## Check it

```
npm test
npm run typecheck
```

`test/fill.test.ts` checks the box-finding on many kinds of login page, and `test/fillReact.test.tsx` on a React form.
`test/logIn.test.ts` covers a whole press with stand-ins for Chrome, and `test/manifest.test.ts` the permissions and the
Chrome Web Store build.

## Files

| File | What it does |
|---|---|
| `src/background.ts` | The service worker: answers the CRM page's messages |
| `src/logIn.ts` | One press: collect the login, open the portal, type it in, answer |
| `src/fill.ts` | `fillLogin`, which runs inside the portal's page. It is sent there as text, so it must stand alone |
| `src/passwordSaving.ts` | Switches off Chrome's "Save password?" offer |
| `src/protocol.ts` | The messages between the CRM page and the helper |
| `scripts/storeManifest.ts` | The manifest made fit for the Chrome Web Store, for the CRM's address (Node runs it as it is) |
| `scripts/build-store.mjs` | `npm run build:store`: writes `dist-store/` |
| `office-pc/` | The office PCs' Chrome rules (`Set-ChromeRules.ps1`) and the setup guide |
