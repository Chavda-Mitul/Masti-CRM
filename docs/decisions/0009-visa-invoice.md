# 0009 · The visa invoice: the quote, the locked tax invoice and its PDF

- **Status:** decided (13 Oct 2026, project lead). Components 1–3, the quote, the invoice settings and raising the
  invoice, are built
  (13 Oct 2026). One point is waiting for Masti's accountant
  (Decision 9). A "Built" note is added under each part as its component lands.
- **Date:** 13 Oct 2026
- **Scope:** the price quoted on a visa case, and raising the visa tax invoice from it:
  - locked
  - numbered in Masti's series
  - GST on Masti's service charge
  - a stored PDF in Masti's layout
  - the company details and settings the invoice prints
- **Builds on:** [0008](0008-visa-docket-dispatch.md) (dispatch needs the invoice; the `company.details` setting),
  [0007](0007-visa-file-prep.md) (S3-compatible storage, `CaseFile`, short-lived links),
  [0004](0004-client-master.md) (the client's state code, PAN and GSTIN, and `clients.invoiceReadiness`).
- **Blocks:** the Dispatch card (0008 Decision 9). No file leaves without its invoice (golden rule 3).

## Context

What the sources say:

| Source | What it says |
| --- | --- |
| Meeting ✅, rule 3 | The invoice must exist before the file goes to the vendor. It is built from the quotation, with no manual amounts, and is never edited. At most one additional invoice per file; a recall gives a credit note for the embassy fee. Payment can come later, but Accounts sees the debit straight away. |
| Demo ⚠️ (screen 09) | The docket's Invoice column ("INV-0412 · locked" / "Raise invoice first"). The rule copy: "The invoice is built from the price quoted at the start — nobody types amounts — and can never be edited." The right rail shows "Money on this case". |
| Masti, 13 Oct 2026 (through the project lead) | Masti often quotes **one lump sum**, with no strict fee breakdown. There is no fee sheet per visa (the hand-over plan's B1 assumption is dropped). |
| Masti's two invoice PDFs (13 Oct 2026; real client data, kept out of the repo) | See below. |

**Masti's current TAX INVOICE** (from their accounting software's "Voucher (Single Print)"):

- **Header:** logo; address; office phone and 24/7 phone; accounts email; website; Masti's PAN and GSTIN (state 24,
  Gujarat).
- **Number and date:** `MVI` + 8 digits (e.g. `MVI00001378`), one running series that doesn't restart by year.
- **"To":** the paying client:
  - name, address, state and state code, mobile
  - GSTIN (businesses) and PAN
  - the place of supply
  - the SAC code 998559
- **One line per traveller:** `001 · traveller · COUNTRY(PURPOSE)(NORMAL)(SINGLE) · Visa`. Then either:
  - **itemised:** embassy fee, VFS fee, "All & Other", line total
  - **lump sum:** no fee columns, only the total
- **Totals (itemised example):**
  - gross total 3,410 + processing charges 500 + GST 90 = **4,000**
  - GST is 18% **on the processing charge only**; the embassy and VFS fees are passed on untaxed
  - the client is outside Gujarat, so it's IGST; inside Gujarat it would be CGST 9% + SGST 9%
  - the lump-sum example shows **no GST line**, and "Balance Amount" equals the total
- **Footer:**
  - the amount in words
  - the bank details
  - five fixed terms: Surat jurisdiction, no refund without the original invoice, 24% interest on delay, cheques
    to the company name, check the details
  - E. & O. E.
  - "Prepared by <staff>" and an ID
  - "computer generated", with a signature image

## Decision

### 1. The CRM makes visa invoices

From go-live the CRM issues the visa tax invoice: the number, the GST, the PDF, locked. Masti's current software
stops issuing visa invoices. An export to it can come later (Q26).

### 2. The quote: where every amount comes from

- **A quote on the case,** entered by whoever can act on it (the case owner, the Visa HOD, the Head) once the papers
  are known.
- **Per traveller, one of two forms:**
  - **Lump sum:** one amount.
  - **Itemised:** embassy fee, VFS fee, other.
- **Plus Masti's service (processing) charge for the case,** which may be 0. GST applies to this part only
  (Decision 3).
- **Editable until the invoice is raised.** Every change is audited. Once the invoice is raised, the quote is frozen.
- **The invoice copies the quote.** The invoice itself has no amount fields, so "nobody types amounts" holds where
  the demo means it: on the invoice.
- **Money is stored in paise, as integers,** never as floating point. Amounts can't be negative.
- **The processing speed** (the "(NORMAL)" on Masti's invoice line) is picked on the quote from an admin-editable list,
  seeded ⚠️ with Normal / Express / Super priority. **Decided 13 Oct 2026 (project lead).**
- **Editable from Step 1** (the Enquiry step), so the price can be noted when it's first given to the client, until
  the file goes to the vendor. **Decided 13 Oct 2026 (project lead).**

**Built 13 Oct 2026** (component 1, the quote):

- **API and data:**
  - `PUT /api/visa/cases/:caseNo/quote` with
    `{ processingSpeedId, serviceChargePaise, lines: [{ travellerId, form, … }], updatedAt }`, which returns
    `{ case }`.
  - Tables `VisaQuote` (one per case), `VisaQuoteLine` (one per traveller) and `ProcessingSpeed` (migration
    `20261013120000_visa_quote`).
  - Hand-written CHECKs:
    - every amount is 0 to ₹10,00,000 (a sanity limit)
    - the amounts match the form: a lump sum has only `lumpSumPaise`; itemised has the three fees (0 allowed)
  - Audited as `visa.quote.save` on the Enquiry, with `clientId`; before and after are the whole quote.
  - The case sends `quote { processingSpeed, serviceChargePaise, lines (each with totalPaise), travellersPaise,
    gstRatePercent, gstPaise, totalPaise, complete, updatedAt, updatedBy }`, plus `gstRatePercent` for a quote not yet
    entered.
  - The master list is at `GET/POST/PATCH /api/masters/processing-speeds`.
  - **The setting `visa.invoice`** (Decisions 3 and 4) was brought forward into this component, because the GST
    preview needs the rate. It's changed through `PUT /api/visa/settings`.
- **Screen:**
  - **"Money on this case"** in the right rail, as in the demo: each traveller's amount, the service charge, GST,
    the total, the processing speed, and who quoted it and when. **Add quote** / **Edit quote** for whoever can act
    on the case.
  - The quote dialog has:
    - the processing speed
    - per traveller, a **Lump sum / Itemised** switch with the amounts in rupees
    - the service charge
    - live totals
  - Settings → Masters → Lists → **Processing speeds**. It reuses the generic option table, with the follow-up
    dropdowns.
- **Settled while building:**
  - **The quote has its own token** (`updatedAt`, null for a new quote). Two people editing it can't overwrite each
    other. A stale save closes the dialog and reloads the case with the usual warning.
  - **Saving moves neither the case's `updatedAt`** (like trip details, so nobody else's page goes stale) **nor the
    quote's own token** when nothing changed. An unchanged save writes no audit row either.
  - **The lines must be exactly the case's travellers.** Lump-sum and itemised fields can't be mixed: the other
    form's fields are refused, not ignored. An itemised blank counts as 0 on the screen.
  - **A processing speed switched off since** it was picked can be kept, but not chosen anew.
  - **GST:** `src/lib/money.ts` rounds half up to the paisa (₹3.33 at 18% → 60 paise). `splitIntraState` puts the odd
    paisa on CGST, ready for the invoice. The frontend's preview uses the same sum.
  - **Errors on one line** come back grouped under `lines` (the shared error handler keys on the first path segment),
    so the dialog checks each traveller's amount itself before sending.
  - **"Frozen once invoiced"** is added with component 3, when invoices exist.

### 3. GST

- **Only on Masti's service charge,** at a rate setting: 18% ⚠️.
- **The SAC code** is a setting: 998559 ⚠️.
- **Place of supply = the client's state code** (from the client master):
  - the same as Masti's (24): **CGST + SGST**, half the rate each
  - any other state: **IGST**
- **The embassy, VFS and other amounts carry no GST** (passed on).
- **A quote with no service charge gets no tax line,** like Masti's lump-sum invoice today.
- ⚠️ **Masti's accountant must confirm** the GST treatment, including lump sums with no service charge. We build what
  their current invoices show; we aren't tax advisers.
- **Rounding:** the tax is worked out in paise and rounded to the nearest paisa. CGST and SGST are each half of the
  total tax; if it doesn't split evenly, the odd paisa goes to CGST. The amount in words is in Indian numbering
  ("Four Thousand Rupees").

### 4. The number series

- **Continue Masti's own:** prefix `MVI` ⚠️ + 8 digits ⚠️, **never restarting** by year.
- **Settings:** the prefix, the digit count and the **starting number.** At go-live the Head sets it to follow
  straight on from Masti's last voucher.
- **A single counter row,** bumped in the invoice's own transaction (like `CaseCounter`). A refused or failed raise
  rolls back, so no number is skipped.
- This **replaces the 9 Oct 2026 decision** that the series was "our choice".

### 5. When it's raised, and by whom (answers Q6)

- **Who:** the case owner (processor), the Visa HOD or the Head. The invoice is locked once raised, so letting the
  processor raise it carries no risk.
- **When:** any time after the quote is entered, at any step until dispatch. It is **strictly required before the
  docket is dispatched** (0008 Decision 9).
- **The client's details must pass `clients.invoiceReadiness` first.** For individuals: name, address, city, state;
  for companies, also a contact person and GSTIN. If anything is missing, the button lists it.
- **A confirm step** shows the travellers, the amounts, the GST and the total before raising, because a raised
  invoice can't be undone (Decision 9).

### 6. One invoice per case

- **Each visa case gets one invoice,** with **one line per traveller:**
  `001 · name · FRANCE(TOURIST)(NORMAL)(SINGLE) · Visa` ⚠️, where NORMAL is the quote's processing speed (Decision 2)
  and SINGLE the entry type.
- **Two cases for the same client get two invoices.**

### 7. The PDF

- **Made on the server once,** when the invoice is raised (`pdf-lib`, already used for page counts), in Masti's
  layout (Context).
- **Stored privately** in the S3-compatible store, as a `CaseFile` of a new kind `INVOICE`, and **never regenerated.**
  It stays exactly what the client received, even if the company details change later.
- **Opened through a short-lived pre-signed link,** audited, like the saved file. It's ready to be sent by WhatsApp
  later.
- **Upload first, then commit,** as with the saved file. If the PDF can't be stored, the invoice isn't raised and its
  number is rolled back.
- **Fonts (decided 13 Oct 2026, project lead):** the free **Noto Sans** (Regular and Bold, SIL Open Font Licence) is
  embedded, for the ₹ sign. Invoices are in English: **a name the font can't print (Gujarati letters, for example)
  blocks raising** with "Enter these in English letters".

**Built 13 Oct 2026** (component 3, raising the invoice):

- **API and data:**
  - `GET /api/visa/cases/:caseNo/invoice/check` returns `{ blockers, alreadyRaised, preview }` for anyone who can
    open the case. Each blocker is grouped by kind: `QUOTE`, `TRAVELLERS` (unnamed), `CLIENT` (the readiness setting,
    plus the state), `COMPANY` (Decision 8's list) and `NOT_ENGLISH`.
  - `POST /api/visa/cases/:caseNo/invoice` with `{ quoteUpdatedAt }`, for the case owner, the Visa HOD or the Head,
    from Enquiry to Docket & dispatch. It's refused with 409 `INVOICE_BLOCKED` `{ blockers }`, 409 STALE if the quote
    changed since the dialog, or 409 if already raised.
  - Tables `Invoice` (snapshots of the client, Masti and the terms; place of supply; tax type; the totals in paise),
    `InvoiceLine` and `InvoiceCounter`, plus `CaseFileKind.INVOICE` (migration `20261013140000_invoices`).
  - **Triggers refuse any UPDATE or DELETE of an invoice or its lines.** CHECKs make the total add up, the tax match its
    type, and the line amounts match the form.
  - **The number:** `GREATEST(last + 1, startAt)`, bumped in the invoice's transaction. A refused raise uses no number;
    raising the starting number jumps forward; lowering it reuses nothing.
  - Audited as `visa.invoice.raise`. The PDF opens through the existing `/files/:fileId/link`, audited as
    `visa.file.open`. A raised invoice freezes the quote ("Invoice MVI… is raised, so the quote can't change").
- **The PDF** (`src/modules/visa/invoicePdf.ts`) is A4, in Masti's layout:
  - the orange band; the address and contacts; the logo
  - PAN | GSTIN; the To block; the TAX INVOICE box with the number and date
  - the traveller table: fee columns when any line is itemised, otherwise just Service and Total
  - Gross total, processing charges, GST; the total and the balance; the amount in words
    (`src/lib/amountInWords.ts`, Indian numbering)
  - the GST table (CGST/SGST or IGST); the bank details; the terms
  - "for MASTI TOUR AND TRAVEL" with the signature; "Prepared by"
  - Many travellers flow onto more pages.
- **Screen:** "Money on this case" gains **Raise invoice** once the quote is complete. The confirm dialog lists the
  blockers with links to fix them, or shows each amount, the GST split, the total and the number it will get, with a
  warning that it can never be edited. Once raised, the panel shows "**MVI… · locked**", the total, who raised it, and
  **Open invoice**.
- **Settled while building:**
  - **The whole font is embedded, not a subset:** pdf-lib's subsetting dropped most of Noto Sans's glyphs (the text
    extracted but didn't show). Each invoice is about 630 KB.
  - **The line's entry type** is left out until the trip details give it (e.g. at the Enquiry step:
    `FRANCE(TOURIST)(NORMAL)`).
  - **The client's state is always needed,** whatever the readiness setting says, because it decides CGST + SGST or
    IGST.
  - **A long amount in words wraps** within its half of the total row. The client's mobile prints as
    "+91 98250 41237".

### 8. What it prints: the settings

**The `company.details` setting gains** (the Head edits it in Settings → Company & invoice):
- the 24/7 phone, the accounts email and the website
- **Masti's PAN, GSTIN and state code** (24, which decides CGST+SGST versus IGST)
- **the bank details:** account name, number, bank, branch, IFSC, SWIFT

**The terms** are an editable, ordered list of lines (a setting), seeded with today's five ⚠️.

**Images: the logo and the signature** (the project lead's choice). The Head uploads each once:
- they are stored privately
- replacing one is Head-only and audited
- the signature is printed on every invoice, as on today's PDF

**Also printed:**
- **"Prepared by":** the person who raised the invoice.
- **The "Balance" line:** equal to the total until payments exist (Decision 10).

**A snapshot is taken at raise time.** The client's name, address, state, GSTIN and PAN, and Masti's details, are
copied onto the invoice. A later edit to the client or the company never changes an issued invoice.

**Decided 13 Oct 2026 (project lead):**
- **The Head types Masti's PAN, GSTIN, state and bank details in.** They start empty; nothing like a bank account
  number is kept in the code or the seed.
- **The settings live on the Masters page** (the Company details card grows), not in a new Settings tab.
  *Changed later the same day (the project lead):* they moved to their own tab, **Settings → Company & invoice**,
  together with the Invoice numbering & GST card.

**Built 13 Oct 2026** (component 2, the invoice settings):

- **API and data:**
  - **`company.details`** gains the 24/7 phone, email, website, PAN, GSTIN, state code and `bank { accountName,
    accountNo, bankName, branch, ifsc, swift }`. All are optional and start empty, so the existing row still reads.
  - **The same checks as a client's:** the PAN, GSTIN (with its check character), state and IFSC formats. The GSTIN's
    PAN and state must match; an empty PAN or state is filled in from the GSTIN.
  - **`GET /api/company/details`** returns `{ details, images, missingForInvoice }`. `missingForInvoice` lists what the
    first invoice still needs: PAN, GSTIN, State, Bank details, Logo, Signature. Component 3 refuses to raise an
    invoice while it isn't empty.
  - **`invoice.terms`:** a list of 1–10 lines, seeded ⚠️ with the five on Masti's current invoices, at
    `GET/PUT /api/company/invoice-terms`.
  - **The logo and signature:** the table `CompanyImage` (migration `20261013130000_company_images`), uploaded by the
    Head with `PUT /api/company/images/logo|signature`. The body is the PNG or JPEG itself, at most 2 MB. It's
    audited as `company.image.upload`. The newest is current; older ones are kept. Office users open them with
    `GET /api/company/images/:kind/link`.
  - **`src/lib/storage.ts`** gains `getObject`, for the invoice PDF to embed the images.
  - **`src/middleware/requireJson.ts`** now takes PNG and JPEG uploads, and compares the exact media type (so
    `application/jsonx` or `image/pngx` is refused).
- **Screen (Settings → Company & invoice, a tab of its own since 13 Oct 2026):**
  - **"Company details & invoice"**, a full-width card:
    - Company, Tax and Bank sections; the Head edits
    - the invoice terms, one per line
    - logo and signature tiles with previews
    - an amber "Needed before the first invoice" note
    - everyone else reads it
  - **"Invoice numbering & GST":** prefix, digits, **starting number**, GST rate and SAC, with a preview of the first
    number (e.g. `MVI00001379`). The Visa HOD or the Head edits it.
- **Settled while building:**
  - **pdf-lib reads a Node `Buffer`'s whole backing memory,** and a small Buffer shares it with others. So an uploaded
    image is handed to pdf-lib as a plain copy, both when it's checked at upload and later in the PDF.
  - **The sticker's "From"** still prints only the name, address and phone, never the tax or bank details.

### 9. Never edited; corrections

- **No edit route,** and **a database trigger refuses any UPDATE or DELETE** on an issued invoice and its lines, like
  `AuditLog_append_only` (migration `20261007191550_auth`).
- **The one additional invoice per file and the credit note** (a recall refunds the embassy fee only) come with
  **Step 5**, in their own record.
- ❓ **Open: correcting a wrong invoice before dispatch.** This is a question for Masti's accountant. One option is
  for the Visa HOD to cancel it with a reason (kept on record, number used) and re-raise; the other is a credit note
  only. **Until it's answered, a raised invoice can't be undone,** so the confirm step (Decision 5) matters.

### 10. Not in this record

- **Payments and the real "Balance":** the Accounts module.
- **Sending the invoice by WhatsApp:** waits for the WhatsApp work.
- **Cross-sell leads** when an invoice is raised (§10.7).
- **An export to Masti's current accounting software** (Q26).
- **The additional invoice and the credit note:** Step 5.
- **Other departments' invoices.** The tables are named for visa now; the design leaves room for a department column
  later.

## Schema (sketch, to confirm in each component's plan)

```prisma
enum QuoteForm   { LUMP_SUM ITEMISED }

model VisaQuote {                       // one per visa case
  enquiryId String @id
  serviceChargePaise Int @default(0)
  updatedById String; updatedAt DateTime @updatedAt @db.Timestamptz(3)
  lines VisaQuoteLine[]
}
model VisaQuoteLine {                   // one per traveller
  travellerId String @id
  form QuoteForm
  lumpSumPaise Int?; embassyFeePaise Int?; vfsFeePaise Int?; otherFeePaise Int?
}

model Invoice {
  id String @id @default(uuid()); invoiceNo String @unique      // MVI00001379
  enquiryId String @unique                                      // one per case (Decision 6)
  issuedAt DateTime @db.Timestamptz(3); issuedById String
  client Json; company Json                                     // snapshots (Decision 8)
  placeOfSupply String @db.Char(2); sac String; gstRateBp Int   // 1800 = 18%
  grossPaise Int; serviceChargePaise Int; cgstPaise Int; sgstPaise Int; igstPaise Int; totalPaise Int
  fileId String @unique                                         // the stored PDF (CaseFile kind INVOICE)
  lines InvoiceLine[]
}
model InvoiceLine {
  invoiceId String; position Int; travellerName String; description String
  form QuoteForm; lumpSumPaise Int?; embassyFeePaise Int?; vfsFeePaise Int?; otherFeePaise Int?; totalPaise Int
  @@id([invoiceId, position])
}
model InvoiceCounter { id Int @id @default(1); lastValue Int }   // one row; the starting number is a setting
```

**Hand-written in the migrations:**
- the immutability trigger on `Invoice` and `InvoiceLine`
- CHECKs: amounts ≥ 0; the line's form matches which amounts are set; `cgst = sgst = 0` when IGST is used, and the
  reverse; total = gross + service charge + tax

**Settings:**
- `visa.invoice` → `{ prefix: "MVI", digits: 8, startAt: 1, gstRatePercent: 18, sac: "998559" }` ⚠️
- `invoice.terms` → a list of lines ⚠️
- `company.details` gains the fields in Decision 8
- the logo and signature are stored files, referenced from settings

## Components (one at a time, each planned, built, tested and committed on its own)

1. **The quote card** on the case: per-traveller lump sum or itemised, the service charge, the totals and GST
   preview; editable until invoiced; audited. **Built 13 Oct 2026**, with the processing speed and the `visa.invoice`
   setting.
2. **Invoice settings:**
   - the extended Company details card: fields, bank, terms
   - the logo and signature upload
   **Built 13 Oct 2026,** with the Invoice numbering & GST card.
3. **Raise the invoice:**
   - the readiness checks and the confirm step
   - number, snapshot, GST, lines
   - the PDF, made and stored
   - the immutability trigger
   - the Invoice card / "Money on this case"
   **Built 13 Oct 2026.**
4. **The Docket card's Invoice column:** "MVI… · locked" or "Raise invoice first".

Then 0008's Dispatch card, with the invoice check.

## Tests (rule logic), by component

- **Quote:**
  - who may edit; frozen once invoiced
  - lump sum versus itemised validation; no negative amounts
  - paise arithmetic
  - audited
- **GST:**
  - Gujarat client: CGST + SGST
  - other state: IGST
  - no service charge: no tax
  - rounding, including the odd paisa going to CGST
  - the rate setting
- **Raising:**
  - who may raise; refused without a quote
  - refused when the client isn't invoice-ready (listing what's missing)
  - one per case
  - the numbers follow the starting number with no gaps; a failed PDF upload rolls back the number
  - the snapshot doesn't change when the client is edited later
  - the trigger refuses UPDATE and DELETE
  - the amount in words
- **Races:** two raises at once on one case give one invoice; two cases raising at once get consecutive numbers.
- **Dispatch** (with the Dispatch card): refused while any case in the docket has no invoice.

## Still needed from Masti

- **Their accountant:** confirm GST on the service charge only, the lump sum with no tax line, and how a wrong invoice
  is corrected before dispatch (Decision 9).
- **The last `MVI` number** before go-live (the starting number).
- **The logo and signature artwork** (or the Head uploads them).
- **Confirm "NORMAL"** in the line description (processing speed?).
