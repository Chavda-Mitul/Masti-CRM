# Masti CRM: project understanding

*Product review, 18 Oct 2026. Read-only: nothing in the project was changed.*

**Sources:**
- the docs and the requirements pack (`Masti-CRM-Handover/`)
- the decision records in [docs/decisions/](docs/decisions/)
- the code on `master` (`95ff1fb`)

**Evidence:**
- For this review, nobody clicked through the app or re-ran the tests.
- A full run on 18 Oct 2026 recorded **all 575 backend tests passing on this commit**.
- Each visa piece was checked in a browser when it was built.
- **The frontend has no automated tests.**

## 1. Product overview

- **The problem:** Masti Tours & Travels (Surat; the owner, Vimal, decides everything) runs on WhatsApp screenshots and Excel.
  - Vimal can't see how much business is lost, or why.
  - ₹1.75 Cr is still to be collected from clients.
  - Staff share portal passwords.
  - Visa papers and passports are tracked from memory.
- **The software:** one CRM for five selling departments (Visa, Holidays, Hotels, Insurance with claims, Tickets), plus Accounts and a phone screen for the collection/delivery boy.
- **Vimal's two goals:**
  1. Measure lost business and the reasons.
  2. Automation: the system guides each step and messages clients on WhatsApp by itself.
- **Rules that shape everything:**
  - No free text for reasons or outcomes, only dropdowns the admin can edit.
  - Invoices are built from the quote and never edited. Mistakes are fixed with a credit note, and a visa file allows one additional invoice.
  - Every action records who and when (plus GPS for field work).
  - Roles go Staff → HOD → Head.
  - Staff never see portal passwords.
  - Every number in the demo is a setting, not fixed.
- **The contract (PID):**
  - Scope is every screen in the approved demo.
  - Go-live is 1 Jan 2027, on Masti's own servers.
  - Payment comes in three stages: Visa → Departments → Accounts/Reports/Settings plus go-live.

## 2. How it works

**Roles**

- **Head (Vimal):** everything, including users, the masters (the lists and rules the system runs on) and invoice settings.
- **HOD (one per department):** the whole department. Assigns processors, handles money exceptions (such as a bigger recall refund), and manages vendors, lists and the client document store.
- **Office staff:** their own cases (Edit access), or the whole department's cases read-only (View access).
- **Field staff:** phone only, and only their own jobs.
- **Clients** never log in. Today the only thing they receive is a code by email at pickup or delivery.

**Workflow A: a visa case (built)**

1. **New enquiry:** the client's mobile and name, how the enquiry came in, country, visa type, adults/children and travel month. This creates case `VISA-2026-0001` with a document checklist for each traveller.
2. **Documents:** staff tick each paper per traveller and log calls using dropdowns. They can book the collection boy. Then **Mark documents complete**.
3. **File preparation:** the HOD assigns a processor. The processor enters each traveller's application number and appointment, the trip dates, the final file as one PDF, and the vendor. Then **File ready**.
4. **Invoice:** the processor enters a quote, then **Raise invoice**. The invoice is locked, with GST on the service charge, as a PDF. A file can't be dispatched without it.
5. **Dispatch:** the file goes into the vendor's docket (one courier parcel for that vendor). Staff print the parcel sticker and enter the courier and AWB (tracking) number. The vendor gets an email.
6. **At the vendor:** "Vendor got it", then "Mark submitted" with the file number, embassy and collection date. Embassy holidays and Sundays can't be picked. If needed, there's also:
   - a recall, with a credit note for the embassy fee
   - the one additional invoice
   - a credit note plus a replacement invoice
7. **Decision and return:** the decision is recorded per traveller, then **Passports on the way back**, then **Mark received** (booklets counted, stickers checked). If fewer passports come back than went out, the handover is held.
8. **Handover:** at the office (booklets counted, who collected, a photo) or by the delivery boy. The case closes as Delivered.

**Workflow B: the collection/delivery boy (built)**

1. The office books him for a day, a time slot and an address. The client needs an email address for the one-time code.
2. His phone shows the day's stops, each with Call and Directions buttons.
3. **Pickup:** count the booklets, enter the client's code, take a selfie that records place and time. **Delivery** also needs the receiver's photo, and the count must match the passports in the office's stock.
4. Or **Couldn't complete**, with a reason. The case goes back to the office.

**Workflow C: setup (built)**

- The Head adds users and their roles. Deactivating someone logs them out everywhere at once.
- The Head and HODs keep the holiday calendar, visa checklists, dropdown lists, vendors, couriers, time slots and company/invoice details up to date.

**Planned, not built:** the other departments follow the same pattern:
1. enquiry
2. quote
3. the client agrees (by a one-time code, for hotels and tickets)
4. locked invoice
5. Accounts chases payment
6. leads for the other departments are created automatically ("cross-sell")
7. reports on what was lost and why

## 3. Current status

**Complete** (code, tests and browser checks)

- **Sign-in, roles, users and the audit log.** The database refuses any edit to the log.
- **Clients:** profile, family and travellers, passport expiry, notes, duplicate warnings, and a store for scanned documents.
- **Masters and lists:** the setup items listed in Workflow C.
- **All 8 visa steps**, including invoice, credit note, recall and the additional invoice. The database itself blocks editing an invoice and raising a second additional invoice.
- **Follow-up desk** (Overdue / Today / This week / Postponed). It covers visa only, because no other department exists yet.
- **Field staff app.** The project lead tested it by hand on 17 Oct, on a laptop, and found it working.

**Partly complete**

- **Enquiries:**
  - No visa **Board** view (the kanban in the demo).
  - No global search: there's no header bar at all.
  - New enquiry works for visa only.
  - No "fill in from a WhatsApp message", which the PID promises.
- **Visa:**
  - No covering letter, no "Log in for me" and no passport-scan autofill.
  - E-visa cases stop at Step 6 and can't be finished.
  - An enquiry can't be marked **Lost**, only postponed or cancelled (`Backend/prisma/schema.prisma:874`).
- **Clients:** the "Business with us" and "Still to pay" tiles are empty until Accounts exists. The cases list shows open cases only.
- **Settings:**
  - Five areas say "Soon": Portal logins, Reminder rules, Hotel markups, Covering letters and Routine tasks.
  - Most visa timing settings (such as "check back the next office day at 11:00") have no screen. They can only be changed through the API.

**Unverified**

- Anything in production: real email (SMTP), HTTPS (the camera and GPS need it), and the field app on a real phone.
- Three suspected bugs from the 17 Oct code review, never confirmed:
  - "Change" dialogs can overwrite someone else's save.
  - Changing a visa's "Vendor needed" switch can strand cases already in progress.
  - Some due times are set in the past.
- Uncommitted edits to the Money section on the case page, from another session (as of 18 Oct).

**Missing**

- **Today** dashboard: the page is a placeholder. It belongs to Stage 1.
- **All of Stage 2:** Holidays, Hotels, Insurance with renewals, Claims and Tickets. Only a filter on the enquiries list exists.
- **Accounts:** no payment recording, invoice follow-up, compulsory call after sending, limit of two follow-ups, or billing-cycle days.
- **Cross-sell leads, Reports, the Notice board** and the visa team's login popup.
- **A scheduler for timed jobs**, so there are no automatic reminders.
- **Go-live work:** no CI, deploy scripts, runbook, or running-cost sheet (the PID requires the cost sheet before go-live).

**Blocked**

- **WhatsApp messages to clients**, the consent "I agree" link and document reminders. These need Masti's WhatsApp Business and Meta access, plus the message wording (M1, M2).
- **One-time codes by SMS** need an SMS provider and DLT registration (A7). **Email in production** needs Masti's SMTP account (A6).
- **Covering letters** (M13), **consent wording** (M12) and **what happens after an e-visa decision** (M39).
- **"Log in for me":** nobody has yet tested whether it can work on real portals (Q4).
- **Stage 2 details:** questions M20–M28 have no answers yet.

## 4. What's missing compared with the requirements

- **Stage 1 (Visa, target mid-Nov):** the core flow is done.
  - Not blocked: Today, the visa board, global search and fill-in from a message.
  - Waiting on Masti: WhatsApp updates, reminders, the consent link and the covering letter.
- **Stage 2 (target mid-Dec):** not started. The demo never designed enquiry forms for these departments.
- **Stage 3 (by 1 Jan):** only the visa follow-up desk is done. Accounts, cross-sell, reports, the notice board, the portal password vault and deployment remain.
- **Everything in the Missing list is in the demo or the PID**, so it's committed scope. The open questions affect details, not whether to build.
- **Built beyond the demo:**
  - the client document store (change request #5, possibly chargeable)
  - the processor re-checking every paper (#6)
  - handing passports back when a case is cancelled before dispatch (#7)

  These are listed in [docs/change-requests.md](docs/change-requests.md).
- **Unclear:**
  - Does "cancelled" count as "lost" in the reports?
  - What goes in the four report tabs the demo didn't design?
  - What holiday AI already exists?
  - Does the hotel rate check apply to the hotels Masti uses regularly?

**Top risks**

1. **Timeline:** about 10 weeks to go-live, Stage 2 hasn't started, and Meta and DLT approvals take weeks. Under the PID, dates only move if Masti's delays are flagged in writing.
2. **No client messages yet:** automation is half of Vimal's goal, and nothing reaches clients today.
3. **Visa data errors:**
   - A sticker marked "doesn't match" can't be corrected.
   - Nothing warns about an adult in a child slot, a passport expiring before travel, a visa that doesn't cover the trip, or duplicate sticker numbers.
   - Once documents are marked complete, the person who collected them can no longer see the case.

   These mistakes end up on a client's real passport.
4. **Personal data:** full Aadhaar card scans are kept forever with no way to remove them, and this was decided without a legal check (S11, M40). India's DPDP Act gives people a right to have data erased, and Aadhaar has its own rules on storage. This is hard to undo after go-live.
5. **Field app in production:** it needs HTTPS and SMTP. Until SMS exists, every client also needs an email address, and many walk-in clients may not have one.

## 5. Questions for the client

**Urgent**

1. WhatsApp: the business number, Meta Business Manager access, verification documents, and the list of messages with their wording (M1, M2).
2. An SMTP account (A6), an SMS provider with DLT registration (A7), and a server or cloud account with a domain (A1, A2).
3. One decision-maker, plus a contact in each department (M3).
4. The consent wording (M12) and the covering-letter formats (M13).
5. What happens after an e-visa decision (M39)?
6. Confirm what was built on our assumptions:
   - follow-up is done by the employee assigned to the case (M4)
   - the visa decision is recorded per traveller (M10)
   - the handover steps (M14)
   - Sundays are blocked (M15)
   - what happens on a cancel after dispatch (M41)
   - a short passport return holds the handover (M42)
   - one docket per vendor (Q1)
7. The last MVI invoice number (M7), and whether GST applies to extra charges (M38a).

**Ask now for Stage 2:** M20–M28.
- Hotels: markups, competitor sites, the hotels Masti uses regularly.
- Insurance: which insurers.
- Tickets: fare input, Galileo, the 72-hour check-in list, the ticket copy, fare changes.

**For Stage 3:**
- what the reports show (M31)
- dashboards per role (M32)
- who approves a third follow-up (M33)
- whether routine tasks stay in (M34)
- the accounting software (M30)
- IVS, the visa news feed (M29)

**New question:** should "cancelled" count as "lost", and what are the real lost reasons?

**For Shivanshu:**
- S1 (is the PID signed and the advance paid?) is still blank in [QUESTIONS_TO_ASK.md](QUESTIONS_TO_ASK.md).
- Scope: PAN verification, Google login, passport autofill, office-only login and automatic alerts.
- Whether the document store is charged.
- The legal check on Aadhaar.

The full question list, with every M#, Q#, A# and S# code, is in [QUESTIONS_TO_ASK.md](QUESTIONS_TO_ASK.md) and `Masti-CRM-Handover/05_Open_Questions.md`.

## 6. Next steps

- **P0: Send the urgent and Stage 2 questions this week, and get the answers in writing.** Lead times are the biggest threat to 1 Jan.
- **P0: Walk five workflows by hand.** This confirms what's built and rehearses the Stage 1 demo. Do each as Staff, HOD, Head and View-only.
  1. A two-traveller visa case from New to Delivered, with one refusal.
  2. A wrong invoice, then a credit note and a replacement; then a recall and the additional invoice.
  3. A pickup and a delivery on a real phone.
  4. Cancelling a case while it's at the vendor.
  5. A short passport return.
- **P0: Log the open review findings as GitHub Issues.** Issues is empty, so these findings exist only in session notes.
- **P1: Finish Stage 1's unblocked items:** Today, the visa board, global search and the review fixes. They're confirmed requirements, and they unlock the Stage 1 payment.
- **P1: Build the message queue (outbox) and the scheduler for timed jobs, with placeholder wording.** Reminders, the consent link and every client update depend on them. The WhatsApp provider and the real wording plug in later.
- **P1: Set up a staging server with HTTPS.** Weekly demos need it, and so do the phone's camera and GPS.
- **P2: Spend a fixed few days testing whether "Log in for me" can work.** It's the biggest technical unknown, and Shivanshu needs to hear early what can't be done.
- **P2: Build Accounts on the visa invoices, then "mark as Lost" and cross-sell.** The rules are confirmed, and they feed Vimal's main report.
- **P3: Build the Stage 2 departments** in the order their answers arrive.

**Don't build these until the requirements are clear:**

- holiday AI quotes
- details of the hotel rate check
- reading ticket screenshots with AI
- passport autofill
- PAN verification, Google login and office-only login
- the report tabs and dashboards the demo didn't design
- IVS, weather and automatic alerts
- the export to the accounting software
- any new feature beyond the demo without Shivanshu's OK

**One caution:** the summary sections of [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md) (§1, §5, §16.4) are out of date. Trust [docs/decisions/](docs/decisions/) first.
