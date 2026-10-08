# Masti CRM: questions to ask

Every question we still need answered before or during the build, in one place. It was compiled on 7 Oct 2026 from:
- the handover's open questions
- the full meeting transcript
- the contract (PID)
- the gaps found while writing `PROJECT_KNOWLEDGE.md`

## How to use this file

1. **Go through Part 1 with Shivanshu first** (the day-2 walkthrough). Some of his answers change what we ask the client.
2. **Send the Masti questions in the client WhatsApp group, batch by batch.** Keep the numbers (M1, M2…) so answers are easy to match. A ready-to-paste message for batch 1 is at the end.
3. **Confirm every answer in writing** in the group, e.g. "Confirming: web check-in list 72 hours before departure. OK?"
4. **Record each answer** (with the date and who answered) in the Answer column. Then update `Masti-CRM-Handover/05_Open_Questions.md` and `PROJECT_KNOWLEDGE.md`.
5. **If an answer turns into a request for something new**, don't agree to it in the group. Check with Shivanshu first: it may be a paid change.

**References:**
- `Q#`: the open questions in `PROJECT_KNOWLEDGE.md` §18. Q1–Q30 are also in `05_Open_Questions.md`.
- `§`: a section of `PROJECT_KNOWLEDGE.md`.
- "inputs A1…D6": items in the client inputs checklist (`PROJECT_KNOWLEDGE.md` §19).

---

## Part 1 · For Shivanshu (ask first)

| # | Question | Why it matters | Ref | Answer (date) |
|---|---|---|---|---|
| S1 | Is the PID signed, and has Masti's advance been received? Can heavy build work start? | The contract says work starts when the advance arrives. | PID §04 | |
| S2 | Holiday AI quote: what was built or discussed with Masti before, where is it, and what should change? | Vimal said "whatever was built, change from there". Stage 2 depends on it. | Q16 | |
| S3 | The PID states some demo sample values as scope: reminders "every 2 days", a web check-in list "72 hours" before each flight, "per-traveller" visa decisions, "up to 4" hotel options, minimum markup "by star rating", and three named rate-check sites. Are these fixed, or do we confirm each one with Vimal? If he changes one, is that a free workflow change? | The handover marks them as unconfirmed demo samples, but the contract states them as scope. | §17 #1–6 | |
| S4 | PAN verification: in scope or not? It's in the PID's third-party costs but not in the demo. Vimal raised it only "as an example" ("whether you put it in our system or not is a separate matter"). | Stops the client assuming it's included. | Q23 | |
| S5 | Google Workspace login through the CRM, so one switch-off ends all of a leaver's access: in scope, and is it feasible? It's in the PID's third-party costs but not in the demo. | Same as S4. | Q15 | |
| S6 | Visa form autofill from a passport scan: in scope? The handover says it's not in the demo, but demo step 3 shows "Read passport scan" and "Fill from consent & trip details" buttons. | The client has seen those buttons. | Q13, §17 #14 | |
| S7 | "White-label, IP-based" CRM login: Vimal said this was "discussed earlier". What was discussed or agreed? | Needed before asking Masti for office IPs (M19). | Q14 | |
| S8 | Are there notes or designs from earlier meetings with Masti? The transcript mentions things "designed earlier" (the passport handover OTP/photo flow) and "discussed earlier" (holiday automation, white-label login). | Fills the gaps behind M14 and S2. | Q12 | |
| S9 | At the close Vimal named his targets as "lead generation and automation". Did he mean capturing every lead in the system, or is he expecting marketing / lead-generation features? | Clarify this before the client assumes marketing features are in scope. | §17 #25 | |
| S10 | Notice-board automatic alerts and the weather widget: in or out? If in, what data sources? | Both are in the demo, but the client called them "if technology allows" / nice-to-have. | Q25 | |
| S11 | The CRM will store passport numbers, dates of birth, income and addresses. Do we need anything formal for India's DPDP Act (consent wording, how long we keep data, a breach process)? | This is sensitive personal data, at scale. | §16.5 | |

---

## Part 2 · For Masti (Vimal and team)

### Batch 1 · Visa stage and setup (send now)

| # | Question | Why we ask | Ref | Answer (date, who) |
|---|---|---|---|---|
| M1 | **Urgent.** WhatsApp messages: please send the list of steps at which clients should get a WhatsApp message, and the wording for each. Also, which office address should the messages give for collecting passports? | Meta must approve every message template, which takes days to weeks. The wording in our demo was only a sample. | Q8, inputs C2 || 8 Oct, project lead: placeholder text in the build for now. **Still need the wording and the office address from Masti.** |
| M2 | **Urgent.** Which of these do you already have? A WhatsApp Business API account (and which number to use), an SMS provider with DLT registration, an IVS subscription, a cloud or server account (AWS, Google Cloud or DigitalOcean), your domain. We'll apply for anything you don't have. | Under the contract, Masti gives access to what already exists and we apply for what's new. WhatsApp verification also needs your Meta Business Manager access and business documents. | inputs A1–A3, A7, A10 | |
| M3 | **Urgent.** Who is the one person who takes decisions for Masti on this project, and who is the contact in each department? Please also share the names and roles of the visa HOD, the ticketing head and the accounts in-charge. | The contract asks for one decision-making contact, and the meeting recording didn't capture names. | inputs D6 | |
| M4 | Follow-up team: will visa, tickets and holiday packages have separate follow-up staff, or one shared team? Today visa and holidays have their own follow-up staff, and ticket staff follow up their own queries. Should that stay? | It decides who sees which follow-ups. | Q2 || 8 Oct, project lead: the Visa employee assigned to the case does the follow-up. ⚠️ Differs from what Vimal said in the meeting; confirm with him. |
| M5 | Pending-document reminders: how often (every 1, 2 or 3 days?), at what time of day, by WhatsApp or SMS, and who can change the setting? Our demo shows "every 2 days at 11:00". | The time of day was never discussed. | Q5 || 8 Oct, project lead: an admin setting, seeded 2 days / 11:00 / WhatsApp. Masti can still give preferred values. |
| M6 | Visa invoice: when should it be raised? When the file is couriered to the vendor, or earlier when fees are paid upfront (e.g. VFS)? | The meeting and your written notes differ slightly. | Q6 | |
| M7 | Invoices: should the CRM's invoice numbers continue your current series? Which GSTIN and company details go on them? Please share your invoice and credit-note format. | GST rules need invoice numbers in a consecutive series, unique for each financial year. Visa invoices start in the first stage. | inputs C5 | |
| M8 | Is "maximum one additional invoice per file" only for visa files, or for every department? | It was only discussed for visa. | §17 #9 | |
| M9 | Visa enquiry: besides country, visa type, adults, children and mobile number, is anything else needed at enquiry? Your written notes also say "time". What did that mean (travel month)? | We want to keep the enquiry form as short as possible. | §17 #8 || 8 Oct, project lead: "time" = travel month/date, captured at intake. |
| M10 | Visa decision: should approved/refused be recorded for each traveller separately (as in the demo), or once for the whole case? | Per traveller was our assumption. | Q11 | |
| M11 | Vendor onboarding: what details do you need to register a new visa submission agent, and who approves new vendors (the HOD)? | You said you'd explain the format separately. | Q7 | |
| M12 | Consent form: please share the exact wording (passport transit risk; bookings made before the visa arrives are at the client's risk). Also confirm: the processor takes the consent alongside processing, not at enquiry? | You said you'd give the wording. | Q9 | |
| M13 | Covering letters: which formats are needed (process and family types)? Will Riya share them, or will you make them? What did "take a ₹100 subscription" mean? | Needed for file preparation. | Q10 | |
| M14 | Passport handover: please confirm the steps. Booklets counted, OTP from the client, photo of the person receiving, and the delivery boy's selfie with place and time. Is anything missing from what was designed earlier? | "As designed earlier" wasn't repeated in the meeting. | Q12 | |
| M15 | Collection dates: besides embassy holidays, should Sundays and your office holidays also be blocked, for collection dates and deliveries? Who will keep the embassy holiday calendar up to date? | Our demo blocks Sundays; only embassy holidays were discussed. | inputs B2 | |
| M16 | Documents: should the CRM save files (consents, final visa PDFs, refusal letters) in Google Drive or in OneDrive? Which account should own the folders? | You use both today. | inputs A5 | |
| M17 | Existing data: do you want your existing clients (and any open cases) brought into the CRM? In what format (Excel or Google Sheets)? Do they have accounting codes and billing cycles? | Not discussed in the meeting. | Q29, inputs B6 || 8 Oct, project lead: yes, as an Excel file; import job built later. Accounting codes/billing cycles still to check in the file. |
| M18 | Do tickets, or any other department, get enquiries by email today? Roughly how many a day? | Vimal said email isn't used yet, but the ticketing head mentioned it. | §17 #22 || 8 Oct, project lead: no automatic email capture for now. Future automatic intake via WhatsApp bot and website forms. |
| M19 | *Ask after S7.* CRM login from the office network only: what are the office internet IP addresses? Should this apply to everyone, or only to some roles? The collection boy works outside the office. | An office-only login would block field staff. | Q14, inputs A12 | |

### Batch 2 · Hotels, insurance, tickets (week 2, or once batch 1 is answered)

| # | Question | Why we ask | Ref | Answer (date, who) |
|---|---|---|---|---|
| M20 | Hotel minimum markup: what minimum % for 3★, 4★ and 5★ hotels (or by price range)? Do you want it from day one? Our demo shows 10% / 8% / 6%. | The contract sets it by star rating; the values are samples. | Q17 | |
| M21 | Hotel rate check: which sites must be checked before a quote? MakeMyTrip, Agoda and Booking.com plus the vendor rate, or your own list of four competitors? | The demo list was our assumption. | Q18 | |
| M22 | Your regular hotels: for each staff member's 10–20 predefined hotels, should the rate check be skipped? You said comparison "doesn't come in" for those. | It decides whether the check applies to every quote. | Q31 | |
| M23 | Insurance: which insurers do you use? Will you enter plans and covers by hand, or is there a source we can fetch them from? | You mentioned that manual entry is high-maintenance. | Q19 | |
| M24 | Ticket quotes: should staff pick the airline and type the price for each fare type, or paste a screenshot for the system to read? Should the full fare rules (change, refund, no-show) go in the first quote? | You said rules in the quote are ideal but take effort. | Q20 | |
| M25 | Does the ticket desk use the Galileo GDS? (You showed an "our Galileo" quote.) Which portals does the desk book on (the IndiGo agent portal, others)? | It affects how fares get into the quote, and which portal logins we set up. | Q32, inputs A9 | |
| M26 | Web check-in: confirming the list shows flights 72 hours before departure. OK? | Your written notes said 48 hours; in the meeting you said 72. | Q21 | |
| M27 | Ticket copy: where does it come from (the airline's email or portal), and should we send it to the client as a link? | You said it won't go from the system. | Q22 | |
| M28 | Changes after a ticket is booked (extra baggage, seat, date change, cancellation): should each change get its own new invoice, with a credit note for refunds? | Invoices can't be edited after they're issued. | §17 #10 | |

### Batch 3 · Accounts, reports, settings (week 3 onwards)

| # | Question | Why we ask | Ref | Answer (date, who) |
|---|---|---|---|---|
| M29 | IVS: which service is it exactly (name or website), what does it cost, and how can we read its updates (login, email, export)? | It's a paid service; the cost and access method are unknown. | Q24 | |
| M30 | Accounting software: what's its name? Do you need an export file from the CRM now, or is phase 2 fine? What format does it import? | Client codes are stored in the CRM; the export format decides the file layout. | Q26 | |
| M31 | Reports: what should the Visa, Staff workload, Outstanding and Cross-sell reports show? | These tabs are in the demo but not designed. | Q27 | |
| M32 | Dashboards: what should staff, HODs and you see on the home screen? | "My dashboard the way I want." | Q28 | |
| M33 | Third follow-up on an invoice: who gives permission (only you, or HODs too)? Should the permission be requested inside the CRM? | The rule is clear; the approval flow isn't. | Q30 | |
| M34 | Routine accounts tasks: keep them in the CRM, or leave them in Excel? If in the CRM, please send the task list with how often each happens and who does it. | You called them optional. | §17 #11, inputs B11 | |
| M35 | Collection run: when the collection boy is off, does someone from the office (e.g. Accounts) do the run? Should they use the same phone screen? | Decides whether the phone screen is only for field staff or for anyone given a job. Cheap to change either way. | §18 #31 | |

---

## Part 3 · We recommend first, then confirm with Masti

| # | Decision | What to do | Ref |
|---|---|---|---|
| R1 | Docket grouping: one docket per file, or one per vendor per day (today's practice)? One vendor email per docket, or one per day? | Recommend, then confirm with Vimal. He left it to us. | Q1 |
| R2 | Collection boy's device: phone or tablet; mobile web app or WhatsApp-only jobs? | Recommend, then confirm. Vimal asked for our recommendation. | Q3 |
| R3 | Click-to-login: how it works and which portals it can support | Spike one visa portal and one airline portal. Tell Shivanshu what can't be done before the client assumes it can. | Q4 |
| R4 | Ticket quote input: manual fare entry vs reading screenshots | Test both once M24 and M25 are answered, then recommend. | Q20 |

---

## Already answered: don't ask again

- **Timeline:** go-live 1 Jan 2027, buffer to 15 Jan 2027 (PID).
- **Ownership:** code ownership, exclusivity, and hosting on Masti's own account (PID).
- **No free text:** no free text anywhere; reasons are dropdowns (Vimal, 6:50 PM).
- **Invoices:** never edited; at most one additional invoice per visa file (7:04 PM).
- **Recall refund:** the embassy fee only; an HOD can increase it (7:05–7:07 PM).
- **Documents:** stored as Drive/OneDrive links; scanning in the office only (7:08 PM, 7:17 PM).
- **Invoice follow-ups:** two; a third needs permission and shows on Vimal's dashboard (8:25 PM).
- **Cross-sell:** leads are created automatically at invoicing and must be answered; no manual "transfer lead" button (8:33 PM).
- **Out of scope:** HR is out; Sales CRM/feedback comes later; Transport and Cruise are Phase 2 (8:29–8:43 PM).

---

## Ready to paste: batch 1 for the client WhatsApp group

Review it with Shivanshu first. The numbers match M1–M18; M19 waits for S7.

```text
Masti CRM: questions, batch 1 (visa stage)
Please reply with the question number. Thank you!

URGENT
1. WhatsApp messages: please send the list of steps at which clients should get a WhatsApp message, with the wording for each. Also, which office address should the messages give for collecting passports? (Meta must approve every message, which takes time.)
2. Which of these do you already have: WhatsApp Business API (which number?), an SMS provider with DLT registration, an IVS subscription, a cloud/server account (AWS, Google Cloud or DigitalOcean), your domain? We will apply for anything you don't have.
3. Who is the one person who takes decisions for Masti on this project, and who is the contact in each department? Please also share the names and roles of the visa HOD, the ticketing head and the accounts in-charge.

VISA STAGE
4. Follow-up team: separate follow-up staff for visa, tickets and holiday packages, or one shared team?
5. Document reminders: how often (every 1, 2 or 3 days?), at what time, by WhatsApp or SMS, and who can change it?
6. Visa invoice: raise it when the file is couriered to the vendor, or earlier when fees are paid upfront (e.g. VFS)?
7. Invoices: should our invoice numbers continue your current series? Which GSTIN and details go on them? Please share your invoice and credit-note format.
8. Is "maximum one additional invoice per file" only for visa, or for all departments?
9. Visa enquiry: besides country, visa type, adults, children and mobile, is anything else needed? Your notes say "time". What does it mean?
10. Visa decision: record approved/refused for each traveller, or once per case?
11. New visa vendors: what details do you need, and who approves them?
12. Consent form: please share the exact wording. Should the processor take it alongside processing (not at enquiry)?
13. Covering letters: which formats are needed? Will Riya share them, or will you make them? What did "₹100 subscription" mean?
14. Passport handover: booklets counted, OTP from the client, photo of the receiver, delivery boy's selfie with place and time. Anything missing?
15. Besides embassy holidays, should Sundays and office holidays be blocked for collection dates and deliveries? Who will keep the embassy holiday calendar updated?
16. Should the CRM save documents in Google Drive or OneDrive? Which account should own the folders?
17. Do you want your existing client list brought into the CRM? In what format (Excel/Google Sheets)?
18. Do tickets or other departments get enquiries by email today? About how many a day?
```
