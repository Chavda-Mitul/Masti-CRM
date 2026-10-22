# 0024 · Portal logins: "Log in for me"

- **Status:** a trial, decided 21 Oct 2026 by the project lead. Component 1 (PR #67) and component 3, the button on the
  visa case (PR #86), are merged; component 2, scheduled password changes, is built on `feat/portal-password-schedule`.
  The approach goes to Shivanshu for approval once the trial passes (04 §C item 6, Q4). Component 4 follows.
- **Date:** 21 Oct 2026
- **Scope:** Settings → Portal logins (demo screen 28, PROJECT_KNOWLEDGE §12.19): the company's accounts on visa, airline
  and supplier portals, which staff log in to without seeing the ID or password. Answers R3 and Q4.

## Context

What Masti asked for:
- **Vimal, 30 Sep meeting:**
  - 6:54 PM: "a link, with our ID and password already set, that opens directly". If someone has no access to the
    system, they can't log in anywhere.
  - 8:19–8:22 PM: the same for the airline accounts. The HOD changes the password on the schedule, or "lock everything".
- **Written requirements:** a click-to-login button in the CRM, "never sharing the actual id password", and the same
  for ticketing accounts.
- **Contract (PID):** "Portal logins ('log in for me' without showing passwords, scheduled password changes,
  office-network only)".
- **The handover (04 §B):** the biggest technical unknown, so a spike comes first. It suggested a managed browser
  extension.

What we found on 20–21 Oct 2026:
- **Masti's bookmarks** (`bookmarks_20_10_2026.html`) have 61 links: 12 visa suppliers and 49 government e-visa sites.
  - Most e-visa sites are forms with no Masti account.
  - There are no airline accounts and no VFS Belgium or China portal.
  - So it isn't the real list of company logins (A8/A9, M49).
- **How often login pages change:** the Internet Archive's copies of the 6 pages that could be measured, since 2020:
  - no ID or password box was renamed in about 30 portal-years;
  - two logins moved to a new address (Udaan to udaanindia.in in 2023–24; Togo's site rebuilt);
  - 9 of the 12 supplier portals have no archive copies.

## Options considered

| Option | For | Against |
|---|---|---|
| 1. A plain "Open portal" link | Nothing to build or keep up | Staff see and type the passwords (CLAUDE.md rule 8) |
| **2. Our own Chrome helper (chosen)** | One button for staff. Everything stays in the CRM: who may use it, the office rule, the lock, the case in the log, one switch-off for leavers. Masti owns it; no running cost | A second piece of software to build and keep working; works only on set-up PCs; a technical person could dig out a password |
| 3. A password manager (Bitwarden, 1Password, Zoho Vault) | Its company keeps the filling working | A second account and master password per person; leavers switched off in two places; no overdue lock or case in the log; a yearly bill in dollars; no more secret than option 2 |
| 4. A remote browser on Masti's server | The password never reaches the staff PC | A heavy server; printing and uploading scans get awkward; slow |

Option 3's prices on 21 Oct 2026, for about 12 users, paid yearly:

| Product | Price | About |
|---|---|---|
| Bitwarden Teams | $4 per user per month | ₹55,000 a year |
| Bitwarden Enterprise (can run on Masti's own server) | $6 per user per month | ₹83,000 a year |
| 1Password Business | about $9 per user per month | ₹1,24,000 a year |
| Zoho Vault | ₹250–600 per user per month | needs Zoho's quote |

Bitwarden and 1Password both call their hidden passwords fill-only and not a complete security boundary.

## Decisions (project lead, 21 Oct 2026)

1. **Option 2, as a trial on its own branch.** It is kept if the trial passes (below).
2. **No per-portal code.** The helper finds the login boxes by itself, the way a browser's password filling does:
   - the form with exactly one visible password box, and the visible text box before it;
   - the portal list and addresses live in the CRM.

   A login that moves to a new address needs the HOD to edit the link: that check against fake pages stays a
   person's. A portal whose login the helper can't handle gets no special code.
3. **Staff aren't technical.** They press one button. Every message is in plain words. Staff never install, sign in to
   or fix anything: the office PCs are set up once (component 4).
4. **Who:**
   - The Head and the portal's department's HOD add, change and remove portals (only HODs reset portal passwords,
     rule 6).
   - The Head, that HOD and the staff on the portal's list use it, while those staff are still in the department.
   - In component 1, staff press it on Settings → Portal logins, where they see only their portals.
5. **Office network:**
   - "Log in for me" works only from the office IP list (`officeNetwork.allow`), whatever the CRM-wide switch says,
     for everyone, the Head included.
   - While the list is empty (Masti's addresses aren't known, M19), it works anywhere, and managers see "Masti's
     office internet addresses aren't set yet".
6. **The secret:**
   - The ID and password are sealed with AES-256-GCM under `PORTAL_VAULT_KEY`, a key outside the database.
   - Each portal's blob is bound to its id (`portal-login:<id>`).
   - Removing a portal wipes them.
   - **The §16.5 rule is narrowed:** the secret goes only to the CRM helper, at the moment of login, and never in any
     answer to a CRM page.
7. **Four components, one at a time:**
   1. this record's component 1;
   2. scheduled password changes and "Locked" when overdue;
   3. the button on visa Step 3, with the case in the log;
   4. the office-PC setup kit.

   The ticket desk's check-in list uses it in Stage 2.

## How a press works

1. The page (`Frontend/src/lib/portalHelper.ts`) finds the helper with `chrome.runtime.sendMessage(<helper id>, ping)`.
   Chrome offers that only on the pages the helper lists. No helper → "Log in for me works only on the office computers."
2. `POST /api/portal-logins/:id/open` (session) checks the person may use the portal from here, and that it isn't locked
   (component 2). It makes a **ticket**: 32 random bytes, stored only as its sha256, valid for 30 seconds and once.
3. The page hands the ticket to the helper. The helper `POST`s it to `/api/portal-helper/redeem`, an API route
   without a session (like the client's consent page, 0022):
   - **Only the helper:** `Origin` must be `chrome-extension://<an id in PORTAL_HELPER_IDS>`; no web page can fake that.
   - **Rate-limited:** 20 failures per 15 minutes from one address.
   - **Everything is checked again:** the person is active, not on a temporary password and still allowed; the portal
     is active and not locked; the office rule holds; this is the computer that pressed, or an office one.
   - **Spent atomically.** The answer is the address, ID and password, with `Cache-Control: no-store`.
   - **One answer for every dead ticket:** unknown, spent and expired tickets all get the same 410. A refusal spends
     the ticket and marks the press REFUSED.
4. The helper opens the portal in a new tab and checks the tab really is at the saved address (http → https on the same
   host is allowed). Then it runs `fillLogin` in the page (`Helper/src/fill.ts`):
   - it waits up to 8 seconds for a late form;
   - it types the way a person would, so React and Angular notice;
   - the password only ever goes into a password box;
   - it presses Login, never "Forgot password?" or "Register";
   - with letters to type (a captcha) it fills both boxes and shows "Type the letters you see, then press Login."
5. The helper answers the page an outcome. The page reports it (`POST /uses/:useId/outcome`), says it in plain words,
   and keeps it on the card when something needs doing.
6. The helper keeps nothing, and switches off Chrome's "Save password?" offer, which would hand the password to staff.

| Outcome | What happened | What the person reads |
|---|---|---|
| SUBMITTED | Filled and Login pressed | "Opened France visa portal for you. The ID and password were never shown." |
| WAITING_FOR_STAFF | Filled; letters to type | "… is open. Type the letters you see there, then press Login." |
| NO_LOGIN_BOXES | No login form found | "This portal didn't log in by itself. Your HOD can see this on Portal logins." |
| ADDRESS_CHANGED | Opened at another address; nothing typed | "This portal now opens at a different address. Ask your HOD to check it." |
| DIDNT_OPEN | The page never finished opening | "The portal didn't open. Check the internet and try again." |
| REFUSED | The server refused (set by the server) | The server's words, e.g. "Log in for me works only in the office." |
| FAILED | Anything else | "Log in for me didn't work. Try again, and tell your HOD if it keeps happening." |

## Component 1 (built 21 Oct 2026)

- **Data** (migration `20261021210000_portal_logins`):
  - `PortalLogin`: department (fixed once added), name, login address, what the first box is called (`idLabel`), the
    sealed `secret`, `passwordChangedAt`, ACTIVE/REMOVED, who added it.
  - `PortalLoginUser`: who may use it.
  - `PortalLoginUse`: each press, with its ticket hash, expiry, collection and outcome.
  - Checks:
    - names and labels are not blank and not too long;
    - addresses are http(s);
    - the secret is kept exactly while ACTIVE;
    - one active name per department, whatever the case;
    - a ticket expires after it's made, a collected ticket's hash is cleared, and an outcome has its time.
- **Endpoints** (`Backend/src/modules/portalLogins/`):
  - `GET /api/portal-logins` gives the portals this person may see, "who used what" (managers: the last 10 collected),
    the departments they may add to, `officeAddressesSet`, `ready` (the key is set) and `helperIds`.
  - `GET /people?department=` lists the department's office staff.
  - `POST /` adds a portal (201). `PATCH /:id` changes one (the ID and password only when sent; 409 STALE).
  - `POST /:id/remove` removes one. `POST /:id/open` presses it (201).
  - `POST /uses/:useId/outcome` reports a press's outcome (once; others' presses get 404).
  - `POST /api/portal-helper/redeem` is the helper's collection.
  - Audited: `portalLogin.create`, `.update` (with `idChanged` / `passwordChanged`, never the values), `.remove`,
    `.open`, `.use` (when the secret leaves), `.refuse` and `.outcome`. `audit()` also strips `secret`, `loginId` and
    `ticket`.
- **The helper** (`Helper/`): Manifest V3, TypeScript built into `Helper/dist`.
  - Permissions are `scripting` and `privacy` only; host permissions are http(s).
  - `externally_connectable` lists the CRM's pages.
  - A development key gives the fixed ID `cbgfmlcnmcldkginifhpfcgpgfclmhfg`.
  - `npm run serve:test-portals` serves pretend portals on port 5199. `README.md` has the steps.
- **Screen:** Settings → Portal logins (`/settings/portals`):
  - **Cards:** the department, who may use it, "ID •••••• · password hidden", "Password saved 21 Oct", Log in for me.
  - **For managers:** Edit and Remove, "Not a secure (https) address", the "Who used what" card, the office-address
    warning, and "+ Add a portal".
  - **The drawer** never shows the saved ID or password. "Change the ID" / "Change the password" opens an empty box,
    with autocomplete `new-password`, so Chrome can't fill in the HOD's own password.

| Setting (`Backend/.env`) | Default | Meaning |
|---|---|---|
| `PORTAL_VAULT_KEY` | none (required in production) | 32 random bytes, base64. Locks every saved ID and password. Back it up apart from the database; never change it once logins are saved |
| `PORTAL_HELPER_IDS` | the development helper's ID | The helper's Chrome extension ID(s), comma-separated |

- **Tests:**
  - Backend: `secretBox` 11, `portalLogins` 9, `portalHelper` 14, `portalHelperLimit` 1, and `frontendRules` +2 (the
    drawer's rules and the outcome lists in the database, the helper and the page).
  - Helper: 30 (the filler on many page shapes and a real React form, a whole press with stand-ins for Chrome, the
    manifest and the password-saving switch).
- **Checked in the browser** (worktree, `portal.localhost:5340`):
  - an HOD adds a portal;
  - the page's data holds neither the ID nor the password;
  - the edit drawer keeps them hidden;
  - a staff member sees only their portal;
  - with no helper, the press says so.

- **Checked end to end, 21 Oct 2026, 5:15 pm,** with the helper loaded in the project lead's Chrome, on the pretend
  portals:
  - the plain login, the "Agency code" box and the form drawn late logged in;
  - the captcha page was filled and left for the person (WAITING_FOR_STAFF);
  - the moved portal typed nothing (ADDRESS_CHANGED);
  - the page with no login typed nothing (NO_LOGIN_BOXES).

  Each one's words showed on its card and in "Who used what", and the audit log held neither the ID nor the password.

## Component 2: scheduled password changes, and "Locked" (built 22 Oct 2026, branch `feat/portal-password-schedule`)

Demo screen 28: each card says when its password changes ("Changed monthly · next 12 Oct", "Changed weekly · next Mon").
An overdue one is red, **Locked**, "Weekly change overdue — HOD to reset", with Log in for me greyed out, under "Passwords
change on the schedule you set. On the due date the HOD is asked to reset; the account stays locked for everyone until
that's done." Vimal, 30 Sep: policies "get rolled out but never applied", so the system has to make the HOD do it.

Decided 22 Oct 2026 (project lead):
1. **Schedules:** daily, weekly or monthly, or "No schedule". Monthly is picked first ("we change monthly"). Masti's
   answer to M49 (d) sets each portal's.
2. **The lock:** from the start of the due date (midnight, India time), for everyone, the Head included, until an HOD
   types a new password. With Daily, that's every morning.
3. **How the HOD is asked:** only the red card and the visa case's box; no Today line, WhatsApp or email.
4. **The same password is refused** ("That's the same password. Change it on the portal first, then type the new one
   here."). The CRM can't check the portal itself.
5. **A locked portal's schedule changes only with a new password** in the same save, so "No schedule" can't lift the
   lock (proposed with the plan, approved).

Built:
- **Data** (migration `20261022140000_portal_password_schedule`): `PortalLogin.passwordSchedule` (DAILY, WEEKLY, MONTHLY
  or NONE; monthly by default). Nothing else is stored: the due date is the India-time day of `passwordChangedAt` plus a
  day, 7 days or a month (31 Jan → 28 Feb), and the lock is "today is on or after it" (`passwordDueOn` and
  `isPasswordLocked` in `portalLogin.ts`).
- **Endpoints:**
  - The portal's data carries `passwordSchedule`, `passwordDueOn` and `locked`; `canUse` still says who could press it.
    The case's `portal` carries `locked`.
  - Both presses get 409 `LOCKED` ("This portal is locked until the HOD changes its password.") and make no ticket.
    A ticket made just before the lock is REFUSED at collection (`portalLogin.refuse`, reason `locked`).
  - Adding takes `passwordSchedule`; changing it is audited before → after with the rest of the portal.
  - A new password lifts the lock and restarts the schedule from that day. When the saved login can't be read (another
    key), nothing is compared: the HOD typing both replaces it.
- **Screens:**
  - The cards' line: "Changed monthly · next 22 Nov", "Changed weekly · next Thu", "Changed daily · next tomorrow", "No
    scheduled change · password saved 21 Oct", or, locked, "Monthly change overdue — HOD to reset" on a red card with the
    Locked chip and a greyed-out Log in for me. The page has the demo's second paragraph.
  - The drawer's "Password changes" (Daily / Weekly / Monthly / No schedule). A locked portal opens with "Locked since 22
    Oct. Change the password on the portal itself, then type the new one here." and its password box ("Keep the saved
    password" closes it).
  - The visa case's box: "Locked until the HOD changes its password.", with "Change it on Portal logins" for the Head
    and the Visa HOD.
- **Tests:** `tests/portalSchedule.test.ts` (due dates and the India-time day edge; the default; locked for staff, the
  HOD and the Head; refused at collection; the same password; the ID alone; schedule changes; No schedule; an unreadable
  login replaced), one in `visaPortal.test.ts`, and `frontendRules` (the schedule list).

## Component 3: the button on the visa case (built 21 Oct 2026, PR #86)

Demo screen 08: in "Apply on the government portal", a dark card ("France visa portal — Masti master account. Opens
logged in for this case. Staff never see the ID or password.") with **Log in for me**; the press logs the case
("Neha · France portal · 12:04 · V-2041").

Decided 21 Oct 2026 (project lead):
1. **Who presses it on a case:** besides the people on the portal's list, whoever the case is assigned to. The HOD
   already decides who works on each case. Staff open only their own cases (0006 Decision 1), so on a case it comes to
   the case's person, the HOD and the Head; the list is for Settings → Portal logins.
2. **A visa with no portal saved** shows a short note: "No portal saved for this visa. Ask your HOD to add it."
3. **When:** from step 3 (the case has matured) until the case closes, also later (e.g. to check an e-visa's decision);
   never while it's postponed.
4. **Where a visa's portal is picked:** on the visa's own settings page (Settings → Masters → a visa's checklist), a "Log
   in for me" card with "Portal for this visa", by the Head or the Visa HOD.

Built:
- **Data** (migration `20261022130000_visa_case_portal`): `VisaOffering.portalLoginId` (one of the Visa department's
  active portals; removing the portal clears it, audited) and `PortalLoginUse.enquiryId` (the case a press was made on).
- **Endpoints:** `PATCH /api/masters/visa-offerings/:id` takes `portalLoginId` (400 unless an active Visa portal;
  audited as `visaOffering.update`); the visa list and checklist show `portal`. `POST /api/visa/cases/:caseNo/portal/open`
  makes the ticket for the case's visa's portal: 409 when postponed, closed or before step 3; 400 with no portal; 403
  unless `canUsePortalOnCase` (the portal's list, the HOD, the Head, or the case's person with Visa EDIT). Collecting a
  case's press checks the case again (still open, still that person's, its visa still naming the portal), else REFUSED.
  The case's data carries `portal { id, name, userIds, helperIds }`; "Who used what" and `portalLogin.open` carry the case
  number.
- **Screens:** the case's dark box (`CasePortalBox.tsx`) with Log in for me ("Opened … for case VISA-…"), or the note
  (the Head and the Visa HOD get "Add it in Settings"); the visa's "Log in for me" card (`VisaPortalCard.tsx`).
- **Tests:** `tests/visaPortal.test.ts` (10: linking, removing, who may press, when, no portal, collecting re-checks).
- **Checked in the browser** with the helper: the HOD saw the note, linked France · Tourist to a pretend portal; Neha (on
  the case, not on the portal's list) pressed Log in for me and was logged in; "Who used what" showed "Neha · Agency test
  portal · VISA-2026-0002"; unlinked, Neha saw "No portal saved for this visa. Ask your HOD to add it."

The buttons under the card (Read passport scan, Fill from consent & trip details, Print application form) are not part
of this: they wait on Q13/S6.

## The trial: how we know it's good

On one visa portal and one airline portal (Masti's logins, M49), and the pretend portals until then:
1. One press opens each portal logged in.
2. The password never appears on screen, and Chrome offers no "Save password?".
3. On a set-up office PC, staff can't remove the helper or open the developer tools (component 4).
4. A renamed box still works.
5. A non-technical person uses it without help.

## What it can't do (tell Shivanshu before Masti assumes it can, S13)

- **Letters to type (captcha) and one-time codes** need the person. A code sent to Vimal's phone or email means waiting
  for him.
- **Logins with three boxes** (agency code, user, password) aren't handled yet: there's one ID box. A per-portal "where to
  type" hint kept as data in the CRM could come later.
- **Unusual logins get an "Open portal" fallback instead:**
  - single sign-on on another address;
  - login boxes inside frames;
  - an ID page followed by a password page.
- **Shared accounts:** a portal that logs out one person when another logs in with the same account will do so.
- **The password isn't 100% secret:**
  - Until the office PCs are locked down (component 4), someone technical could read a typed password with the
    browser's developer tools.
  - Anyone who learned it could use it from home until it's next changed (component 2 makes the HOD do that on
    schedule): "office only" applies to the button, not the portal.

## For deployment (component 4, not built)

- **Installing:** on Windows, Chrome force-installs a self-hosted extension only on managed machines (joined to a domain,
  or enrolled in Chrome Browser Cloud Management). An unlisted Chrome Web Store listing, under Masti's own account,
  avoids that.
- **Production manifest:** it needs Masti's CRM address in `externally_connectable`, and its own ID in
  `PORTAL_HELPER_IDS`.
- **Chrome policies on the office PCs:** `ExtensionInstallForcelist`, `DeveloperToolsAvailability` and
  `PasswordManagerEnabled=false`.

## Still open

- **M49:** the real list of company logins (visa and airline). For each one:
  - what its first box is called;
  - whether it asks for letters or a code, and to whose phone or email;
  - whether two people can be logged in at once.
- **M50:** the office PCs: Windows edition, who looks after them, the browser, and whether people use personal Google
  accounts in Chrome.
- **M19:** the office internet addresses.
- **A8/A9:** the accounts themselves, handed over securely.
