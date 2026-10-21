# 0022 · The consent & liability form

- **Status:** decided 21 Oct 2026 (project lead). Parts 1 and 2 (2a, 2b) and 3a are built; 3b, the printable record,
  follows.
- **Date:** 21 Oct 2026
- **Scope:** the consent each traveller gives once in their life (PROJECT_KNOWLEDGE §10.5): who fills what, how the
  client agrees, and the record Masti keeps. It builds on 0006 Decision 5, which created the `Consent` table and the case
  card as a flag only. It is not the hotel and ticket non-refundable consent, which is agreed by OTP.

## Context

What Masti asked for (Vimal, 30 Sep meeting, 7:13–7:16 PM; written requirements §37; PID):
- **One consent per person, for life.** It is tied to the passport name and current number, and stays valid if the
  passport changes.
- **Staff fill in the details by asking the client:**
  - date of birth, spouse's date of birth, anniversary, mother's and father's dates of birth
  - home and office address
  - income, profession, education
- **The client enters nothing.** They open a link (WhatsApp, SMS as the fallback) and tick "I agree".
- **Two clauses:**
  - A passport in transit is at the client's risk: damage, loss, misplacement, delay.
  - Anything booked before the visa comes is solely the client's risk.
- **When and who:** taken once the business has reached a certain stage, not at enquiry, by the processor alongside
  processing. It never blocks the case.
- **Record:** kept as an official digital record.
- **Wording:** Vimal will supply the legal words (Q9/M12, still awaited).

Before this record, the case's "Consent & liability form" card showed a flag per traveller, and nothing could fill the
details or record a consent.

## Decisions (project lead, 21 Oct 2026)

1. **Three parts, built one at a time, each checked before the next:**
   1. Staff fill each traveller's details.
   2. The client's link, page and "I agree".
   3. The printable record and the flags.
2. **The link goes to the traveller's own number when one is saved**, otherwise to the client's main number. It's one
   link per traveller.
3. **Until Vimal's wording arrives, my draft wording is used, editable in Settings.** Each agreement records which
   wording it agreed to.
4. **The proof is a record staff can open and print** (the browser's print to PDF). No PDF file is stored.

## Part 1: staff fill each traveller's details (built 21 Oct 2026)

- **The details live on the person** (`ClientMember`), not on the consent:
  - New columns: `spouseDateOfBirth`, `anniversary`, `motherDateOfBirth`, `fatherDateOfBirth`,
    `residentialAddress`, `officeAddress`, `annualIncome` (a year, in whole rupees), `profession` and `education`.
  - Plus `consentDetailsAt` and `consentDetailsById`: when the form was last saved, and by whom.
  - `dateOfBirth` was already there.
  - They are facts about the person, kept for life: the next case starts with them, and Step 3's "Fill from consent"
    can use them later.
  - The consent (part 2) keeps a copy of them as they were when the client agreed.
  - Database checks: no blank text, addresses at most 300 characters and the rest at most 100, income not negative,
    and the saved-at time and saved-by user set together.
- **The date of birth and the home address are needed ⚠️.** The rest stays empty when it doesn't apply: a child has no
  spouse, income or office. No future dates are accepted.
- **Where and who:** "Fill details" / "Edit details" on each named traveller's tile in the case's consent card.
  - It is open from Documents until the passports are handed over (a new `CONSENTING` step rule): not at enquiry,
    then alongside processing.
  - Only on an open case, and only for the owner, the Visa HOD or the Head.
  - An unnamed traveller is refused ("Name this traveller first").
  - Editing the person elsewhere in between makes the form stale (409).
- **The endpoint:** `PUT /api/visa/cases/:caseNo/travellers/:travellerId/consent-details`.
  - The form sends every field each time, plus the person's `updatedAt`.
  - It returns the case, like every case action.
  - It's audited as `member.consent_details`, with the client, so it shows in the client's history.
- **On the case:** each named traveller's consent carries `details`: the fields, `filledAt`, `filledBy`, and the
  person's `personUpdatedAt`. The tile shows "Details filled · 21 Oct" or "Details not filled".

## Part 2: the link, the client's page and "I agree"

The project lead's choices for this part (21 Oct 2026):
- **The link goes automatically when staff save a traveller's details**, if that person hasn't agreed yet.
- **The link has no expiry.** It works until it is used, or until a newer link replaces it. (The earlier plan was 7
  days ⚠️.)
- **The page shows the person's details and the clauses.**
- **The Head and the Visa HOD can change the wording.**

It is built as two components: 2a, the link, the page and "I agree"; then 2b, the wording editor in Settings.

### 2a: the link, the page and "I agree" (built 21 Oct 2026)

- **The wording** (`ConsentWording`):
  - Each version is a row that can never be changed or deleted (a database trigger), because agreements point at it.
    The version in use is the newest one.
  - Its body is not blank and at most 8,000 characters. It's plain text: a blank line starts a paragraph.
  - It starts with my draft (`src/modules/consent/consent.seed.ts`), seeded with no author. The draft has:
    - the authorisation to collect, keep and send the passport
    - clause 1, the passport in transit
    - clause 2, bookings before the visa
    - that the details shown are correct
    - that the consent holds for life, even if the passport changes
- **The link** (`ConsentLink`), one open per person:
  - Saving the details sends one when the person has no consent and no open link. Saving again sends nothing more.
  - **Send the link again** on the traveller's tile replaces the open link with a new one, for a lost message or a
    wrong number. The old link then says it was replaced by a newer one.
    `POST /api/visa/cases/:caseNo/travellers/:travellerId/consent-link`, with part 1's rule.
  - It records the person, the case that sent it, the number it went to, who sent it and when, and when it was
    replaced or used.
  - Database checks: never both used and replaced, at most one open link per person, and a valid mobile.
  - Audited as `consent.link.sent`, with the client.
- **The message** is message 4, `visa.consent_link` ("Consent form (I agree)"), sent through the outbox (0021
  Amendment 2):
  - It goes to the traveller's own number when one is saved, addressed to them. Otherwise it goes to the client's main
    number, addressed to the client.
  - The draft's "Before we apply" is gone, because consent never blocks the case. The link sits on a line of its own.
  - Its words are still Masti's to approve (M1).
- **The client's page:** `/consent#<token>`, with no login, made for a phone.
  - It shows the person's name, "Details given to us" (the filled fields only), the wording, a tick box "I have read
    this form" and **I agree**, with Masti's name, address and phones.
  - Once agreed, the link shows "Thank you" with the date and time, and no details.
  - A replaced or unknown link says so in plain words.
  - If the wording changes while the client reads, "I agree" is refused (409 `WORDING_CHANGED`). The page loads the new
    wording, and the client reads it and ticks again.
  - The same goes for the details (409 `DETAILS_CHANGED`) when staff change them meanwhile. The page sends back the
    fingerprint (a SHA-256) of the details it showed, so the record always holds what the client read.
- **"I agree" records the `Consent`** in one transaction:
  - It records when, which wording version, the link (and so the number it went to), a copy of the details exactly as
    shown, and the IP and the phone's user agent.
  - The link becomes used.
  - It's audited as `consent.agree`, with the client and no staff member.
  - Agreeing again, or opening any of the person's links later, just shows the thank-you.
- **The traveller's tile** shows "Details filled · 21 Oct" and "Link sent · 21 Oct · to +91 98250 41234", with **Send
  the link again**. Once the client agrees, it shows "Agreed · 21 Oct".

**Keeping the link safe:**
- **The secret is after the `#`.** Browsers never send that part to a server, so neither the web server's log nor ours
  ever holds it. The page posts it in the request body.
  - With `WHATSAPP_PROVIDER=log`, the message itself goes into the server log. When live, that copy hides the part
    after `#`. On a laptop it stays whole, because there the log is the only place to open the link.
- **Only its SHA-256 hash is stored**, as with session tokens. The token is 32 random bytes. The outbox holds the whole
  link only while message 4 waits to go. Once it's sent, fails or is skipped, the stored message keeps it hidden
  (`/consent#…`), in its words and its values.
- **Staff can't open it.** The "Sent to the client" box shows the message with the token hidden (`/consent#…`), so
  nobody in the office can agree for the client.
- **It's rate-limited:** 60 requests per 15 minutes per IP on `/api/public/consent`. It sits outside the office-network
  rule, which binds staff only.
- **It never expires** (the lead's choice). A link that leaks is stopped with **Send the link again**.
- **The page shows Masti's name, address and phones only**, never its PAN, GSTIN or bank details.
- **`PUBLIC_APP_URL`** is the address in the link. When live it's Masti's own https address, and the server warns if
  it isn't https. A phone can't open `localhost`, so in development open the link on the laptop.

### 2b: the wording editor in Settings (built 21 Oct 2026)

- **Settings → Masters → Consent wording** (`/settings/masters/consent-wording`). The Masters page has a card for it,
  marked **Draft** while my wording is in use.
  - The page shows the version in use, as the client's phone shows it, since when and by whom, with a "Draft" note
    while it's mine.
  - **Change the wording** opens the words in a text box, with a live preview and a count (at most 8,000 characters,
    the database's limit). Saving asks first: "Use this wording from now on?" The change is kept as a new version, used
    from then on.
  - Leaving with unsaved words asks first. Earlier versions fold out, each with **View**.
- **The API:** `GET /api/masters/consent-wording` returns every version, newest first, for anyone with Visa view.
  `POST { body, basedOnId }` is for the Head or the Visa HOD only (`assertCanEditVisaMasters`, as for covering letters).
  - `basedOnId` is the version the editor opened. If another was added since, it's refused (409 STALE): of two saves at
    once, one goes through and the other is told to reload. The draft stays in the editor.
  - The same words as the version in use are refused (400).
  - It's audited as `consent.wording.add`.
- Consents already given keep their version: versions are never changed or removed. A client reading the form when it
  changes is asked to read it again (2a's `WORDING_CHANGED`).

## Part 3: the client page and the record

The project lead's choices (21 Oct 2026):
- **Consents signed on paper before the CRM** (the demo's "On file · 2025") are marked on file from the client page by
  the Visa HOD or the Head, with the year. It's audited, and that person never gets a link.
- **The printed record shows everything:** the details as agreed, the exact wording, when they agreed, the number the
  link went to, and the phone's IP address and browser.
- **New enquiry gets nothing more.** Its demo line "Anyone without a consent form on file is flagged" is the case's
  consent card, which already flags them.

It is built in two pieces: 3a, the client page's column and paper consents; then 3b, the printable record.

### 3a: the consent column and paper consents (built 21 Oct 2026)

- **The client page's "Family & travellers"** has a **Consent form** column: "On file · 21 Oct" (through the link),
  "On file · 2025 (on paper)", or "Not on file", as the demo's chips.
  - The Visa HOD and the Head see **Signed on paper** on a "Not on file" row. They pick the year (1990 to this year)
    and confirm.
  - On a paper row they see **Undo**, for a mistake. It asks first, and afterwards the person can be sent the link.
    A consent given through the link can never be removed.
  - The member's DTO carries `consent: { id, agreedAt, paperYear } | null`, and nothing more: the record has the rest.
- **The data:** `Consent.source` (`LINK` or `PAPER`, default `LINK`), plus `paperYear` and `markedById`.
  `wordingId`, `linkId` and `details` became optional, with database checks:
  - A LINK consent has a wording, a link and the details, and no year or marker.
  - A PAPER consent has a year (1990–2100) and a marker, and nothing of the link. Its `agreedAt` is when it was marked
    on file.
  - A trigger refuses any change to a consent, and any delete except a paper one's.
- **Kept in `Consent`,** so every "already on file" check counts paper too: saving the details sends no link, **Send the
  link again** is refused, and an old link says it's on file. Marking closes a link still open.
- **The API:** `POST /api/clients/:id/members/:memberId/paper-consent { year }` and `DELETE …/paper-consent`, for the
  Head or the Visa HOD on a client they can see.
  - It refuses: a year still to come, a person already on file (409), a person taken off the list (409), a person on
    another client (404), and a link consent on Undo (409).
  - It's audited as `consent.paper.mark` and `consent.paper.remove`, with the client.
- **The case's tile** shows "On file · 2025 (on paper)" for a paper consent.

### 3b: the printable record (next)

**View record**, from the case's tile and the client page's column, opens a page to print (or save as PDF), with
nothing stored:
- **A link consent:** Masti's name, address and phone; the details as agreed; when and how it was given (the number,
  who sent the link, the case); the IP address and the phone's browser; the wording version, in full.
- **A paper consent:** the year it was signed, and who marked it on file and when.

## Still open

- **The wording** (Q9/M12/C3).
- **Who agrees for a child:** for now the client on the main number does.
- **SMS as the fallback channel**, which needs a provider with DLT registration.
- **DPDP** (S11): these are personal details, so for now only staff who can open the case, or edit clients, see them.
