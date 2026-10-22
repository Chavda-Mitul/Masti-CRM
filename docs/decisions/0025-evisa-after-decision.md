# 0025 · E-visas after the decision

- **Status:** decided 22 Oct 2026: Vimal said yes to M39 (d), and the project lead answered the details the same day.
  Built in 5 parts, one at a time (Decision 1). Built: part 1 (22 Oct 2026). A "Built" note is added under each part as
  it lands.
- **Date:** 22 Oct 2026
- **Scope:** what follows an e-visa's decision at Step 6, until the case closes:
  - each approved traveller's e-visa PDF, and its check against the passport
  - sending it to the client on WhatsApp, with the PDF
  - closing the case, or first handing back passports we hold
  - refused e-visas
- **Builds on:**
  - [0008](0008-visa-docket-dispatch.md) Decision 11: "Submitted online"
  - [0011](0011-visa-at-vendor.md) Decision 8, [0012](0012-visa-decision.md) Decisions 4–6: the decision, the refusal
    letter, Change
  - [0013](0013-visa-passport-back.md) Decision 4: e-visas skip Step 7
  - [0014](0014-visa-delivered.md) and [0015](0015-field-staff-app.md): the handover, at the office or by the delivery boy
  - [0020](0020-whatsapp-sending.md) and [0021](0021-whatsapp-outbox.md): WhatsApp through Twilio, and the outbox
- **Not in the demo:** [change request 14](../change-requests.md). Shivanshu checks whether it's paid.

## Context

| Source | What it says |
| --- | --- |
| 0013 Decision 4 (16 Oct 2026) | An e-visa's passports never left the office, so it skips Step 7 and waits at Step 6 until Masti answers M39 (d). |
| Browser test, 22 Oct 2026 | VISA-2026-0009 went File ready → Submitted online → Approved. Nothing then ends the case, so it runs late from its due time ("Let the client know") for good. |
| M39 (d), 22 Oct 2026 | Our suggestion ([#83](https://github.com/Chavda-Mitul/Masti-CRM/pull/83)): save the e-visa PDF, check it, send it on WhatsApp, then Delivered and closed. **Vimal said yes** ([#84](https://github.com/Chavda-Mitul/Masti-CRM/pull/84)). |
| Twilio's WhatsApp media guide | A WhatsApp message's media can be up to 20 MB; Twilio checks the file's content type at the link it's given; a document's file name and caption can't be set. |

**Decided by the project lead (22 Oct 2026):**

1. **A mismatch blocks sending.** Every approved traveller's e-visa must be marked Matches before it goes to the client.
2. **The PDF goes on WhatsApp now,** through Twilio, as a session message (no template): like every message today, it
   reaches a client who wrote to us in the last 24 hours. An approved template with a document comes with M1.
3. **Passports we hold** (booklets counted at intake): the case closes only after the usual handover (count, who
   collected them, their photo; or the delivery boy).
4. **When everyone is refused,** the case closes on its own, or goes to the handover when we hold passports.

## Decision

### 1. Five parts, one at a time

Each part is planned in plan mode, built, tested, checked in the browser and merged before the next starts.

| Part | What |
| --- | --- |
| **1** | Each approved traveller's **e-visa PDF** on the Decision card, and its **Matches / Doesn't match** check (Decisions 2–3). |
| 2 | **WhatsApp attachments:** an outbox message can carry one case file. The sender makes a fresh pre-signed link at send time, and Twilio gets it as `mediaUrl`. Twilio must reach the bucket: a new optional `S3_PUBLIC_ENDPOINT` (on this computer, only through a tunnel). `whatsapp:test` gets a way to send a file. |
| 3 | **"Send the e-visa →"** at Step 6, blocked until every approved traveller has a PDF marked Matches. One WhatsApp per approved traveller, each with their PDF. With no passports held, the case moves to Delivered and closes; with passports held, it's due for the handover. The step bar shows Step 7 as not needed. |
| 4 | **Handing back passports we hold** for an e-visa that was sent: the office handover and the delivery boy, against the intake count. |
| 5 | **Refused e-visas:** e-visa versions of messages 11 and 12 (no passport lines) at the decision. When everyone is refused, the case closes on its own, or goes to the handover. The Record dialog warns first: a closed case can't be changed. |

### 2. The e-visa PDF (part 1)

- **One PDF per approved traveller,** as the portal issued it, kept with the case's files in the private bucket (rule 4)
  and opened through a short-lived link, like the refusal letter.
- **A newer upload becomes the current one;** older ones stay as proof. Kept when the traveller is changed to Refused,
  and shown again if they're approved again.
- **When:** at Decision, on an open case, by whoever can act on it (its processor, the Visa HOD, the Head).
- **The limit** is 16 MB ⚠️, under WhatsApp's 20 MB, or the final file's limit (`visa.finalFile.maxMb`) when that's
  lower.
- **Its name** is `VISA-2026-0001_Rakesh-Mehta_evisa.pdf` ⚠️. The storage key ends in it
  (`cases/<id>/evisa/<uuid>/<name>`), because a WhatsApp document's name can't be set: it comes from the link.

**Built 22 Oct 2026** (part 1):
- **Data** (migration `20261022180000_evisa_files`):
  - a case file of kind `EVISA`, with its traveller
  - the CHECK `CaseFile_refusal_letter_traveller` becomes `CaseFile_traveller`: REFUSAL_LETTER and EVISA have a
    traveller, and nothing else does
  - the traveller's relation `refusalLetters` becomes `files`; the case reads the newest of each kind
- `POST /api/visa/cases/:caseNo/travellers/:travellerId/evisa`, the PDF itself as the body. Refused with:
  - 409 before the decision ("The e-visa is added once the decision is recorded."), on a postponed or cancelled case,
    for a paper visa ("This visa has a sticker, not an e-visa: it's checked when the passports come back.") and for a
    traveller who wasn't approved; 404 for someone not on the case
  - 400 for an empty, non-PDF or broken file; 413 over the limit; 415 unless sent as a PDF
- Uploaded before the case lock and removed again if the checks under the lock fail; audited as `visa.file.upload`
  (kind, traveller, name, pages, `replaces`, and the check it cleared). The step rule is `CHECKING_EVISA` (Decision,
  open).
- **The case** sends each traveller's `evisa` (the current file and how many were uploaded, only while approved on an
  e-visa) and `evisaMaxMb`, which the page checks first.
- **Screen:** on the Decision card, under an approved traveller's e-visa number: "e-Visa PDF", its pages, who uploaded
  it and when, Open, and Upload e-visa / Replace.

### 3. Its check against the passport (part 1)

- **Matches or Doesn't match:** the PDF against the passport (name, passport number) and what was recorded at Step 6
  (the e-visa number and dates).
- **It reuses the sticker's check** (`VisaCaseTraveller.stickerCheck`): an e-visa never reaches Step 7, where a sticker
  is checked, and the database already keeps it to an approved traveller.
- **A newer PDF clears it:** it hasn't been looked at.
- **Change** keeps it while the traveller's entry stays as it was (an unchanged save), and clears it when the outcome,
  number or dates change. It's set only on the PDF's row, never in Change.
- **Doesn't match** shows in red: "get it corrected on the portal and upload the new PDF, or fix our typing with Change".
  Part 3 blocks sending until every approved traveller matches.

**Built 22 Oct 2026** (part 1):
- `PUT /api/visa/cases/:caseNo/travellers/:travellerId/evisa-check` with `{ fileId, check: MATCHES | MISMATCH | null }`.
  The `fileId` names the PDF that was looked at: 409 "A newer e-visa was uploaded: open it and check again." when it
  isn't the current one, and 409 before any PDF. Audited as `visa.evisa.check`, with the PDF.
- Like the processor's paper checks (0007 Decision 3), it doesn't move the case's `updatedAt`; pressing the chosen
  button again undoes it; saving the same check again writes nothing.
- **Screen:** Matches | Doesn't match beside the PDF for whoever can act; for others, "Matches the passport", "Doesn't
  match the passport" or "Not checked yet".

### 4. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| The e-visa PDF limit | 16 MB ⚠️ (under WhatsApp's 20 MB), or `visa.finalFile.maxMb` when lower |
| The e-visa PDF's name | `<case no>_<traveller>_evisa.pdf` ⚠️ |
| The words on the card | ours ⚠️ |

## Still needed

- **Shivanshu:** is change request 14 paid?
- **Masti (M1):** the wording of the new WhatsApp messages (parts 3 and 5), with the other visa messages.
- **Masti (M39 a–c):** the e-visa and Step 5 timings, still open.
