# 0015 · The client document vault

- **Status:** decided (17 Oct 2026, project lead; Vimal wants the scans kept permanently). Being built one component at
  a time (Decision 1). A "Built" note is added under each part as its component lands.
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
- **Nothing is deleted:** there is no delete button. If Vimal's check with the government (M40) says a client may ask
  for removal, a Head-only delete, audited, is added then.
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

### 7. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `clients.documents` (the largest scan, in MB) | `{ maxMb: 20 }` ⚠️ |
| The document master | the papers already there, plus Aadhaar card and PAN card |
| The file name and the WhatsApp wording | ours ⚠️ |

## Not in this record

- **Deleting a scan:** waits for Vimal's answer from the government (M40).
- **Reading a passport scan to fill forms** (Q13, S6): scope unconfirmed. The vault would be its input.
- **Clients uploading their own papers:** never (rule 4).
- **The field boy photographing papers:** scanning happens in the office (rule 4).
- **A paper's own expiry** (a bank statement older than six months): not tracked; staff judge by the date saved.
- **Searching every client's documents at once:** not built. Each client's list is on their page.
- **Other departments' case screens:** they reuse this vault when they're built (Stage 2).

## Still needed

- **M40 (Vimal, after his check with the government):** may we keep scans permanently, and must a client be able to
  ask for removal? Aadhaar: the full card, or only the masked one (first eight digits hidden)? Aadhaar has its own law,
  stricter than the data-protection act (DPDP), so it needs its own clear answer before go-live.
- **S12 (Shivanshu):** the vault isn't in the demo screens. Is it a free change or a paid one (PID: new major features
  are charged and need Masti's written OK)?
- **M1:** the real WhatsApp wording.
