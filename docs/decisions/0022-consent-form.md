# 0022 · The consent & liability form

- **Status:** decided 21 Oct 2026 (project lead). Part 1 is built; parts 2 and 3 follow, one at a time.
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

## Part 2: the link, the client's page and "I agree" (next)

- **The link:**
  - One per traveller, with a secret token (only its hash is stored).
  - It expires after a set time (7 days ⚠️, a setting).
  - It goes out as message 4 when staff finish a traveller's details and that person has no consent on file.
- **Who it goes to:** the traveller's own number, else the main one. The outbox gains an optional recipient (today it
  always uses the client's main number).
- **The client's page:** `/consent/:token`, with no login.
  - It sits outside the office-network check and is rate-limited.
  - It shows the details and the wording, with an **I agree** button.
- **The wording:** in Settings, versioned. It starts with my draft, marked as a draft.
- **"I agree" records the `Consent`:**
  - when, which wording version, and a copy of the details shown
  - the IP and the phone's user agent
  - the channel
- **The card** shows "Link sent · date", then "Agreed · date".
- **Message 4's draft** says "Before we apply", which is wrong because consent never blocks. It gets fixed before
  Meta approval (M1).

## Part 3: the record and the flags (after part 2)

- **The record:** opens from the case and from the client page, and prints.
- **The client page:** the family list gets a consent column ("On file · 28 Sep" / "Not on file").
- **New enquiry:** the flag "Anyone without a consent form on file is flagged".

## Still open

- **The wording** (Q9/M12/C3).
- **Who agrees for a child:** for now the client on the main number does.
- **Consents given before the CRM** (the demo's "On file from 2025"): an import or a manual entry.
- **SMS as the fallback channel**, which needs a provider with DLT registration.
- **DPDP** (S11): these are personal details, so for now only staff who can open the case, or edit clients, see them.
