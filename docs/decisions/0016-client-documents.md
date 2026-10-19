# 0016 · The client document vault

- **Status:** decided (17 Oct 2026, project lead; Vimal wants the scans kept permanently). Being built one component at
  a time (Decision 1). Built: the Documents card on the client page (17 Oct 2026, component 1); the vault in Step 2
  (17 Oct 2026, component 2). The WhatsApp message (Decision 6) waits for the WhatsApp outbox.
- **Date:** 17 Oct 2026
- **Scope:** scans of a client's papers (passport, Aadhaar, PAN, photos, bank statements…), kept on the client, per
  family member, and reused on later cases:
  - the Documents card on the client page: every scan, for HODs and the Head
  - saving a scan from a case's checklist, and ticking a paper "On file" from the copy already kept
  - the WhatsApp message that tells the client we keep them
- **Replaces:**
  - [0004](0004-client-master.md): "the document vault is excluded", and "if built, it stores Drive/OneDrive links"
  - [0007](0007-visa-file-prep.md) *Settled after slice 2*: "if confirmed, only the passport's photo page, per person"
  - PROJECT_KNOWLEDGE.md §10.1: "Aadhaar numbers are not stored", for scans. A typed Aadhaar number is still never
    stored (Decision 2).
- **Builds on:**
  - CLAUDE.md rule 4 (10 Oct 2026): documents in the private S3-compatible bucket, opened through short-lived links.
    `src/lib/storage.ts` is the only code that talks to the bucket.
  - [0004](0004-client-master.md): the client and its family members (`ClientMember`)
  - [0005](0005-system-masters.md): the document master (every paper a checklist can ask for), edited in Settings
  - [0006](0006-visa-documents.md): the case's checklist, ticked Original / Xerox / Made / Not needed in Step 2

## Context

| Source | What it says |
| --- | --- |
| Demo | No vault. The client page shows Family & travellers (passport valid till, consent), not documents. |
| Vimal, 7:08, 7:18, 8:39 PM | Documents are kept as links, "so the system doesn't get heavy". Clients never upload; staff scan in the office. Rule 4 replaced links with the private bucket on 10 Oct 2026. |
| Q37, 8 Oct 2026 | Not built: not in the demo and nobody asked for it, so possibly a change request. |
| 0007, 12 Oct 2026 | The case's saved file stays one PDF. If a vault is confirmed, it keeps the passport's photo page per person, after a data-protection decision. |
| Vimal, through the project lead, 17 Oct 2026 | Build it. Keep the scans **permanently**. Vimal will check this with the government himself. |
| Project lead, 17 Oct 2026 | All papers for now, Aadhaar too. Tell the client by a WhatsApp message (no consent form change). Only HODs see a client's whole list; scans are kept on the client. Keep every version; no delete for now. "On file" in Step 2. Build it now. |
| Project lead, 17 Oct 2026 (later) | Settled: the scans are kept **permanently**, with no removal; the full Aadhaar card is kept. No government check is waited for (M40 closed). Whether it's charged is the project lead's call; Shivanshu isn't asked (S12 closed). |

**Why it's worth having.** A passport lasts ten years, and a family travels more than once. Today every trip means the
same passport, PAN and Aadhaar copies again. With the vault, the office scans a paper once and prints it from the copy
on file next time.

## Decision

### 1. Build order: one component at a time

**Decided 17 Oct 2026 (project lead):** each component is planned, built, tested, checked in the browser and committed
before the next starts:

1. **The Documents card on the client page** (Decisions 2–4): the table, adding a scan, the list, opening a scan,
   older copies
2. **The vault in Step 2** (Decision 5): saving a scan from a paper on the checklist, "On file", opening the copy on
   file from the case

The WhatsApp message (Decision 6) is recorded now and sent once the WhatsApp outbox exists.

### 2. What goes in: every paper in the document master

**Decided 17 Oct 2026 (project lead):** "for now, store all stuff".
- **Any paper in the document master** can be saved: passport, old passports, photos, bank statement, ITR, birth
  certificate, letters… A paper added in Settings can be saved too. Two papers are added to the master: **Aadhaar
  card** (`AADHAAR_CARD`) and **PAN card** (`PAN_CARD`).
- **Aadhaar is kept as a scan only.** No typed Aadhaar number exists anywhere in the CRM, so it's never searched or
  shown in a list.

**Defaults (not asked; say if any is wrong):**
- **Files:** one PDF, JPEG or PNG per save (a scanner's PDF, or a phone photo), checked by its first bytes, not by what
  the upload claims. A paper with several pages is one PDF.
- **Size:** up to `clients.documents.maxMb`, seeded 20 MB ⚠️.

### 3. Kept on the client, per family member, forever

**Decided 17 Oct 2026 (project lead):**
- **Each scan belongs to the client** and names the **family member** it's for (the passport, Aadhaar, photos of one
  person). A paper that's the client's own (a company's PAN card) has no member.
- **Every version is kept.** The newest scan of a paper for a person is the current one; older copies stay and still
  open. A renewed passport keeps the old one's scan, which an embassy may ask for as an old passport.
- **Nothing is deleted:** there is no delete button. Settled 17 Oct 2026 (project lead): the scans are kept
  permanently, and a client can't have them removed (M40 closed).
- **In the private bucket** under `clients/<clientId>/<uuid>.<ext>`, opened only through short-lived links (rule 4).

**Defaults (not asked; say if any is wrong):**
- **An archived member** keeps their scans, which still open; new scans can't be added to them.
- **The file opens and saves as** "Aarav-Mehta_Passport_2026-10-17.pdf" ⚠️: the person's name (the client's for
  their own papers), the paper and the day it was saved.

### 4. Who sees what

**Decided 17 Oct 2026 (project lead):**
- **The whole list** (the Documents card on the client page): **the HOD of any department, or the Head**. Anyone else
  doesn't see the card, and the server refuses the list.
- **Adding a scan on the client page:** the same people.
- **Staff working a case** see only that case's papers: "On file · saved 12 Mar 2026" on a traveller's paper when the
  vault has a current copy for that person, and they can open that one copy and save a new scan from the case
  (Decision 5). They never see the client's whole list or older copies.
- **Field staff:** nothing.

**Defaults (not asked; say if any is wrong):**
- **Every save and every opening is audited:** who, when, the IP, and the client, so the client's history shows them.
- **Departments:** Tickets, Holidays and Insurance HODs see the list too, since their work needs passport copies.
  Their staff get the "On file" view when their case screens are built (Stage 2).

**Built 17 Oct 2026** (component 1, the Documents card, Decisions 2–4):
- **Data** (migration `20261017120000_client_documents`):
  - `ClientDocument`: the client, the member (or none), the paper, the bucket key, file name, type, size, a PDF's
    pages, who and when. Never updated or deleted.
  - CHECKs: one of the three types; a size above 0; pages set exactly for a PDF.
  - The setting `clients.documents` `{ maxMb: 20 }` ⚠️, which the Head can change through `PUT /api/clients/settings`
    (no screen yet).
  - The document master gains Aadhaar card and PAN card.
- **`GET /api/clients/:id/documents`** returns `{ groups, papers, maxMb }`:
  - groups: the client's own papers first, then members in family order, anyone taken off the list last
  - each paper's current scan and the older ones, newest first
  - the active papers for the Add form (the masters API needs Visa access)
- **`POST /api/clients/:id/documents?documentId=&memberId=`**, with the file as the body (PDF, JPEG or PNG), returns
  201 with the list. Before the body is read, it refuses:
  - 415 for another type
  - 403 for anyone but an HOD or the Head ("Only an HOD or the Head can see a client's documents.")
  - 404 for an unknown client, a person not on this client, or an unknown paper
  - 400 for a person taken off the list, or a paper switched off
  - 413 over the size limit
- **The bytes are checked:** a PDF that opens (pages counted), or a real PNG or JPEG; otherwise 400. The bucket upload
  comes before the transaction, which checks the person and paper again; a failure removes the object. Audit
  `client.document.add`, with `replaces` (the previous current scan).
- **`GET /api/clients/:id/documents/:clientDocumentId/link`:** a short-lived link (`S3_PRESIGN_SECONDS`), audited
  `client.document.open`.
- **Shared code:**
  - `src/lib/pdf.ts`, moved from the visa module
  - `src/lib/images.ts`, as on the Step 8 branch
  - `src/lib/fileNames.ts`, which the refusal letter uses too
  - on the frontend, `useOpenSignedLink`, which case files use too
- **Screen:** the Documents card under Family & travellers, for HODs and the Head only:
  - one block per person: "Not one person's: the client's own papers" first; a "Taken off the list" chip for anyone
    taken off the list
  - each paper's current scan (type, pages, size, saved when and by whom, **Open**), and "Older copies (n)"
  - **+ Add a scan:** whose paper (the active family members, or the client's own), the paper and the file, checked
    before upload. The toast reads "Saved Aarav Mehta's Passport."
- **Checked in the browser:**
  - a Holidays HOD adds and opens a PDF, a PNG and the client's own paper; a second passport moves the first to the
    older copies
  - taking a person off the list moves their scans last
  - Visa staff see no card, and the API refuses them

### 5. The vault in Step 2

**Decided 17 Oct 2026 (project lead):**
- **"On file" in one click:** for a paper the checklist accepts as a xerox, when the vault holds a current copy for
  that traveller, staff can tick it **On file** instead of Original or Xerox. The copy is printed for the file.
- **Never ticked automatically.** Staff see the date the copy was saved and decide: last year's bank statement isn't
  good enough for this year's visa.
- **An "On file" paper counts as received:** the client isn't asked for it again (the pending-documents reminders,
  when WhatsApp is built), and the processor checks it in Step 3 like any other paper.

**Defaults (not asked; say if any is wrong):**
- **Originals can't be "On file":** a copy never replaces a paper the checklist needs as an original (the passport).
  Things we arrange (Made) neither.
- **Saving a scan from the case:** each paper on the checklist gets "Save scan", for a traveller linked to a family
  member, by whoever can tick that case's papers. It goes into the client's vault, so the next case finds it.
- **The paper keeps which copy was used:** `ReceivedAs` gains `ON_FILE`, and the case's paper points at the scan, so
  the file always shows exactly which copy went in.

**Defaults added when building (17 Oct 2026; say if any is wrong):**
- **Save scan doesn't tick the paper:** staff tick what came in, as before.
- **When:** Save scan and On file work while the papers are ticked (Steps 1–2, the case open), and never for things we
  arrange. Save scan isn't offered for a paper marked Not needed.
- **Who opens the copy:** anyone who can see the case, so the processor can print it in Step 3, just as they open the
  saved file.
- **Which copy opens:** the one an On file paper came from, even after a newer scan; otherwise the current one.
- **Relinking a traveller** to another family member puts their On file papers back to Pending: those were the other
  person's copies. Papers that came in stay ticked.
- **A newer copy:** On file pressed again picks up a copy saved since the paper was ticked.

**Built 17 Oct 2026** (component 2, the vault in Step 2):
- **Data** (migration `20261017160000_case_scans`):
  - `ReceivedAs` gains `ON_FILE`.
  - `VisaCaseDocument.clientDocumentId` points at the scan the paper came from.
  - CHECKs, comparing as text because a new enum value can't be used in the migration that adds it:
    - `VisaCaseDocument_on_file`: ON_FILE exactly when the scan is set
    - `VisaCaseDocument_on_file_xerox`: ON_FILE only on a `XEROX_OK` paper
- **Ticking On file:** `PATCH /api/visa/cases/:caseNo/documents/:documentId` with
  `{ status: "RECEIVED", receivedAs: "ON_FILE" }`. Under the case lock, the server picks the current copy for the
  traveller's person and paper. It refuses with a 400:
  - for a paper not `XEROX_OK` ("Only papers that may be a xerox can come from the copy on file.")
  - for an unnamed traveller
  - when there's no copy ("There's no copy of "…" on file for Rakesh Mehta.")

  The `visa.document.update` audit carries `clientDocumentId`.
- **Relinking:** `linkTraveller` resets the traveller's On file papers in the same transaction, each audited.
- **`POST /api/visa/cases/:caseNo/documents/:documentId/scan`**, with the file as the body (PDF, JPEG or PNG), returns
  `{ case }`. It's for whoever can tick, in Steps 1–2. It refuses:
  - a thing we arrange, and an unnamed traveller (400)
  - another file type (415)
  - over `clients.documents.maxMb` (413)
  - after Step 2 (409)

  The scan goes in through the vault's own code (`saveClientScan`), audited `client.document.add` with `case`.
- **`GET /api/visa/cases/:caseNo/documents/:documentId/scan/link`:** anyone who can see the case (`visaView`,
  `findVisibleCase`); audited `client.document.open` with `case`. 404 when there's no copy.
- **The case DTO:** each paper sends `onFile` (the current copy, from one query of the linked people's scans) and
  `fromScan`; the case sends `scanMaxMb`.
- **Screen:**
  - "Came in as" offers **On file** beside Original and Xerox, only for a `XEROX_OK` paper with a copy.
  - Under the paper's name: "On file · saved 12 Mar · Open", or "From the copy of 12 Mar · Open", and **Save scan**
    (or "Save a newer scan").
  - In Step 3, an On file paper reads "On file", with **Open** for the processor.
  - Labels come from one map (`RECEIVED_AS_LABEL`), so no "came in as" value is missing a label.

### 6. Telling the client

**Decided 17 Oct 2026 (project lead):** a WhatsApp message tells the client we keep their scans. The consent form
doesn't change and there's no "I agree" step.

**Defaults (not asked; say if any is wrong):**
- **Once per client:** the first time any scan is saved for that client, not on every scan.
- **The wording** ⚠️ (ours; it becomes a template for Meta's approval): "Hello {name} ji, we keep a secure copy of your
  family's documents at Masti, so you won't need to bring them again for your next trip. Only our senior team can
  open them."
- **Not sent yet:** like every client message, it goes out once the WhatsApp outbox is built. The outbox sends it when
  a client's first scan is saved; nothing is stored for it now.

### 7. The "Scan not saved" warning

Saving a scan stayed optional (Decision 5): nobody asked for it to be required. On 19 Oct 2026 the project lead asked
for a warning instead, switched on per paper.

**Decided 19 Oct 2026 (project lead):**
- **A warning only:** it never stops a tick, a save or "Mark documents complete".
- **Switched on per paper** in Settings → Documents ("Warn if no scan is saved"), by whoever edits the document master.
  Seeded on for the **passport, Aadhaar card and PAN card** ⚠️; every other paper starts off.
- **When it shows:** the paper is ticked as came in (**Original** or **Xerox**), and no scan of it was saved for that
  person since the case was opened. A copy from an earlier trip doesn't count. A paper ticked **On file** never warns:
  it came from the vault.
- **Where:**
  - an amber "Scan not saved" note on the paper's row, beside **Save scan**
  - a "No scan saved yet" list in the **Mark documents complete** box, which still lets the case complete

**Defaults added when building (19 Oct 2026; say if any is wrong):**
- **An unnamed traveller never warns:** nothing can be saved for them until they're linked to a family member.
- **The switch is read live:** turning it on reaches cases already open, unlike a checklist's names, which intake
  copies.
- **The row note shows only to someone who can save the scan,** while the papers are being ticked (Steps 1–2).

**Built 19 Oct 2026:**
- **Data:** `DocumentMaster.warnIfNoScan` (default off), migration `20261019230000_scan_warning`. Changing it is
  audited `document.update`.
- **The case DTO:** each paper sends `noScan`. The server works it out from the switch, the tick, the traveller's
  link and the current copy's `uploadedAt` against the case's `createdAt`.
- **Tests:** `visaMasters.test.ts` (seeded switches, who may change it, audit) and `visaCaseScans.test.ts` (when it
  warns, an older copy, On file, an unnamed traveller, still matures).

### 8. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `clients.documents` (the largest scan, in MB) | `{ maxMb: 20 }` ⚠️ |
| The document master | the papers already there, plus Aadhaar card and PAN card |
| "Warn if no scan is saved" (Decision 7) | on for the passport, Aadhaar card and PAN card ⚠️ |
| The file name and the WhatsApp wording | ours ⚠️ |

## Not in this record

- **Deleting a scan:** never; the scans are kept permanently (settled 17 Oct 2026).
- **Reading a passport scan to fill forms** (Q13, S6): scope unconfirmed. The vault would be its input.
- **Clients uploading their own papers:** never (rule 4).
- **The field boy photographing papers:** scanning happens in the office (rule 4).
- **A paper's own expiry** (a bank statement older than six months): not tracked; staff judge by the date saved.
- **Searching every client's documents at once:** not built. Each client's list is on their page.
- **Other departments' case screens:** they reuse this vault when they're built (Stage 2).

## Still needed

- **M1:** the real WhatsApp wording.

Settled 17 Oct 2026 (project lead), no longer asked: **M40** (kept permanently, no removal, the full Aadhaar card) and
**S12** (charging is the project lead's call).
