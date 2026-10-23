# Setting up the office PCs for "Log in for me"

For Masti's IT person, and for us at go-live. The design is in
[docs/decisions/0024-portal-logins.md](../../docs/decisions/0024-portal-logins.md) (component 4).

Staff press **Log in for me** in the CRM, and the Masti CRM helper, a small Chrome extension, types the portal's saved
ID and password for them. On the office PCs Chrome is set so that:
- the helper is always installed, and staff can't remove it or switch it off;
- the developer tools, remote debugging and the `chrome://net-export` traffic recorder are off, so nobody can read a
  password the helper typed;
- Chrome never offers to save a password;
- no other extension can be added (some exist just to show passwords), except the ones Masti needs.

The helper itself draws the portal's ID and password boxes as dots, even when a portal's own "show password" eye is
pressed, and stops them being copied.

## Before you start (⚠️ from Masti)

| What | Why |
|---|---|
| The CRM's address, e.g. `https://crm.mastitravels.in` | Only that address may talk to the helper |
| A Google account of Masti's for the Chrome Web Store, and its one-time US$5 developer fee | The helper is published there, unlisted, under Masti's name (Masti owns it) |
| A privacy policy web page on Masti's site | The Chrome Web Store asks for one: the helper handles passwords |
| The other Chrome extensions the staff need, with their IDs | Every other extension is blocked (M50) |
| The office PCs run Windows and Chrome; nobody on staff has an administrator account | The rules are Windows settings that an administrator could undo (M50) |

## 1. Publish the helper (once)

1. On a PC with the code, build the helper for Masti's address:
   ```
   cd Helper
   npm install
   npm run build:store -- --crm https://crm.mastitravels.in
   ```
2. Open `Helper/dist-store`, select every file inside it, and zip them (right-click → Send to → Compressed (zipped)
   folder).
3. In the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), signed in with
   Masti's account, add a new item and upload the zip.
4. Fill in the listing:
   - **Visibility:** Unlisted. Only someone with the link can find it.
   - **Single purpose:** "Logs Masti's staff in to company portals from the Masti CRM without showing them the
     passwords."
   - **Why each permission:**
     - `scripting`: to type the login into the portal's page;
     - `privacy`: to switch off Chrome's password saving;
     - access to all sites: the portals are many, and listed in the CRM.
   - **Data:** it handles authentication information, only for that purpose, and keeps, sells and shares none.
   - **Privacy policy:** Masti's page.
5. Submit it for review, which can take a few days. Then copy the item's ID: 32 letters, on the item's page.

## 2. Tell the CRM the helper's ID

In `Backend/.env` on Masti's server, set `PORTAL_HELPER_IDS` to that ID, then restart the CRM.

## 3. Set up each office PC

1. Copy `Set-ChromeRules.ps1` (this folder) to the PC.
2. Open **PowerShell as administrator** (right-click it, Run as administrator), go to the folder, and run:
   ```
   powershell -ExecutionPolicy Bypass -File .\Set-ChromeRules.ps1 -HelperId <the helper's ID>
   ```
   If staff need other extensions, add them: `-AllowExtensions <ID>,<ID>`. To see what it would change without changing
   anything, add `-WhatIf`.
3. Close every Chrome window and open Chrome again.
4. Check:
   - `chrome://policy` lists the rules, all OK;
   - `chrome://extensions` shows **Masti CRM helper**, installed by your administrator, with no Remove button;
   - F12 opens nothing, and `chrome://net-export` is blocked;
   - in the CRM, **Settings → Portal logins → Log in for me** opens a portal logged in;
   - on a portal with a "show password" eye, pressing it still shows dots, and the ID box can't be copied.

## Later

- **A new version of the helper:** raise `version` in `Helper/manifest.json`, run `build:store` again and upload the new
  zip as an update. The office PCs update by themselves within a few hours.
- **Taking a PC out of it:** run the same command with `-Remove` at the end.
- **If Masti uses Edge, or the PCs are in a company domain (M50),** tell us. Edge needs its own store listing and
  rules; in a domain the same rules can go out by Group Policy instead.
