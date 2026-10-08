# Masti Travels CRM: project knowledge base

> **What this is:** the single context file for anyone, human or AI, working on this project. It distils everything in `Masti-CRM-Handover/` (handover pack, the Project Initiation Document, the client's written requirements, the meeting summary and the approved clickable demo) plus the current state of `Backend/` and `Frontend/`.
>
> **Last updated:** 8 Oct 2026: answers for Visa Step 1 (intake) recorded; the intake design is proposed in `docs/decisions/0003-visa-intake.md`. **Keep it current:** when a decision is made or an open question is answered, update this file and `Masti-CRM-Handover/05_Open_Questions.md` (the decision log).

## Contents

0. [How to use this file](#0-how-to-use-this-file)
1. [TL;DR](#1-tldr)
2. [The client and their business](#2-the-client-and-their-business)
3. [Problems we are solving](#3-problems-we-are-solving)
4. [Contract and commercials (PID)](#4-contract-and-commercials-pid)
5. [Delivery plan and status](#5-delivery-plan-and-status)
6. [People and ways of working](#6-people-and-ways-of-working)
7. [Golden rules for building](#7-golden-rules-for-building)
8. [Roles and permissions](#8-roles-and-permissions)
9. [App shell, navigation and conventions](#9-app-shell-navigation-and-conventions)
10. [Shared concepts](#10-shared-concepts)
11. [One visa case, end to end](#11-one-visa-case-end-to-end)
12. [Module by module](#12-module-by-module)
13. [Domain entities implied by the requirements](#13-domain-entities-implied-by-the-requirements)
14. [Integrations and third-party services](#14-integrations-and-third-party-services)
15. [Design system](#15-design-system)
16. [Engineering: constraints, risks, decisions, current code](#16-engineering-constraints-risks-decisions-current-code)
17. [Where the sources disagree](#17-where-the-sources-disagree)
18. [Open questions](#18-open-questions)
19. [What we need from Masti](#19-what-we-need-from-masti)
20. [Discussed in the meeting but not in the demo](#20-discussed-in-the-meeting-but-not-in-the-demo)
21. [Glossary](#21-glossary)
22. [File map, screenshots and the demo](#22-file-map-screenshots-and-the-demo)

---

## 0. How to use this file

**Confidence markers used throughout:**

| Marker | Meaning | What to do in code |
|---|---|---|
| ✅ | **Confirmed.** The client asked for it (meeting or written doc), or the contract (PID) commits to it. | Build it. |
| ⚠️ | **Demo sample or our assumption:** names, numbers, times, wording, some rules. | Build it as configurable data seeded with the demo value. Never hard-code it. Log the question. |
| ❓ | **Open.** Nobody has decided yet (numbered `Q#`, see §18). | Don't guess silently. Make it configurable, or ask. |

**Which source wins, highest first:**

1. **The PID** (`Masti-CRM-Handover/references/Project_Initiation_Document_Masti_Travels_CRM.pdf`) is the contract: scope, dates, money, ownership.
2. **What the client said:** `02_Requirements_from_Meeting.md`, which summarises the 30 Sep 2026 meeting and the written requirements doc. The raw files are in `references/client-files/`. The transcript is machine-generated, in mixed Hindi/Gujarati/English, and its speaker labels are often wrong. It was read in full on 7 Oct 2026. Details it adds beyond the summary are tagged *(transcript, 7:30 PM)* with the meeting time, so you can find them in the original.
3. **The approved demo** (`references/demo/masti-crm-demo.html`). Every module in it is in scope, but many of its details are samples. `03_Demo_Screens_Guide.md` marks which.
4. **Our own assumptions** come last. Confirm them before building.

When the sources conflict, see §17. Don't silently pick one.

---

## 1. TL;DR

- **Acceleret** (a software firm in Surat) is building a **custom CRM** for **Masti Tours & Travels**, a B2C travel agency in Varachha, Surat. Its owner, **Vimal**, makes every final decision.
- It replaces WhatsApp screenshots, Excel and Google Sheets with **one system** for five selling departments (**Visa, Holidays, Hotels, Insurance (with claims), Tickets**), plus **Accounts** and a **field collection/delivery boy** who has only a phone.
- Vimal gave the system two purposes: **(1) track lost business with reasons, and (2) automation.**
- **Scope is every module in the approved clickable demo.** Out of scope: Cruise, Transport and a mobile calling app (a later phase, paid separately), and the accounting software (which stays as it is).
- **Go-live is 1 Jan 2027.** The buffer to 15 Jan 2027 is only for client-side delays. There are **3 paid stages:** Visa → Departments → Final + go-live.
- It runs on **Masti's own servers**, and **Masti owns the full source code** at completion. We may **never reuse** it for another customer.
- **Non-negotiables:**
  - no free text (dropdowns from masters)
  - invoices are generated from the quote and never edited
  - documents are kept as Drive/OneDrive links
  - a full audit trail
  - Staff → HOD → Head roles
  - automatic WhatsApp updates to clients
  - staff never see portal passwords
  - everything is configurable
- **Code today (8 Oct 2026):** authentication, users, department roles and the audit log are built and tested (§16.4).
  - `Backend/`: Express 5 + TypeScript + Prisma 7 + PostgreSQL (server-side sessions, Head / Office / Field account types, Staff/HOD department roles, append-only audit log)
  - `Frontend/`: React 19 + Vite 8 + TypeScript (login, forced password change, app shell, Users admin screen)

---

## 2. The client and their business

**Masti Tours & Travels:** 301, Lambe Hanuman Rd, opp. Canara Bank, nr. Panchratna Tower, Varachha, Surat, Gujarat 395006. **Owner:** Vimal.

**What they sell:**

| Line | Notes |
|---|---|
| Visas | 75+ countries. Many come up rarely, so staff don't know their current rules. |
| Holiday packages | AI-built itineraries from Masti's rate sheets (discussed, and partly built, before this project) |
| Hotel-only bookings | Many countries. A typical enquiry: "a hotel in city X, these dates, price?" |
| Travel insurance and claims | Annual policies, policies for visas, cross-sell from tickets; claims handling |
| Air tickets | Domestic and international. The client calls it the "most complicated" department. |
| Transport, cruise | Sold inside holidays today. They become separate modules in **Phase 2**, not in this project. |

**Departments:**
- Visa, Holidays, Hotels, Insurance/Claims, Tickets, and Accounts (invoicing and collection).
- A **collection/delivery boy**: field staff with a company phone only.
- HR is dropped. Sales CRM/feedback is deferred.

**Scale:**
- Staff are "basic", not experts.
- There is no office space for more people, so growth must come from the current team.
- Vimal is "thinking about 20 branches". This is not a requirement, but don't design it out.
- Outstanding receivables are about **₹1.75 crore**. The target is **≤ ₹1 crore** with proper follow-up.

**How enquiries arrive:**
- landline, mobile, WhatsApp, walk-in
- Instagram/Facebook
- Justdial (as a source tag)
- email "maybe in future"
- the holiday demo also shows **website chat**

**Tools today:**
- WhatsApp, for quotes: a portal screenshot with the amount typed underneath
- Excel, including routine accounts tasks
- Google Sheets and their own "MIS" dashboard
- Google Hangouts groups
- Google Workspace on their own domain
- Google Drive and OneDrive
- an accounting software whose name we don't know. Booked business already goes into it.
- airline agent portals (IndiGo named)
- MakeMyTrip and Skyscanner as rate references
- visa portals (VFS Belgium, China, e-visa)
- couriers (e.g. Blue Dart)

**Vimal's stance:**
- His needs "change every 3–4 months".
- He is wary of "promise vs delivery".
- He wants "beautification": an attractive UI that staff can use all day.
- He wants tech that lasts **10–15 years**.
- Small process fixes already pay off for him: a Hangouts group, an Excel sheet and a flowchart moved staff's daily review from 7:30 PM to 4 PM *(transcript, 8:48 PM)*.
- His own words on what matters most are in §3.

---

## 3. Problems we are solving

| Problem today (30 Sep meeting) | What the CRM does about it |
|---|---|
| Lost business can't be measured, because staff write free-text notes "by mood" | Every outcome and reason is a dropdown. Reports show lost business by reason, stage, department and source. |
| Shared portal passwords: every staff exit forces a change of all passwords, and leavers still log in from home | "Log in for me" credential vault, forced rotation, office network only. Switching off the CRM user is enough. |
| Late, back-dated invoices that corporates dispute; ₹1.75 Cr outstanding | Invoices are generated at fixed points from the quote and locked. Every invoice gets an Accounts follow-up, with a compulsory call and billing cycles. The 3rd follow-up escalates to Vimal. |
| Hotel pricing mistakes: under-pricing against MakeMyTrip (₹5k markup on a ₹60k rate when MMT sells at ₹1L), or a vendor rate above MMT without anyone knowing | A competitor rate check is mandatory before a quote. Quotes show the difference vs market, and there is a minimum markup floor. |
| Ticket quotes in every format, depending on the portal and the staff member | One common fare-options quote in Masti's format |
| No proof of what was submitted for a visa when there's a dispute | The final file is saved as one PDF under the case number (as a Drive link) |
| Embassy holidays and rule changes missed (e.g. dates promised during China's 1–7 Oct closure) | An embassy holiday master blocks those dates. A visa-team login popup, the notice board and the IVS news feed carry the updates. |
| Insurance claims drag on (about 30 days when the cheque is missing) | Claim checklist. Nothing goes to the insurer until every document, including the cancelled cheque, is in. |
| Poor customer mobile scans | Scanning happens in the office only. Clients never upload. |
| Needs change every 3–4 months | Behaviour is driven by admin-editable masters |
| Vimal is wary of "promise vs delivery" | A demo at every stage, decisions confirmed in writing, nothing promised beyond the plan |

### What Vimal said matters most

Translated from the meeting transcript; the times are meeting times.

| When | What he said (translated) | What it means for the build |
|---|---|---|
| 6:50 PM | "No free text anywhere. People write according to their mood, and then the data can't be analysed." | Dropdowns from masters everywhere (§7 rule 2) |
| 6:53 PM | "Nobody here is an expert; everyone is basic. We don't need to teach them anything except to speak sweetly." | The system must carry the process: guide each step, enforce the rules, pre-fill what it can. |
| 7:26 PM | "Keep beautification in mind. People like beautiful things; otherwise it's boring to use. Show me how it will look, how the messages go, how the pop-ups appear." | Match the approved look. Preview messages and pop-ups with the client. |
| 7:36 PM | "If what took three staff can be done by one, I save the cost: not just salary, but every other cost of keeping staff. And informative updates make my image with the client better." | Recurring costs (e.g. WhatsApp at ₹30–40k a month) are fine when the value is clear. Quote them up front. |
| 8:18 PM | "I want every business query in the system. Booked business reaches my accounting software anyway. I care about the loss: how much, and why. The second purpose is automation: do more with fewer staff, and keep everything safe." | Loss tracking is the headline. Capture every enquiry, including the ones that never book. |
| 8:20 PM | "Every company has a policy. It gets rolled out but never applied. I want the system to make them apply it." | Enforce rules in the system (password rotation, follow-up caps, mandatory answers), don't just record them. |
| 8:44 PM | "Whatever technology you use should stay capable for the next ten to fifteen years." | Mainstream, long-lived stack (§7 rule 14) |
| 8:46 PM | "We know business, not design; you know design, not our business. If something I described as manual can be automatic, do it, and tell me if it changes the cost." | Propose improvements, but keep scope and cost changes visible (§6, change requests). |
| 8:47 PM | "The technology should feel like it saved the work of four or five people, brought accuracy, and showed us where we are leaking." | Reports on losses, outstanding and follow-ups are core, not extras. |
| 8:48 PM | "I have no space for new staff, so the business has to grow with these same people." | Output per staff member is the measure of success. |
| 8:49 PM | "The worst problem with technology: the promise is one thing, the delivery is another." | Show working software at every stage; never over-promise. |
| 8:49 PM | "My needs change every three months. By the time something is delivered, I've changed it three times." | Configurable masters; expect workflow changes during the build. |

At the close (8:50 PM) he summed up his targets as "lead generation and automation". That probably means capturing every lead in the system, alongside the loss tracking above, but it's unclear (§17).

---

## 4. Contract and commercials (PID)

**Document:** `Project_Initiation_Document_Masti_Travels_CRM.pdf`, ref **ACC/MTT/PID/2026-01**, **v1.0**, dated **5 Oct 2026**. Acceleret's address is 908, International Wealth Center, Surat. Treat this document as the contract.

| Area | Commitment |
|---|---|
| Scope | Every module shown in the approved demo screens |
| Not in scope | **Later phase, quoted separately after this project:** the Cruise and Transport modules (marked "Phase 2" in the screens) and the mobile app for calling. **Not replaced:** the accounting software (the CRM does invoices and payment follow-up, not bookkeeping). **Also excluded:** third-party subscriptions, and new major features not shown in the screens. |
| Start | When the advance payment is received |
| Timeline | Target go-live **1 Jan 2027**. Latest **15 Jan 2027**, a buffer that depends on Masti communicating clearly and on time. If Masti's inputs are late, dates move by the same amount, and we flag it **in writing** straight away. |
| Payment | **4 × 25%:** advance on signing, Visa module, Department modules, Final + go-live. Paid by bank transfer, UPI or cheque. |
| Hosting | The whole system (app, DB, config) is deployed to and transferred onto **Masti's own servers**. We share the server spec before go-live. |
| Ownership | Full source code passes to Masti on completion. Masti's data is Masti's at all times. |
| Exclusivity | We will not sell, license or reuse the software, designs or workflows for any other customer. |
| After handover | Masti gives us **partial, role-based access** for maintenance and can review or withdraw it at any time. |
| Onsite engineer | After go-live, an engineer who knows the product sits at Masti's office until the team is comfortable. There is no fixed end date, and it's included in the cost. The engineer reports issues back to us. |
| Support | **6 months free** from delivery (bugs, issues, keeping it running), then an **AMC** agreed mutually |
| Change requests | Changes during development, **including workflow changes, are free**. Tell Masti the timeline effect before starting. **New major features** not in the screens are charged and need written approval. |
| Third-party costs | Masti pays providers directly after completion: hosting, WhatsApp Business API, SMS/OTP, the IVS visa-news feed, PAN verification, Google Workspace login. **We must give full cost calculations before go-live.** |
| Masti provides | One decision-making contact. Formats and data: checklists, covering-letter formats, rate sheets, vendor lists, holiday calendars, and client data if it's imported. Access to the WhatsApp number, portal accounts and servers. Details and access for APIs they already have; if something must be applied for fresh, **we** apply. Staff time for training and testing. |
| Acceleret provides | Design, development, testing and deployment; regular updates and a demo at each milestone; training through the onsite engineer; support |
| General | Mutual confidentiality. Decisions, approvals and change requests are confirmed **in writing** (email or WhatsApp). Jurisdiction: courts of Surat. |

**What the PID says each module includes.** This is the contractual wording, and it is a little more specific than the demo in places:

| Module | PID wording (condensed) |
|---|---|
| Today | Daily home screen per person: due, running late, open enquiries by department, money to collect, business lost, notice board (embassy holidays, airline/hotel updates, visa news) |
| Enquiries | One list across departments with stage, next step, due time, owner. New enquiries can be filled in **from a WhatsApp message or screenshot**; existing clients are recognised. |
| Visa | Full 8-step case. Country-wise document lists and price breakup sent on WhatsApp; document tracking **per traveller** (original/xerox); **reminders every 2 days**; consent forms; covering letters; vendor tracking; collection dates that skip embassy holidays; **per-traveller decisions**; passport stock; visa board view |
| Holidays | Itineraries built automatically from Masti's rate sheets and sent as a quote. Staff take over when the client replies. **Quote versions kept**; margin visible only to owners and accounts. |
| Hotels | Rate check against **MakeMyTrip, Agoda, Booking.com and the vendor** before any quote; **up to 4 options**; minimum markup **by star rating**; client agrees to terms **by OTP** (incl. non-refundable consent); holds, bookings and vouchers tracked |
| Insurance | Plans from several insurers side by side, policy issue, renewals due in the **next 30 days**, claims tracked step by step with compulsory documents |
| Tickets | Fare-options quotes in Masti's format, a web check-in list **72 hours** before each flight, a travel calendar, a log of fare changes to bill |
| Follow-ups | Follow-up desk; every outcome from a fixed list; cross-sell leads created automatically when any department invoices, and each must be answered |
| Clients | Profiles with family members and travellers, passport validity, consent forms on file, full history across departments |
| Accounts | Invoices with payment follow-up rules (compulsory call after sending; weekly, half-monthly and monthly billing; 3rd follow-up goes to the owner); routine accounts tasks; the collection boy's daily run; **field-staff screen** for pickups and passport handover with OTP, photo, location |
| Reports | Lost business by reason, stage, department and source, **plus visa, staff workload, outstanding and cross-sell reports** |
| Settings | Portal logins ("log in for me", scheduled password changes, office network only); masters (embassy holiday calendar, reminder rules, approved vendors, hotel minimum markups, dropdown reasons, document checklists, covering-letter formats); staff roles (Head, HOD, Staff) |
| WhatsApp | Automatic updates to clients at each step: document lists, reminders, invoices, submission, decision, delivery |

---

## 5. Delivery plan and status

**Stages.** These are fixed, because payments are tied to them. The internal order and dates within them are the project lead's call.

| Stage | Delivers | Rough target (validate in the Week-1 plan) |
|---|---|---|
| Start | Advance received | — |
| **1 · Visa** | The full visa flow + Today, Enquiries (all-department list), New enquiry, Clients, the field-staff screen, visa WhatsApp updates. **It also lays the foundation everything else uses:** auth, roles, masters, the enquiry model, WhatsApp sending, the audit trail. Budget for that. | ~mid-Nov 2026 |
| **2 · Departments** | Holidays, Hotels, Insurance (incl. claims and renewals), Tickets | ~mid-Dec 2026 |
| **3 · Final + go-live** | Accounts, Follow-ups and cross-sell, Reports, Settings (portal logins, masters, roles); go-live on Masti's servers | by 1 Jan 2027 |

**Week 1 plan** (`06_First_Week_Plan.md`):

| Day | What happens |
|---|---|
| 1 | Study only, no code. Send Shivanshu a one-page summary per department plus the visa flow, a questions list, and the top 3 risks. |
| 2 | Walkthrough with Shivanshu. Join the client WhatsApp group and ask the Stage 1 questions. |
| 3 | Finalise the client inputs checklist. Start the WhatsApp BSP and click-to-login spikes. |
| 4 | Stack and architecture decision records, plus the core data model. |
| 5 | Delivery plan with internal dates. Repo, environments, CI, project board. |

**Deliverables due by the end of week 1:**
- one-page summary
- open questions logged, and the client ones asked
- client inputs checklist sent
- stack and architecture decision records approved
- core data model draft
- delivery plan with stage dates
- repo, environments and board ready
- notes on the WhatsApp BSP and click-to-login spikes

**Status as of 7 Oct 2026:**
- PID v1.0 issued 5 Oct. Handover pack prepared 6 Oct.
- `Backend/` and `Frontend/` were scaffolded on 7 Oct: health check only, no data models, no git repo yet.
- Not written yet: stack decision records, data model, delivery plan, cost sheet.
- Development formally starts when Masti's advance is received. Check with Shivanshu before heavy build work.

---

## 6. People and ways of working

| Who | Side | Role |
|---|---|---|
| **Shivanshu** | Acceleret | Founder. The project lead reports to him. He owns money, estimates and client promises. |
| **Project lead** | Acceleret | Full-stack developer who owns the technical decisions |
| Abhishek | Acceleret (appears to be) | Spoke as the builder in the meeting; offered an "updates" side section |
| **Vimal** | Masti | Owner and final decision-maker on everything. The only real person's name in the demo. |
| Visa HOD (name not captured) | Masti | Asked for the login popup, the query handover rule and the annual-policy expiry list |
| Ticketing head (name not captured) | Masti | Explained the screenshot quotes and fare variants |
| Accounts "madam" (name not captured) | Masti | Receives invoices; payment follow-up |
| Collection/delivery boy | Masti | Field staff with a phone only |
| Bhargav bhai, Pallavi | Masti (unclear) | Named in the meeting; roles unclear |
| Riya | **External** (not Masti staff) | Holds the covering-letter formats |
| Sumit | External (unclear) | Cited for his MakeMyTrip-comparison practice, docket practice, passwords, "₹2 lakh from Sumit's place" |

All people in the demo are **fictional**:
- staff: Neha Joshi (visa processing), Aarti Patel (follow-up desk), Nidhi Vyas (tickets), Mihir Shah (hotels), Pooja Rana (holidays), Hetal Thakkar (accounts), Ramesh (collection boy), Jay
- every client, e.g. Rakesh Mehta

Get the real names and roles in the client WhatsApp group during week 1.

**Ways of working** (`08_Ways_of_Working.md`):
- **Daily update** to Shivanshu, 5 lines max: done today, plan for tomorrow, blocked on (and who can unblock it), anything affecting dates, cost or a client promise.
- **Weekly review**, showing working software from staging.
- **Client WhatsApp group** (project lead, Shivanshu, Masti's team):
  - Number your questions (Q1, Q2…) and log the answers in `05_Open_Questions.md`.
  - Confirm decisions in writing ("Confirming: web check-in list 72 hours before departure. OK?").
  - Keep it simple; Masti's staff are not technical.
- **Demo each stage** to Vimal and his team. Payments are tied to stage delivery.
- **Never promise on your own:**
  - prices, discounts, AMC terms or anything about money
  - dates beyond the plan
  - features outside the approved screens
  - anything about other Acceleret clients
- **Change requests:**
  - Workflow changes are free, but tell the client the timeline impact first and get an OK.
  - New major features are paid. Say you'll check with Shivanshu.
  - Unsure which one it is? Ask Shivanshu before replying.
- **Keep up to date:**
  - the decision log
  - the client inputs checklist
  - the **running-cost sheet** (every paid service and its monthly cost)
  - the change log
  - handover docs (setup/deploy runbook, environment variables, admin guide), **from day one**
- **After go-live:**
  - The onsite engineer needs an admin guide and a training plan per department.
  - Bugs are ours to fix for 6 months, so test the money and rule logic.
  - Our server access becomes partial, so plan logging and monitoring around that.

---

## 7. Golden rules for building

Read these before writing any code.

1. **The demo is the scope, not the spec.** Every module and screen in the approved demo is contractual. Its names, numbers, timings, wording and some rules are samples (⚠️). Model those as master/config data seeded with the demo value, never as constants, and log the question (§18). Keep the approved navigation and look unless there is a strong reason to change them.
2. **No free text for anything that gets measured.**
   - Reasons (lost, postpone, cancel, recall, rejection), follow-up outcomes, next steps, cross-sell answers, claim types and statuses are all dropdowns.
   - They are backed by master tables that Vimal and HODs can extend.
   - A free-text "notes" field may exist (the client profile has one), but no report, rule or status may depend on it.
   - *Why:* Vimal's main goal is measuring lost business and why. The demo says it in so many words: "Fixed reasons only — no free text anywhere."
3. **Invoices are generated, locked and never edited.**
   - They are built from the quote's price breakup; "nobody types amounts".
   - There is no update or delete path. Corrections go only through a **credit note** (e.g. on recall) or an **additional invoice** (visa: at most **one** per file).
   - Accounts must see the debit the moment the invoice is raised, even if payment comes later.
   - **This is not accounting software.** It stops at invoices, credit notes and payment follow-up.
4. **Documents are links, not uploads.** Refusal letters, consents, the final submitted visa file (one PDF), boarding passes and so on live in Masti's Google Drive or OneDrive. The CRM stores the link "so it stays fast". **Clients never upload anything:** papers are scanned in the office.
5. **Audit everything.**
   - Each document tick, follow-up, stage change, handover, portal login and money event records **who** and **when** (date, hour, minute).
   - Field actions also record **where** (GPS), plus photo, selfie and OTP proof.
   - A full audit log is a requirement.
6. **Roles are Staff → HOD → Head, scoped by department.** HOD-only powers: refund override, vendor approval, portal password reset. The Head (Vimal) sees everything. Disabling a user must end **all** of their access at once.
7. **The client hears at every step, automatically.**
   - Status updates, document lists, reminders, invoices, consent links and field jobs go out on WhatsApp, triggered by state changes, never sent by hand.
   - WhatsApp means the official Business API through a BSP, with Meta-approved templates.
   - SMS is the fallback. Email is for vendors and invoices.
8. **Staff never see portal credentials.** Company accounts on visa and airline portals are used through "Log in for me". Passwords rotate on a schedule, and an overdue rotation locks the account. Office network only. Every use is logged.
9. **Configurable, not hard-coded.** Vimal's needs change every 3–4 months. All of these are masters:
   - countries, visa types, checklists and prices
   - reasons
   - reminder rules
   - embassy holidays
   - vendors
   - hotel competitors and markup floors
   - insurance products and claim types
   - airline fare families
   - billing cycles
   - covering-letter templates (effective-dated)
   - routine tasks
   - staff and roles
10. **Masti-owned and portable.**
    - It must deploy to Masti's own server or cloud (AWS, GCP and DigitalOcean were mentioned) and be handed over cleanly.
    - No secrets in code; documented env vars; a runbook or IaC; backups.
    - No lock-in to services only Acceleret controls, and no closed or paid libraries Masti can't keep using.
    - Separate repo: nothing is copied in from, or out to, other Acceleret projects (exclusivity).
11. **Every paid service gets a cost line.** Hosting, WhatsApp BSP, SMS/OTP, IVS, PAN, storage and AI calls all go on the running-cost sheet we owe Masti before go-live.
12. **AI assists; staff confirm.**
    - Fill-from-message and fill-from-screenshot (enquiries, ticket quotes) only pre-fill. Staff confirm before saving or sending.
    - Any fare the AI suggests must be bookable on Masti's channels.
    - The exception is the holiday itinerary quote, which is meant to go out automatically, with staff stepping in when the client replies (Q16).
13. **Beautiful, calm, few clicks.** Staff use it all day and are not experts. Match the approved look (§15). Use plain-English labels ("Log in for me", "Whose job it is now"). Keep steps minimal: visa intake asks only four things.
14. **Built to last 10–15 years.** Use mainstream, well-supported tech. We provide security updates.
15. **Test the money and rule logic:**
    - invoice immutability
    - the one-additional-invoice limit
    - recall refunds
    - follow-up caps
    - embassy-holiday blocking
    - consent-once
    - permissions

    Bugs here are expensive, and ours to fix for 6 months after delivery.
16. **Scope discipline.** Anything not in the demo screens may be a paid "new major feature". Flag it to Shivanshu; don't quietly build it.

---

## 8. Roles and permissions

| Role | Who (demo) | Can |
|---|---|---|
| **Head** | Vimal ("Head · everything") | Everything, across all departments. Sees margins. Gets 3rd-follow-up and not-renewed alerts. Edits masters. Picks what goes into the visa-team login popup. |
| **HOD** | One per department | The department's work, plus HOD-only powers: refund override on recall, vendor approval, portal password resets. Edits masters (demo: "Only Vimal and HODs can change them" ⚠️). |
| **Staff** | ~11 people in the demo ⚠️ | View or edit within their department(s) ✅ |
| **Field staff** | Collection/delivery boy | Mobile view of his run of stops: pickups, deliveries, payment collection, handover proof |

**In the code** (`docs/decisions/0002-user-types.md`): each user has one `type`.
- `HEAD`: everything.
- `OFFICE`: Staff/HOD roles per department.
- `FIELD`: the `/tasks` phone view only, with no departments; a mobile is required. Field staff see the jobs assigned to them, whatever department raised them.

The database refuses department rows for anyone but `OFFICE`. Whether office staff can also cover a run is open (§18 #31).

**Visibility and special rules:**
- Holiday land cost and margin are visible to **owners and accounts only** ✅.
- A 3rd invoice follow-up needs permission and is flagged on Vimal's dashboard ✅. Who approves it is ❓ (Q30).
- **Desks (who owns a case right now):**
  - Visa cases belong to the **follow-up desk** until their documents are complete ("matured"), then to **visa processing** ✅.
  - Holidays have separate follow-up staff ✅. For hotels, the written doc says "separate team" ✅.
  - For tickets, the handler does their own follow-up ✅.
  - Whether follow-up is one pool or a team per department is ❓ (Q2).
- Deactivating leavers is the client's job, through the admin panel ✅. One switch-off must end CRM access and, through the vault, portal access too. Whether Gmail/Google Workspace access can also be cut from the CRM is ❓ (Q15).
- The "white-label, IP-based" CRM login was discussed; its details are ❓ (Q14). Portal logins work from the office network only ✅.
- Our own access after handover is partial and role-based. Design admin and ops so that maintenance never needs owner-level access ✅.
- Dashboards per role (Staff / HOD / Head): Vimal wants "my dashboard the way I want" ❓ (Q28).

---

## 9. App shell, navigation and conventions

**Sidebar** (approved; keep it unless there's a strong reason to change):
- Brand block: orange "M" mark, "Masti Travels · Tours & Travels · Surat".
- **Today**, which also hosts the **Notice board**.
- **Enquiries** (total count), with **Visa · Holidays · Hotels · Insurance · Tickets** under it. Each has a coloured dot and a count, and filters the enquiry list.
- *Transport · Cruise*, greyed out and tagged **PHASE 2**. Not in this project.
- **Follow-ups** (badge = overdue + cross-sell leads to answer). Tabs: *Follow-ups* · *Cross-sell leads*.
- **Clients**.
- **Accounts**. Tabs: *Invoices & follow-up* · *Tasks & collections* · *Reports*. The field-staff app opens from Tasks & collections.
- **Settings** (at the bottom). Tabs: *Portal logins* · *Masters & holiday calendar*.
- A user card at the bottom with name and scope, e.g. "Vimal · Owner · all departments".

**Header:**
- Global search: "Search a client, mobile, case or passport number".
- **New enquiry**, the primary button.
- Demo-only: *Walk me through* (a 7-step tour) and *Client's phone* (shows the WhatsApp messages the client received).

**Conventions seen in the demo** (⚠️ unless marked):
- **Case numbers by department:**
  - `V-2041` visa, `H-3107` holidays, `HT-0882` hotels, `T-1204` tickets, `CL-0093` claims
  - insurance appears as both `IN-0561` and `I-0577`, which is inconsistent
  - invoices `INV-0412`; the additional invoice is `INV-0412-A`
  - dockets `D-121`
  - vendor file numbers like `FR-MUM-88421`
  - ❓ Define the real numbering scheme, and whether it must match the accounting software.
- **Money:** Indian Rupees with Indian digit grouping (`₹1,23,950`, lakh/crore). The demo formats with `toLocaleString('en-IN')`. Placeholders like `₹[x]` and `[Insurer A]` in the demo are deliberate.
- **Dates and times:** "Tue 6 Oct", "3 Oct, 4:12 pm", 12-hour clock. The business runs on IST (Asia/Kolkata).
- **Mobile numbers:** `+91 98250 41XXX`. The mobile number is the client lookup key ✅.
- **"Due" colouring:**

  | State | Colour |
  |---|---|
  | late | red-orange `#E0623A` |
  | today | blue `#1E5AA8` |
  | later | muted `#7A746B` |

  Lists sort **late first, then by time due**.
- Every list row opens something. Side panels show the department's step strip and the next action.
- Search, "Only mine", sort and Export don't work in the demo but are expected in the real build ✅.
- Desktop-first: the demo is laid out at 1440 px. The field-staff screen is mobile.

---

## 10. Shared concepts

These are used by every module.

### 10.1 Client (customer master) and travellers

- **Saved against the mobile number** ✅. An enquiry needs only the mobile number; an existing client is recognised by it.
- **Fixed format: minimal at enquiry, complete before invoicing** ✅.
- **Fields seen:**
  - name, mobile, email, area/address, "client since"
  - **accounting-software client code** ✅
  - **billing cycle**: weekly / half-monthly / monthly, **default monthly** ✅
  - payment habit, e.g. "Part advance, rest on delivery" ⚠️
  - Corporates appear as clients too ("Sunrise Textiles", "Gajera Diamonds").
- **Family and travellers** ✅: name, relation (Self, Spouse, Son 12…), passport valid till (with a "renew soon" flag), and consent status ("On file · 28 Sep" or "Not on file").
- **Profile page:** history across all departments, open cases, business with us (₹ total · trips), balance still to pay, WhatsApp messages sent, and notes (free text, never reported on).
- **Importing existing client data (Q29, decided 8 Oct 2026):** Masti will send the old data as an Excel file. An import job is built later; the mobile number is the match key.
- **Built 8 Oct 2026 (project lead): the client master, before the System Masters.** Design: `docs/decisions/0004-client-master.md`.
  - **Tables:** `Client`, `ClientPhone` (extra numbers), `ClientMember` (family & travellers, or a company's employees), `ClientNote`, plus the seeded lookups `BillingCycle`, `PaymentHabit`, `Relation`.
  - **Client fields:** kind (individual / company), name, contact person (companies only), email, address line, area, city, GST state, PIN code, PAN, GSTIN, accounting code (unique), billing cycle, payment habit, client since.
    - A GSTIN must contain the PAN; an empty PAN and state are filled from it.
    - PAN is a typed field only: **PAN verification is not built** (Q23).
  - **Extra mobile numbers:** lookup matches them too. WhatsApp always goes to the main number. The main number can be swapped for another.
  - **Members:** passport name, relation, DOB (age is worked out), own mobile, current passport number and expiry. Passport status is VALID / RENEW_SOON / EXPIRED; the window is a setting (12 months ⚠️, Q35). Members are archived, never deleted. Consent comes with Visa Step 2, keyed to the member.
  - **"Complete before invoicing" is a setting** (`clients.invoiceReadiness`, the required fields per kind, ⚠️ Q33). The invoice module must call `assertInvoiceReady()`.
  - **Duplicate passport numbers, PANs, GSTINs and extra numbers are warnings** (409, then save again with `confirmDuplicates: true`; audited). A second client with the same **main** number is refused.
  - **Accounting code, billing cycle and payment habit:** only Accounts (or the Head) can set them (Q34).
  - **Saves use optimistic locking** on `updatedAt`.
- **Document vault (reusable passport/PAN scans per client): not built** (decided 8 Oct 2026). It isn't in the demo, and nobody at Masti asked for it, so it may be a change request (Q37). If it is built, it stores Drive/OneDrive links, not S3 uploads (rule 4). **Aadhaar numbers are not stored** (Aadhaar rules, DPDP, S11).

### 10.2 Enquiry: the unit of work across departments

- One **all-department list** ✅. This was the client's main ask after seeing an earlier visa-only version.
- **Each enquiry has:** client, department, short summary, **stage** ("Documents · 2/8", with a segmented progress bar), **next step**, **due time** (red if late), **owner**, and a source tag ✅.
- **Sources:** WhatsApp, Landline, Mobile, Social media, Email (the New-enquiry options), plus Justdial and Instagram/Facebook tags, website chat, and cross-sell ("from Visa / Holidays / Tickets / Hotels").
  - Vimal said email isn't a channel yet ("maybe in future"), but the ticketing head listed email as a current source of ticket queries *(transcript, 6:46 PM and 7:52 PM)*.
- **Outcomes:** postpone, cancel, or close/lost, always with a dropdown reason ✅.
- **Stage flows per department.** These are our proposal (⚠️), approved visually:

| Department | Stages |
|---|---|
| Visa (8) | Enquiry → Documents → File preparation → Docket & dispatch → At vendor → Decision → Passport back → Delivered |
| Holidays (6) | Enquiry → Quote sent → Client replied → Confirmed → Paid → Travelled |
| Hotels (6) | Enquiry → Rate check → Options sent → Go-ahead → Booked → Voucher sent |
| Insurance (4) | Lead → Options sent → Plan chosen → Policy issued |
| Insurance claim (7) | Registered → Documents → With insurer → Approved → Payment → Client confirms → Closed |
| Tickets (5) | Enquiry → Fare options → Confirmed → Ticketed → Web check-in |

- The New-enquiry form lets staff tick several services (Visa, Holiday, Hotel, Insurance, Ticket) ⚠️. How a multi-service enquiry splits into department enquiries is not specified. It is a design decision.
- Filling in an enquiry from a pasted message or screenshot was agreed for **all departments**, not just tickets *(transcript, 7:54 PM: "Sab mein hoga na?", "it'll be in all of them, right?")*.

### 10.3 Follow-ups

- **Logged with three dropdowns:** *What happened* → *Next step* → *When* ✅ (dropdown-only). The values are ⚠️ samples:

  | Dropdown | Demo values |
  |---|---|
  | What happened | "Spoke — documents coming", "No answer", "Asked to call later", "Wants to postpone", "Wants to cancel", "Documents complete" |
  | Next step | "Send collection boy", "Client will visit office", "Call again" |
  | When | Date/time slots |

- A visa query sits in a **common follow-up pool**, worked only by follow-up staff, until it **matures** (documents complete). Then processing takes over ✅.
  - **Changed 8 Oct 2026 (Q2/M4, project lead):** visa follow-up is done by **the Visa employee assigned to the case**, not a shared pool. ⚠️ This differs from what Vimal said in the meeting (6:48 PM, below) and from the demo's follow-up desk → processing handover. Confirm it with Vimal in writing. The design lets the owner change at maturity, so either way works.
  - The visa HOD asked for the client's first message to name the staff member handling the query. Vimal said the query stays common in the pool at that stage, so there's no named handler until it matures *(transcript, 6:48 PM)*.
- Postponed cases carry a resume date and resurface then ("Postponed to Jan — confirm new month").
- After a visa file is submitted, the case is **not touched until the expected collection date** ✅ (a future follow-up).
- Desk counters in the demo: Overdue · Today · This week · Postponed ⚠️.

### 10.4 Documents and checklists

- **Checklist per country × visa type**, from masters ✅ (the demo has 23 ⚠️), tracked **per traveller** ✅.
- **Each item records:**

  | Field | Values |
  |---|---|
  | What we need | **Original** / **Xerox is fine** / **Arranged by us** (flight reservation, hotel bookings, travel insurance) |
  | What came in | **Original** or **Xerox** toggle |
  | Status | **Pending** / **In · 3 Oct, 4:12 pm** / **Made · timestamp** (for things we arrange) / **Not needed** |

  ✅ the Original/Xerox marking and timestamps. ⚠️ the "Arranged by us" and "Not needed" variants.
- **Children get alternative documents** ⚠️:
  - bank statement → birth certificate
  - ITR → school letter
  - leave letter/NOC → parents' NOC
  - salary slips → not needed
- Items are ticked over several visits. Each tick records **date, hour, minute and who** ✅. A pending list is shown, and it drives the reminders ✅.
- **Scanning happens in the office only**, by anyone except the main processor (the follow-up person is suggested) ✅. **Clients never upload** ✅.
- **How documents reach us:** the client brings them, or staff **send the collection boy** with the document list, number, address and time slot ✅.
- **Booklets** (current + old passports) are counted at intake and checked again at handover ✅ ("4 current + 3 old").
- **Document master (decided 8 Oct 2026, B1/B4):** choosing a country and visa type at intake fills the checklist automatically from the master, copied onto each traveller (so later master edits don't change open cases). Seeded with dummy France Tourist data until Masti sends the real lists.
- The same checklist mechanism is reused for **insurance claims**, per claim type ✅.

### 10.5 Consent and liability form

- **One per person, for life** ✅. It uses the passport name and current passport number, and **stays valid if the passport changes** ✅.
- **Staff fill in** DOB, spouse DOB, anniversary, parents' DOBs, residential and office address, income, profession and education ✅. **The client enters nothing.** They only tap **"I agree"** on a link sent by WhatsApp or SMS ✅.
- **Content:**
  - passport transit is at the customer's risk (damage, loss, misplacement, delay)
  - bookings made before the visa comes are solely the customer's risk ✅

  The **exact wording comes from Vimal** ❓ (Q9).
- Entering a name shows whether a consent exists. Anyone without one is **flagged** ✅. The processor obtains it **in parallel** with processing ✅. It is taken once the business reaches a certain stage, not at enquiry ✅.
- The record is kept digitally (Drive/OneDrive/link) ✅.
- **Separate from this:** the **non-refundable consent** for hotels and tickets, agreed **by OTP** ✅ (PID).

### 10.6 Quote → invoice → payment → collection

- Every department quotes. On go-ahead or booking, an **invoice** is raised **from the quote breakup** ✅.
- The invoice goes to the client by WhatsApp or email; the channel, date and time are logged ✅. It lands in **Accounts** with a follow-up task already on it ✅. The department raising the invoice sets the follow-up date ✅ (written doc).
- **A call after sending is compulsory** ✅.
- **Billing cycles** ✅:
  - weekly / half-monthly / monthly per customer, **default monthly**
  - cycle customers surface automatically on their billing day with all their outstanding
  - routine customers (no cycle) get logged follow-ups
- **Max 2 follow-ups.** A 3rd needs permission and is flagged on Vimal's dashboard ✅.
- Payments are recorded with a mode (UPI, cash, cheque…) ⚠️, and the balance is shown ✅. The collection boy collects in the field ✅.
- **Visa specifics** ✅:
  - The invoice must exist **before the file is dispatched** ("A file can't leave without its invoice").
  - At most **one additional invoice** per file (urgent fee, ₹500 photos…; about 3–4% of cases).
  - A recall produces a credit note.
- **Tickets:** fare changes are billed (extra baggage, seat selection) or credited (cancellation) ✅.
- **Sent together** ✅:
  - hotels: invoice + voucher
  - insurance: invoice + policy
  - tickets: invoice + ticket copy
- GST shows on quotes and invoices (holiday quote: GST 5% ⚠️). The invoice and credit-note format comes from Masti ❓.

### 10.7 Cross-sell leads

- When **any department invoices** a booking, leads are **auto-created in the other departments** ✅ (e.g. ticket → visa, insurance, hotel, holiday). No pop-up, no manual transfer ✅.
- They are tagged by source department, like the Justdial or social-media tags ✅.
- **A manual "transfer lead" button was proposed in the meeting and rejected.** Vimal: "if he doesn't transfer it, the lead dies", and "nobody's discretion should come into it". No pop-ups either: the system creates the leads itself *(transcript, 8:32–8:34 PM)*.
- **Every receiving department must record what it did. This is mandatory** ✅.
  - Demo answers ⚠️: "Asked — interested, working on it", "Asked — already booked elsewhere", "Asked — not interested", "Not relevant for this trip".
  - An unanswered lead shows **"Answer required"**.
- Reports show leads given / matured / lost, by source ✅.

### 10.8 Vendors

- Only **registered, approved** vendors can be picked ✅. New vendors need **HOD approval** ⚠️ (demo: "Waiting HOD"). Vimal will explain the onboarding format ❓ (Q7).
- **Types:**
  - visa **submission agents**, by city and country coverage (e.g. Mumbai · Schengen, Ahmedabad · UK/USA, Delhi · China)
  - **hotel vendors** (create the vendor first if it's missing ✅)
  - couriers: manual docket entry, no integration ✅

### 10.9 Reminders and scheduled work

All intervals are configurable masters. The values below are demo samples (⚠️).

| Trigger | Demo default |
|---|---|
| Visa pending-document reminder to the client | every 2 days at 11:00. An admin setting, not a constant (Q5, decided 8 Oct) |
| Claim pending-document reminder | every 2 days |
| Hotel hold expiring | 6 h before |
| Web check-in list | 72 h before departure (Q21) |
| Portal password rotation | per account: daily / weekly / monthly |
| Annual policy expiry list | next 30 days; alert Vimal if not renewed |
| Vendor receipt confirmation | the day after dispatch ("Tomorrow 11:00") |
| Expected visa collection date | follow-up desk reminded a day before to check with the vendor |
| Billing-cycle day | cycle customers surface with all their outstanding |
| Accounts routine tasks | daily / weekly / monthly / quarterly due dates |

The backend therefore needs a reliable, self-hostable scheduler or job queue. That choice is still to be decided.

### 10.10 Notifications

- **WhatsApp Business API** (through a BSP) reaches clients and the collection boy ✅.
  - Every message needs a **Meta-approved template** ✅.
  - About 35 paise per message; Vimal accepted ₹30–40k a month ✅.
- **SMS** is the fallback for reminders and the consent link, and carries OTPs ✅.
- **Email** carries vendor dispatch mails (the day's dockets) and invoices ✅.
- **In-app:**
  - the visa-team **login popup** for important updates ✅
  - dashboard alerts (3rd follow-up, not renewed)

### 10.11 Audit trail

Record **who, when (to the minute) and where (for field work)** for ✅:
- document ticks
- follow-ups
- stage changes and handovers
- money events: invoice sent (channel, time), payments
- consent acceptance
- portal usage ("Who used what": person · portal · time · case)
- field proof: OTP verified, recipient photo, selfie, GPS, time

### 10.12 Masters (configuration)

**Asked for by the client** ✅:
- countries and visa types, with checklists and price breakups (embassy fee, VFS, service, courier)
- reasons (by type)
- reminder intervals
- vendors, with approval
- embassy holidays
- customers, with accounting code and billing cycle
- hotel competitors and markup floors
- insurance products and claim types
- routine tasks
- departments and users
- covering-letter templates (effective-dated: a change applies only from its effective date)
- airline fare families (implied)

**Also needed:**
- enquiry sources
- entry types
- document types
- insurers
- follow-up outcomes and next steps
- cross-sell answers

---

## 11. One visa case, end to end

This worked example follows the demo's Mehta family case (France Schengen tourist visa, `V-2041`, 4 travellers). The names, dates and wording are samples; the flow is the agreed one.

| When (demo) | Step | Owner | What happens in the CRM | WhatsApp to the client |
|---|---|---|---|---|
| 28 Sep, 3:14 pm | 1 · Enquiry | Follow-up desk (Aarti) | **Message in:** Rakesh writes "Namaste, 4 log ka France visa karwana hai, December me jaana hai. 2 bade 2 bachche." Staff paste it, the AI pre-fills the form, and the existing client is found by mobile. **Saved:** only four things (country France/Schengen, type Tourist, 2 adults, 2 children). **Then:** case `V-2041` is created, a follow-up lands on Aarti's desk, and anyone without a consent is flagged. | **Document list + price per person** (embassy fee, VFS, service, courier) |
| 28 Sep → 6 Oct | 2 · Documents | Follow-up desk | **Checklist:** ticked per traveller as papers are scanned in the office (Original/Xerox, timestamped). **Reminders:** every 2 days at 11:00, listing only what's missing. **Pickup:** the collection boy collects from home (Tue 6 Oct, 4–6 pm); booklets counted (4 current + 3 old). **Consent:** staff fill the details, the client taps "I agree". | **Reminder: documents pending** (2 Oct) → **All documents received** (6 Oct) |
| 6 Oct | Matures | Follow-up desk → Processing (Neha) | "Mark documents complete" hands the case to visa processing | — |
| 6–7 Oct | 3 · File preparation | Processing | **Portal:** "Log in for me" opens the France visa portal with Masti's master account; credentials are never shown. **Application:** filled and printed; acknowledgement numbers typed in; appointment 9 Oct, 10:30. **Covering letter:** generated from the fixed Schengen tourist family format. **Proof:** the final file is saved as one PDF in Drive (`V-2041_Mehta_file.pdf`, 52 pages) and the link is kept. | — |
| 7 Oct | 4 · Docket & dispatch | Processing | **Invoice:** `INV-0412` is raised from the quoted breakup and **locked**; no dispatch without it. **Docket:** the file joins docket `D-121` to the Mumbai vendor; parcel **sticker** printed; courier slip entered; vendor emailed the docket list; follow-up set for the next day, 11:00. **Cross-sell:** invoicing creates leads for Insurance, Tickets and Hotels. | **Invoice INV-0412** |
| 8–9 Oct | 5 · At vendor | Processing | **Vendor:** confirms receipt, submits at the embassy and gives file number `FR-MUM-88421`. **Collection date:** staff must enter an expected date; the calendar blocks embassy holidays and Sundays. The case then waits. **If needed:** **recall** (credit note for the embassy fee only; an HOD can override) or the **one additional invoice** (`INV-0412-A`, urgent submission charge). | **File submitted**, expected around Tue 27 Oct |
| 27 Oct | 6 · Decision | Processing | Approved/refused recorded **per traveller**, with visa sticker numbers ("Sticker 0182 4471 · valid 1 Dec – 14 Jan"). A refusal letter would be stored as a Drive link. | **Congratulations!** (or a "sorry" message on refusal) |
| 27–29 Oct | 7 · Passport back | Processing | Vendor collected → **In transit** (expected date recorded) → **In our passport stock** only once the packet is opened and punched at the office (29 Oct, 12:40 pm). Booklets counted again; visa stickers checked against names and dates. | **Passports are at our office:** delivery booked Sat 31 Oct, 11 am – 1 pm |
| 31 Oct, 12:10 pm | 8 · Delivered | Field staff (Ramesh) | The client collects, or the delivery boy delivers: booklets counted → OTP from the client → photo of the receiver → selfie (place and time added automatically). The handover can't finish without every step. The case closes; Accounts follows up anything outstanding. | **Delivered** |

---

## 12. Module by module

### 12.1 Today

- A personal home screen for every user ✅ (PID). Per-role dashboards ❓ (Q28).
- **Greeting and date.** Hero line ⚠️: "8 enquiries need someone today and 2 are running late. Start with the late ones."
- **4 tiles** ⚠️:
  - Due today ("across all departments")
  - Running late ("oldest: 2 days")
  - New enquiries ("since yesterday evening")
  - Cross-sell to answer ("leads from invoices")
- **Up next:** the day's tasks, late first, then by time.
  - Each row: time or lateness, the next step as the title, client · case · summary, department chip, owner initials.
  - Clicking a row opens the enquiry.
- **Open enquiries by department**, as bars ✅.
- **Notice board**, latest 3 ✅. E.g. China centres closed 1–7 Oct (from IVS), a Gulf airline sale, a holiday-calendar entry (Dussehra blocks French embassy dates).
- **Business lost this month, and why** ✅. This is the headline metric:
  - Queries in · Booked · Lost · Still open
  - the top 3 reasons
  - an "Open report" link
- **Money to collect** ✅: outstanding total, "9 on 3rd follow-up", "42 open invoices · 4 sent without the follow-up call".
- Third-follow-up cases appear on Vimal's dashboard ✅.
- *Unused ideas in the demo code, useful for HOD dashboards* ⚠️:
  - **Per-department cards:** "14 waiting on documents", "2 holds expire today", "11 expire in 30 days", "6 web check-ins in 72 h", "9 on 3rd+ follow-up".
  - **Attention list:** document reminders going out, passports arriving back (mark received), stops on the collection boy's run, invoices to chase, cross-sell leads without an answer.

### 12.2 Enquiries list and visa board

- **Header:** title "All enquiries" or "{Dept} enquiries", with a subtitle such as "14 shown · 2 running late · late first, then by time due · click a row to see its steps".
- **Filters:** department chips (All departments + one per department, with counts) ✅; "Only mine"; search.
- **Columns:**
  - **Client:** initials, name, "case no. · summary"
  - **Department** chip
  - **Stage:** "Documents · 2/8" with a segmented bar in the department colour
  - **Next step**
  - **Due** (coloured)
  - **Who:** owner initials
- **Row side panel:**
  - "{Dept} · {case no.}", client name and summary
  - a vertical step list (✓ done, current step bold)
  - **Next step**, "Due {when} · {owner}"
  - "Open full case ›"
- **Desk shortcuts** in a department's filtered view ⚠️:
  - Visa → Portal logins
  - Hotels → Minimum markups
  - Insurance → Renewals (11 expiring), Claims (4 open)
  - Tickets → Web check-ins (6 due)
- **Visa only: a List/Board switch** shows a kanban. Its columns differ slightly from the 8 stages:

  | Column | Who has it |
  |---|---|
  | Documents pending | Follow-up desk |
  | Matured · to assign | Waiting for processing |
  | File preparation | Processing |
  | Dispatched | On the way to vendor |
  | Submitted | At the embassy |
  | Decision | Approved or refused |
  | Passport back | In transit / in stock |
  | Delivered | This week |

  Each card shows the case no., a status chip, the client, "country · type · pax", the next step and the owner.
- **Visa-team login popup** ✅ (the HOD asked for it):
  - Shows on the Visa list: "Important for the visa team — Shows once each time you log in".
  - Holds the latest updates, e.g. the China closure (from IVS, added by Vimal) and a new Schengen covering-letter format.
  - Buttons: "All updates" / "Got it".

### 12.3 New enquiry

- **Intro copy:** "Take only what the client tells you now. The document list and price go out by themselves; the rest comes in with the documents."
- **Fill in from a message** ✅ (PID): "Hindi, Gujarati or English · text or screenshot"; buttons "Add a screenshot" and "Fill in the form". The AI is **assistive**: staff check what it filled. **Deferred (8 Oct 2026):** the plain manual form is built first; this button comes later.
- **Who is asking:** the mobile number is "the only detail needed now". An existing client is found by it ✅.
- **Came in through:** WhatsApp · Landline · Mobile · Social media · Email ✅. Add Justdial etc. as source tags.
- **What do they want?** Multi-select: Visa · Holiday · Hotel · Insurance · Ticket ⚠️.
- **Visa, just four things:** Country, Visa type, Adults (min 1), Children (min 0) ✅, **plus the travel month/date** (the written doc's "time", decided 8 Oct 2026; captured at intake only). "Names, travel dates, duration and single/multiple entry are filled later, when the documents come in."
- **"Save and send document list"**, with a "When you save" panel:
  - the document list and price breakup go to the client on WhatsApp ✅
  - reminders start (every 2 days at 11:00 ⚠️) until the documents are complete
  - a follow-up lands on the follow-up desk for tomorrow ⚠️
  - anyone without a consent form on file is flagged ✅
- **WhatsApp preview** ⚠️ format (placeholder wording in the build until Masti approves the real text, Q8): "Masti Travels — France visa documents" with a numbered list ("1. Passport (original) + old passports, 2. 2 photos, 35×45 mm, white background, 3. Bank statement, last 6 months…") and "Price per person: Embassy fee · VFS · Service · Courier".
- Intake forms for the other departments aren't designed in the demo. Only visa's is shown.

### 12.4 Visa: the 8-step case

**Case header:**
- Title "{Country (zone)} {type} visa — {family}", the case no., and "came in {date} on {source} · {pax} · travelling {month}".
- A status chip, **Postpone or cancel**, and the **next-step button**.
- Step chips 1–8. Click any chip to jump to that step.

**Status and next-step labels per step** ⚠️ (wording):

| Step | Status chip | Next-step button |
|---|---|---|
| 1 | Document list sent | Start collecting documents |
| 2 | Documents pending | Mark documents complete |
| 3 | File preparation | File ready — add to docket |
| 4 | Dispatched · D-121 | Dispatch docket D-121 |
| 5 | Submitted · FR-MUM-88421 | Record the decision |
| 6 | Approved | Passports on the way back |
| 7 | Passports in our stock | Hand over to the client |
| 8 | Delivered | See cross-sell leads |

**Right rail:**
- **Who it is for:** client and mobile.
- **Whose job it is now:** the owner and desk. The Follow-up desk owns steps 1–2; Visa processing owns the rest.
- **Sent to the client:** the WhatsApp log, with "Open chat".
- **Money on this case:** the invoice, the additional invoice, and "Followed up by accounts".

**Step 1 · Enquiry** ✅
- Only four things are asked. The document list goes out automatically. "Nobody sends anything by hand."
- The case sits with the follow-up desk until every document is in.
- The written doc's intake list includes a "time" field that nobody explained (§17).

**Step 2 · Documents** ✅ (see §10.4, §10.5)
- **Checklist:** per-traveller tabs ("Rakesh · adult", "Aarav · child, 12") and a counter ("8 / 11 for Rakesh Mehta").
  - Footer: "Clients don't upload anything — papers are scanned here by the follow-up desk. The checklist comes from Masters → France · Tourist."
- **Demo checklist** (France tourist ⚠️):

  | Document | We need |
  |---|---|
  | Passport | Original |
  | Old passports | Original |
  | Visa form, signed | Original |
  | Photos 35×45 mm (2) | Original |
  | Bank statement, 6 months | Xerox is fine |
  | ITR, last 3 years | Xerox is fine |
  | Leave letter / NOC | Original |
  | Salary slips, 3 months | Xerox is fine |
  | Flight reservation | Arranged by us |
  | Hotel bookings | Arranged by us |
  | Travel insurance | Arranged by us |

- **How documents reach us:** "Client brings them" or "Send collection boy" (who, slot, pickup address). Booklets received, e.g. "4 current + 3 old". "The booklet count is checked again at handover."
- **Reminders card:** On/off; "Every 2 days at 11:00 on WhatsApp, listing only what's still missing. Next: Wed 7 Oct." ⚠️ The client asked for WhatsApp or SMS reminders at company-set intervals ✅.
- **Postpone or cancel reason** ⚠️ values: Travel dates moved · Waiting for leave approval · Went with another agent · Trip cancelled. Copy: "Fixed reasons only — no free text anywhere." ✅
- **Consent card** per traveller: "Agreed · 28 Sep", "On file from 2025", or "None on file — flagged".
- **Captured as the documents come in** ✅: names, travel dates, duration, single/double/multiple entry, hotel stay, and anything else left incomplete.
- When documents are complete, the case is **matured** and assigned to one processor, who receives and checks the documents ✅.

**Step 3 · File preparation** ✅
- **Banner:** "Matured 6 Oct — All documents are in. Aarti handed the case to Neha Joshi in processing."
- **Apply on the government portal:** a portal card ("France visa portal — Masti master account. Opens logged in for this case. Staff never see the ID or password.") with **Log in for me** ✅.
  - The demo shows a toast afterwards: "Opened with the Masti master account for case V-2041. The ID and password were never shown."
  - The mechanism is the biggest technical unknown (§16.2).
- **Buttons:** Read passport scan · Fill from consent & trip details · Print application form. Autofill is "if technology allows" ❓ (Q13, §17).
  - Vimal's aim: less time, more accuracy, no typing errors. The data would come from the passport scan (MRZ/barcode), the consent form, and the trip details captured at document collection. "Whether it happens or not is a separate matter." *(transcript, 7:24–7:25 PM)*
- **Per traveller:** acknowledgement no. (typed in) and appointment ⚠️.
- **Covering letter** ✅:
  - A fixed format per process and family type (e.g. "Schengen · tourist · family").
  - Fills itself from the case: name, passport no., days, in/out dates.
  - Printed on the **customer's letterhead**.
  - A format change applies only from its effective date.
  - Formats are with Riya and Vimal ❓ (Q10).
- **Saved file, kept as proof** ✅: the final file (application form, ITR, bank statement, passport scan…) is saved as **one PDF, linked under the case number** in Drive. "Every page as it went to the vendor, stored in your Drive; the CRM keeps the link." Masti already keeps a single scanned PDF like this today; the CRM links it to the case *(transcript, 7:18 PM)*.
- The vendor comes from the approved list ✅.

**Step 4 · Docket & dispatch** ✅
- **Docket** (e.g. `D-121` to the Mumbai vendor), with a toggle: **One file per docket / Several files in one**. Grouping is ❓ (Q1); the demo defaults to several in one. Today Masti sends one docket per vendor per day, with all of that day's files; Vimal said both ways can be tracked *(transcript, 6:58 PM)*.
- **Docket table:** Case · Passports · Invoice, showing "INV-0412 · locked" or "Raise invoice first".
- **Rule copy:** "A file can't leave without its invoice. The invoice is built from the price quoted at the start — nobody types amounts — and can never be edited. Extra costs later go on one additional invoice, never more." ✅
- **Dispatch:**
  - courier and docket/AWB number, typed in ✅
  - **email to the vendor** with the docket list ✅ (per docket or once a day ❓ Q1). It lists the docket number and each application in it, with names and destination countries *(transcript, 6:59 PM)*.
  - a next-day follow-up to confirm the vendor got it ✅
- **Print sticker** (the parcel label) ✅, layout ⚠️: "MASTI TRAVELS D-121 · To: [Vendor], Mumbai · V-2041 (4) · V-2044 (2) · V-2047 (1) · 7 passports".

**Step 5 · At vendor** ✅
- **Timeline:** Dispatched → Vendor got it, papers checked → Submitted at the embassy.
- The **file/application number from the vendor** is typed in. It arrives by mail, WhatsApp or phone.
- Entering it forces a **mandatory expected (approximate) collection date** ✅. Embassies take about 10–20 days.
  - **Calendar per embassy:** embassy holidays can't be picked ✅. Sundays are blocked too ⚠️ ("holidays and Sundays can't be picked"; masters also list "Every Sunday · Weekly off · Collections & deliveries").
  - On save ⚠️: "the follow-up desk is reminded a day before to check with the vendor".
  - The case isn't touched until that date ✅.
- **Recall (take the file back)** ✅:
  - "When the embassy will take longer than the client can wait, the papers come back unsubmitted."
  - It is recorded with a reason, and a **credit note for the embassy fee only** is issued. E.g. on a ₹10,000 bill with a ₹3,000 embassy fee, ₹3,000 is returned. VFS, the service charge and courier both ways are kept.
  - The refund is deducted from what was paid, or the client is charged less if they haven't paid.
  - **Only an HOD can return more**, case by case ("Change refund (HOD)"). The override can only increase the refund; the other breakup items stay excluded by default *(transcript, 7:07 PM)*.
- **Additional invoice** ✅: "1 of 1 used", e.g. `INV-0412-A` · urgent submission charge.

**Step 6 · Decision** ✅
- Two outcomes: **Approved** or **Refused**. The demo records them **per traveller**, with the visa sticker number and validity (§17 #3, Q11).
- The refusal letter is a **Drive/OneDrive link**, not an attachment ("Open in Drive"): "Letters and scans stay in your Google Drive or OneDrive; the CRM keeps only the link so it stays fast."
- If approved, the visa sticker comes back with the passport.

**Step 7 · Passport back** ✅
- Vendor collected → **In transit**. Vendors are "not systematic", so record an expected arrival date.
- **In our passport stock (Received)**: "A passport counts as ours only once the packet is opened and punched at the office."
- Booklets are counted against intake ("4 current + 3 old — matches intake"), visa stickers are checked against names and dates, and the receiver is recorded ⚠️.
- The client is told the passport will be at the office in X working days: collect if urgent, otherwise it's delivered on Masti's schedule ✅.

**Step 8 · Delivered** ✅
- **Client collects from office** or **Our delivery boy**.
- **Proof:** OTP from the client (Verified), photo of the receiver, delivery-boy selfie, place and time ("Vesu · 12:10 pm"). The "as designed earlier" steps still need confirming (Q12).
- The file closes. Accounts follows up anything outstanding separately.
- The step lists the cross-sell leads created at invoicing, with their answers ("Insurance · Travel insurance for 4 · Answered · working on it", "Tickets · Mumbai–Paris flights · Answer required").

### 12.5 Field staff app (collection/delivery boy)

This is part of Stage 1 ✅.

- **A mobile-friendly web view**, not a native app. The "mobile app for calling" is a later phase. Phone or tablet, web app or WhatsApp-only, is ❓ (Q3). Vimal wants our recommendation.
- **Header:** "Ramesh's run · Sat 31 Oct · Collection & delivery · 3 of 5 done". Stops are ordered; each one reaches his **phone and WhatsApp** as soon as staff confirm it ✅.
- **Stop types** ✅:
  - pick up visa documents
  - deliver passport (OTP on handover)
  - collect payment: ₹ amount, cheque or cash. E.g. "collect ₹2 lakh from X's place"; the WhatsApp carries the address, number and amount.
- **Each stop:** client · case, address, time slot, and **Call** and **Directions** buttons.
- **Passport handover. He can't finish until every step is done** ✅:
  1. Booklets counted ("7 booklets — matches the office count")
  2. OTP from the client ("Rakesh reads out the code sent to him")
  3. Photo of the person receiving (opens the camera)
  4. Your selfie at the door ("Place and time are added by the phone")

  Then **Finish handover** (shown as "Finish handover · N steps left" until then).
- **Why it matters:** "On handover the OTP, photos, place and time are saved to the case — proof if a client ever says the passport never reached them."
- **Needs:** camera, geolocation and timestamps; an OTP sent to the client; usable on a phone in the field.

### 12.6 Holidays

- ✅ **What the client asked for:**
  - The quotation runs on the **AI itinerary automation discussed (and partly built) earlier**: "whatever was built, change from there". What exists is ❓ (Q16): ask Shivanshu.
  - Staff are **not involved until the client finishes modifications**.
  - Vehicle changes and vehicle cost update automatically ("two layers of automation").
- ⚠️ **Demo flow:**
  1. The enquiry comes from **website chat**. "What they told the chat": where, when, who, budget per person, hotels, likes, meals, flights.
  2. An itinerary is **built by AI from Masti's rate sheet**, day by day, with approximate costs.
  3. The quote **goes out by itself**, "11 minutes after the enquiry".
  4. The client replies on WhatsApp ("add a Gili day"). Status: "Client replied — your turn".
  5. Staff press **Rebuild with changes** (version 2), then **Send revised quote**.
- **Quote panel:** land cost (approx.), margin (12% ⚠️), GST (5% ⚠️), and the total the **client sees**.
  - **Margin and cost are visible to owners and accounts only** ✅.
  - **Quote versions are kept** ✅.
- On booking, cross-sell leads go to Tickets, Insurance, Visa and Hotels ✅.
- Needs from Masti: holiday rate sheets (hotels, transfers, sightseeing, vehicles).

### 12.7 Hotels ✅

- **Enquiries** look like "a hotel in city X, these dates, price?". Each staffer has 10–20 predefined hotels; predefining is feasible only for Goa, Gujarat, Surat, Abu Dhabi and metro business cities.
  - For those predefined hotels Vimal said "comparison doesn't come in, because those are hotels where we are the master". So the rate check may only apply to other hotels. Unclear; confirm (Q31) *(transcript, 7:30 PM)*.
- **Rate check, required before any quote:**
  - Rates are per room per night: for each option, the competitor rates (demo: MakeMyTrip, Agoda, Booking.com) **plus our vendor's rate**.
  - "The quote stays locked until every box is filled."
  - Entered by hand, **no API** ("we're not building a portal").
  - Which competitors is configurable by Masti ❓ (Q18).
  - **Why it's mandatory:** staff should price "nearest" to the market, neither above nor below it. And "if someone is lazy, what will I do? I don't want to allow laziness." *(transcript, 7:30–7:32 PM)*
- **Options:** max 3–4 per quote (PID: up to 4; the client tolerates 5). A second quote can follow.
- **Each option shows:**
  - hotel name and stars, and room category
  - **photos only from the official hotel link** (no link, no photo)
  - a refundability chip ("Free cancellation till 10 Nov" or "Non-refundable")
  - **distance and time from the client's point of interest**, e.g. "0.8 km · 4 min drive" from Dubai Mall
  - **lowest market rate**, **our buy rate**, **client pays (total)**, and **vs market %** (green if at or below market, red if above)
- **Markup:**
  - Chips for 5/8/10/12/15%, with a **minimum floor that can't be undercut**: "Minimum markup for 4★ is 8% — you can go above, never below."
  - It's in scope (PID: by star rating), though the client called it nice-to-have. The values are ⚠️ (3★ 10%, 4★ 8%, 5★ 6%) (Q17). The client also mentioned floors by price range.
  - **Its purpose:** stopping bookings from going through at tiny margins ("₹200, ₹300, ₹500") *(transcript, 7:42 PM)*.
- **Demo maths** ⚠️:
  - client price per night = buy × (1 + markup%)
  - total = × nights × rooms
  - lowest market = the minimum of the competitor rates
  - vs market = (client price − lowest market) ÷ lowest market
- **Client go-ahead:**
  - Terms are **built by the system** from the chosen option (room, meals, check-in/out, cancellation policy, refundable or not, total). "Nobody types these terms."
  - The client agrees **by OTP**.
- **Non-refundable consent:** "booked as a goodwill gesture on the client's request; if plans change, the client still pays." *Why:* Masti often books non-refundable rooms before the client pays ("I can't tell the client to pay first"), so the consent protects Masti *(transcript, 7:41 PM)*.
- **Block or book:**
  - **block:** where, confirmation no., time limit ("Blocked till Thu 6 pm")
  - **book:** reference no. and source
  - The vendor comes from masters; registered only, and created first if missing.
- **The voucher (Masti's design) and the invoice go to the client together.** The invoice also goes to Accounts.
- Follow-up works like visa. An alert fires when a hold is expiring (6 h before ⚠️).

### 12.8 Insurance: policies and renewals ✅

- **The quote records its purpose:** annual/renewal, for a visa, or cross-sell from a ticket. Demo: "What it's for: For a visa · Who: 4 · ages 44, 41, 12, 8 · Days: 14 · Where: Schengen".
- **Several insurers' plans side by side**, showing what each adds. Same trip, different premiums. "That comparison is the quotation."
  - Columns ⚠️: price per person, medical, baggage loss, passport loss, trip cancellation, existing illness.
- Mark the plan the client chose ("Mark as chosen" / "Client chose this").
- After issue, the **policy number is typed in** from the insurer's portal. Then "Issue & tell the client": the policy goes to the client on WhatsApp, and the invoice goes to the client and to Accounts.
- **Product data:** fetched if possible, else entered by hand (high-maintenance) ❓ (Q19).
- **Expiring in the next 30 days** list: client, type (Annual), insurer, expiry or lapsed, and the action ("Offer renewal" or "Not renewed · Vimal alerted"). Renewals are "our main focus".
- Reports by policy type (only implied in the demo's Reports).

### 12.9 Insurance: claims ✅

- **Register the same day:** mobile, email, policy no., passport details, claim type (lost bag, lost passport, medical, baggage delay…).
- The claim type's **document checklist and form** go to the client. It's the same checklist flow as visa, with reminders (every 2 days ⚠️).
- **Nothing goes to the insurer until every document is in. The cancelled cheque is compulsory.** The demo's baggage-delay checklist: boarding passes, airline delay report, bills for things bought, passport copy, cancelled cheque.
- On submission, notify the client with the date and time. Enter an **expected approval date** and follow up against it.
- **Statuses:**
  1. documents
  2. approved, with the amount
  3. payment: insurers pay in 10/15/30-day cycles; record the paid date and **UTR**
  4. **confirm receipt with the client** ("Check with Jigar that it reached him, then close")
  5. closed
- A rejection is recorded with a dropdown reason. It's rare: Vimal says they've never had one, because they pre-verify. If a claim isn't feasible, Masti doesn't submit it at all, "not even just to please the client" *(transcript, 7:51 PM)*.

### 12.10 Tickets: operations ✅

- **Travel calendar** of all booked trips.
- **Web check-in list:** 72 h before departure in the demo and PID; the written doc says 48 h ❓ (Q21). In the meeting Vimal started with "48 hours", then settled on "give us the list 72 hours before" *(transcript, 8:16 PM)*. So 72 h is his latest word; still confirm it in writing.
  - **Columns:** flies (date, time, "in 19 h"), passenger, flight (route), PNR, airline account (**Log in for me**), check-in.
  - **Outcomes:**
    - **Done**: boarding pass sent by link
    - **Client did it**
    - **Auto-assigned seat → paid seat offered**: message the client offering a chargeable seat, then close
    - "Opens in N h"
  - "Mark what happened — the client is told automatically."
  - Meal and seat extras can stay manual.
- **Fare changes billed to the client:** a log of booking, what changed (extra baggage, seat selection, cancellation), the difference, and how it's billed ("Add to invoice", "On INV-0420", "Credit note"). It must respect invoice immutability (§17 #10).
- The same **click-to-login** applies to airline and booking-platform accounts (IndiGo named).
- **Booking:** follow-up, then booking with the same T&C and non-refundable acceptance as hotels. The ticket copy and invoice go to the client; the invoice also goes to Accounts. Ticket copy "via link" ❓ (Q22). Vimal said the ticket copy "won't go from the system"; it should reach the client by link, along with the invoice *(transcript, 8:16 PM)*.
- **Query intake:**
  - domestic or international; one-way, round-trip or multi-city; dates; adults and children
  - AI parsing of pasted WhatsApp text or screenshots (any language) was proposed. Any fare it brings must be **bookable** (Vimal's concern): a fare is no use unless it can be booked on the channels Masti actually uses, at that price *(transcript, 7:55 PM)*.
  - Ticket queries arrive on WhatsApp and email today. Masti doesn't pre-purchase seats *(transcript, 7:52 PM)*.

### 12.11 Tickets: fare-options quote ✅

- Replaces screenshots with **one common format**.
- **This quote builder is the heart of the ticket module.** Vimal: if ticket quotes aren't made through the system, "the system won't work for tickets", because no data will come out of it *(transcript, 8:07–8:08 PM)*.
- **Header:** route, client, case, source, pax, trip type, date, cabin, and notes ("visa still pending").
- **Actions:** **Fill from a screenshot** (AI ❓ Q20) and **Send quote**.
- **Each flight option:** airline and routing (via/non-stop), aircraft, departure (day, time, airport and terminal), stops, arrival. The requirements also list flight number, class, duration, operating airline, baggage and stopover.
- **Up to 3 fare families per flight** as columns (e.g. Saver / Flex / Flex Plus).
  - Rows: **price per person, seat, cabin bag, check-in bags, date change, refund (or "Non-refundable"), no-show**. Miles and upgrades are not needed.
  - Demo colouring ⚠️: "Free" in green; "Non-refundable", "Full fare lost" and "Not allowed" in red.
- Staff pick which fares go into the client's quote ("Included" / "Add"). A preview shows **what the client receives**, in Masti's format: "MASTI TRAVELS Flight quote · T-1204", route, date, pax, "Option 1 · Saver ₹63,000 pp…", "Each fare's baggage, change and refund rules are listed."
- **Fare-family rules are fixed per airline, regardless of route** (Vimal). So there's an airline fare-family master. Shivanshu's proposal: pick the airline, a dialog shows its fare variants, staff enter the prices.
- **Requirement examples:** IndiGo ₹5,000 / ₹7,000 / ₹10,000 (with meal and seat); Emirates Saver ₹63,000 / Flex ₹93,000 / Flex Plus ₹1,78,000.
- **Why fare families matter:** business travellers almost always pick a flexible fare (low cancellation fee, free date change), and every airline offers them *(transcript, 7:57 PM)*.
- **Today's practice:**
  - The full fare rules go out only after the client picks a flight, because of the effort involved. Vimal would prefer them in the quote, so the client can decide better.
  - Fare names aren't written today.

  *(transcript, 8:05–8:10 PM)*
- **Staff choose which fares to offer.** Some combinations make no sense to send (e.g. Saver next to Flex Plus, unless the client wants a business upgrade) *(transcript, 8:14 PM)*.
- **GDS:** Vimal showed a quote from "our Galileo" GDS, but the ticketing head said "GDS nahi hai" ("there's no GDS"). Whether the desk uses Galileo is unclear (Q32) *(transcript, 8:03 PM)*.
- **A tip shown to staff** ⚠️: "Visa still pending — suggest a fare with a low refund fee, so the client loses little if the visa doesn't come." This matches Vimal's own practice of booking a refundable fare while a visa is pending *(transcript, 8:14 PM)*.

### 12.12 Follow-up desk ✅

- **Intro:** "The follow-up team chases clients until a case matures, then hands it to processing. Every outcome is picked from a list — no free text."
- **Counters** ⚠️: Overdue · Today · This week · Postponed.
- **Table:** Due · Client & case · Desk (department) · What for · Last contact ("WhatsApp reminder · 11:00", "Call · 28 Sep", "List sent · 3 Oct").
- **Log call** opens inline: What happened / Next step / When → Save.
- It holds the day's calls across departments. The team split is ❓ (Q2).

### 12.13 Cross-sell leads ✅

- **Intro:** "The moment any department invoices a booking, a lead is created in every other department. Nobody decides whether to pass it on — but every lead must be answered."
- **Tabs** ⚠️: For {my} desk · N to answer | Created from my bookings | All.
- **Each lead shows:**
  - "{Dept} booking invoiced"
  - the source case and when
  - a title ("Travel insurance for the Mehta family (4)")
  - why ("France visa invoiced · travelling 20 Dec – 2 Jan")
  - the answer dropdown, and a status chip (Answer required / Answered)
- **"Where leads came from"** report: source → leads → booked (walk-in/phone/WhatsApp, Instagram & Facebook, Justdial, from Visa/Holidays/Tickets/Hotels).

### 12.14 Clients ✅

- **Header:** initials, name, mobile · email · area · client since · "customer code in accounts", and a **New enquiry for {client}** button.
- **Tiles:** Business with us (₹ · trips) · Open now (departments) · Still to pay (₹) · Pays (payment habit).
- **"Everything we've done for this family":** case · service · what · where it stands.
- **Family & travellers:** name · relation · passport valid till (with "renew soon") · consent form.
- **Messages sent:** the WhatsApp count and "See the chat".
- **Notes:** free text, with author and date. Not used in reports.

### 12.15 Accounts: invoices and payment follow-up ✅

- **Intro:** "Every invoice any department raises lands here with a follow-up already on it. Accounting itself stays in your accounting software."
- **KPIs:**
  - Outstanding (₹ · count)
  - Overdue (₹ · count)
  - **Sent, call not made** ("a call after sending is compulsory")
  - **3rd follow-up or more** ("on Vimal's dashboard")
- **Tabs:** Follow up today · Overdue · Weekly · Half-monthly · Monthly · Routine.
- **Table:** Invoice · Client · From (department) · Sent (channel · cycle) · Call after (Done / Not yet) · Follow-ups ("1 of 2", "2 of 2", "3rd · Vimal", "auto on bill day").
- **Rule copy:** "Weekly, half-monthly and monthly accounts come up on their billing day by themselves. Routine clients get two follow-ups; a third needs permission and goes to Vimal."
- **Why the cap:** "we don't want one person to be called ten times". Vimal sees every case on a 3rd, 4th or 5th follow-up on his dashboard, so he can step in *(transcript, 8:25–8:26 PM)*. Cycle customers need no follow-up date at all: they surface on their billing day with everything outstanding *(8:24 PM)*.
- **Invoice detail:**
  - status (e.g. "Part paid"), and "Raised by Neha before dispatch · locked"
  - invoice amount, received (mode), balance
  - a **"What was done"** log of follow-ups and the call after sending, with who did each
  - the next follow-up, labelled "Follow-up 2 (last before Vimal)"
  - buttons: **Record payment**, **Send collection boy**
- The customer master must be complete before invoicing. An export file for the accounting software is fine in phase 2 ❓ (Q26).

### 12.16 Accounts: tasks and collections

- **Routine accounts tasks** ✅ asked for; ⚠️ Vimal later called them optional. They're in scope, low priority, Stage 3.
  - **Demo groups:**

    | Group | When | Tasks |
    |---|---|---|
    | Daily | every working day | bank match, cash match |
    | Weekly | every Monday | bank reconciliation, cheque deposit |
    | Monthly | by the due date | TDS paid (by 7th), GSTR-1 (by 11th), GSTR-2B checked (by 14th), GSTR-3B (by 20th) |
    | Quarterly | by the due date | advance tax (by 15 Dec) |

  - Each task has an owner and a done tick; the card shows "N of M done".
  - "Vimal adds or removes tasks, sets how often (weekly to yearly) and who does it." Tasks are confirmed before the due date and shown on the dashboard.
  - Vimal listed frequencies from weekly to yearly, including quarterly and half-yearly. He called the module "just a thought", so that everything lives on one platform, and said it can be dropped like HR *(transcript, 8:27 PM and 8:35 PM)*.
- **The collection boy's run today** ✅:
  - numbered stops with type, client and area, case, payment mode, and status (Collected / On the way / time slot)
  - "Each stop reaches his phone and WhatsApp once staff confirm it"
  - a link to the field app

### 12.17 Reports ✅

- **Framing:** "Bookings already reach your accounting software. This is about the business that didn't come in — and why."
- **Tabs:** **Lost business** (designed) · Visa · Staff workload · Outstanding · Cross-sell. The other four are shown but **not designed**, and the PID commits to them. Define them with the client (Q27).
- **Lost business:**
  - Queries in · Booked (%) · Lost (%) · Still open
  - **Why we lost them**, by reason
  - **Where in the process**: before a quote went out / after the quote / after documents or booking started
  - **By department**: queries, booked, lost, top reason
  - **By source**: queries, lost, lost %
  - Insight line: "Most are lost after the quote — exactly where the rate checks and follow-up rules aim."
- **Also required:** cross-sell outcomes (given/matured/lost), insurance by policy type plus expiries, outstanding, cases with 3+ follow-ups, routine-task status.
- **Sample lost reasons** ⚠️: Our price was higher · Went with another agent · Trip postponed / cancelled · No reply from client · Visa no longer needed · Documents not available. Every figure on the screen is sample data.

### 12.18 Notice board, IVS feed, weather and login popup

- **Intro** ✅: "What each department needs to know, arranged by airline, embassy and hotel — so staff look it up here instead of asking around."
- **Filters and actions:** department tabs (All, Visa, Holidays, Hotels, Insurance, Tickets, Accounts); filter by Everything / Airline / Embassy / Hotel; **Post**.
- **Each post** ⚠️: department, tag ("Embassy · China", "Airline · [Airline]", "Hotel · [Hotel group] Dubai", "Process"), author · source · time, title, body.
- **Visa news from IVS:** a paid daily feed of consular staff, timings, holidays, fees, contacts and form links ❓ (Q24). "Vimal picks what goes into the visa team's login popup." Automatic alerts come "if technology allows"; Masti judges authenticity.
- **Weather for the next 10 days' travellers** (where, who, forecast): nice-to-have ❓ (Q25).
- **Holiday-calendar entries** show on the dashboard and in the visa login popup ✅.
- **Curated first, automatic second.**
  - The visa HOD suggested fetching updates automatically from embassy websites. Vimal said scraping scripts "don't come out right", and a login popup plus updates posted by the team is better *(transcript, 7:19–7:23 PM)*.
  - Masti decides what's authentic: "we just need the technology" *(8:40 PM)*.
- A small calculator was mentioned in the meeting. It's not in the demo.

### 12.19 Settings: portal logins (credential vault) ✅

This is the biggest technical unknown (§16.2).

- **How it works:** "Visa and airline accounts belong to the company. Staff press 'Log in for me' and never see the ID or password, so when someone leaves, switching off their CRM login is enough."
- **Rotation:** "Passwords change on the schedule you set. On the due date the HOD is asked to reset; the account stays locked for everyone until that's done. Log-ins work only from the office network."
- **Each row:** department · who may use it · portal (ID masked, password hidden) · rotation status ("Changed monthly · next 12 Oct", "Weekly change overdue — HOD to reset", Locked) · **Log in for me**.
- **"Who used what" log:** person · portal · time · case.
- **Portals:** VFS (Belgium), China, e-visa and other visa portals; IndiGo and other airline agent portals; booking platforms. Per-portal rotation: daily, weekly or monthly ("we change monthly").
- **Why rotation is enforced:** ex-staff know the pattern used to make the passwords, and policies "get rolled out but never applied". So the system has to make the HOD do it *(transcript, 6:54 PM and 8:20 PM)*.
- Vimal also restated that the CRM login itself is to be "white label, IP-based", a "secure login", as discussed at an earlier meeting (Q14) *(transcript, 8:21 PM)*.

### 12.20 Settings: masters, staff and roles ✅

- **Intro:** "The lists and rules the rest of the system reads from. Only Vimal and HODs can change them." ⚠️
- **Holiday calendar, per embassy:**
  - each entry: date (single, range, or recurring, e.g. "Every Sunday · Weekly off · Collections & deliveries"), holiday name, embassy/applies to ("China embassy & visa centres", "All embassies in India · our office", "French embassy, Mumbai"), and added by (+ "from IVS")
  - "Can't be picked as collection dates. New entries show on the dashboard and in the visa team's login popup."
- **Reminder rules** (§10.9).
- **Vendors:** location, countries covered, Approved / Waiting HOD. "Staff can only pick approved vendors."
- **Hotels, minimum markup** by star rating, plus the required competitor sites.
- **Dropdown reasons:** "No free-text box for reasons, anywhere." Demo values: Trip cancelled · Went with another agent · Price higher · Visa not needed · Documents not available · No reply.
- **Staff & roles:** Head · everything; HOD · refunds, vendors, resets (per department); Staff · view or edit.
- **Also kept here:** document checklists (country × type), covering-letter formats, accounts routine tasks, customers (fixed format · accounts code), plus everything else in §10.12.

### 12.21 WhatsApp automation and the message catalogue

**Required for visa** ✅:
1. pending-document reminders
2. file submitted
3. rejected ("sorry") or approved ("congratulations"), with the passport at the office in X working days: collect if urgent, otherwise delivered on Masti's schedule
4. handed over, whether collected or delivered

**Vimal will write the exact step list and wording** (Q8). It's **urgent**, because Meta's template approval takes time.

**The demo's visa sequence** (⚠️ the wording is ours; these become templates with variables):

| # | When (demo) | Title | Body |
|---|---|---|---|
| 1 | Enquiry saved | France visa — your document list | Hello Rakesh ji, here is the list of documents for 4 travellers, and the price per person: embassy fee ₹[x], VFS ₹[x], service ₹[x], courier ₹[x]. |
| 2 | Reminder (every 2 days) | Reminder: documents pending | Still pending: bank statement (6 months), ITR (3 years), leave letter. Our collection boy can come to you. |
| 3 | Documents complete | All documents received | Thank you! Your file is now with our visa team. |
| 4 | Invoice raised | Invoice INV-0412 | Your invoice for the France visa is attached. Pay by UPI or at our office. |
| 5 | Submitted | File submitted | Your France visa file was submitted at the embassy today. Expected around Tue 27 Oct. |
| 6 | Approved | Congratulations! | All 4 visas are approved. Passports reach our office in about 2 days — collect from our Vesu office, or our person will deliver as per our schedule. |
| 7 | Passports in stock | Passports are at our office | Delivery booked for Sat 31 Oct, 11 am – 1 pm. Reply here to change it. |
| 8 | Delivered | Delivered | Passports handed to Rakesh Mehta at 12:10 pm. Have a wonderful trip! |

**Other automated messages the requirements imply** ✅:
- the refusal ("sorry") message
- the consent link
- OTPs (passport handover; hotel and ticket terms)
- collection-boy jobs (address, number, amount)
- invoices
- hotel voucher + invoice
- insurance policy + invoice
- renewal offers
- the claim checklist and form; "claim submitted" (date and time)
- ticket quotes
- web check-in done (boarding pass link) and the paid-seat offer
- holiday quotes and revisions

### 12.22 Phase 2: not in this project

- **Transport** (duty allotment, vehicle number, start/end km, preferred driver per corporate client), **Cruise** and the **mobile calling app** come after the core runs successfully, and are charged separately ✅.
- "Design for them now": keep departments, stage flows and masters data-driven so that new departments slot in.
- **Deferred:** HR, sales CRM/feedback, the accounting export (phase 2 is fine).
- Call recording and IVR were never mentioned.

---

## 13. Domain entities implied by the requirements

> This is a starting point for the Day-4 data model, **not a decided schema**. The project lead's decision records override it.

| Entity | Key fields / notes |
|---|---|
| User | name, mobile, email, type (HEAD / OFFICE / FIELD), department roles (Staff / HOD, OFFICE only), active. Disabling it revokes sessions and vault access. |
| Department | Visa, Holidays, Hotels, Insurance, Tickets, Accounts; colour; stage flow (as data). Field staff are a user type, not a department. |
| Client ✅ built (0004) | mobile (unique lookup key), kind (individual/corporate), name, contact person, email, address line, area, city, GST state, PIN, PAN, GSTIN, accounting code (unique), billing cycle (default monthly), payment habit, client since. Completeness is worked out from the `clients.invoiceReadiness` setting, not stored. |
| ClientPhone ✅ built | client, extra mobile, label. Matched by lookup; not unique across clients. |
| ClientMember ✅ built (the "Traveller") | client, passport name, relation (master), DOB (age/child worked out), own mobile, current passport no., passport expiry, archived at. Case travellers (`VisaCaseTraveller`) link here in Visa Step 2. |
| ClientNote ✅ built | client, body, author, at. Append-only, never reported on. |
| BillingCycle / PaymentHabit / Relation ✅ built | Seeded lookup tables (masters); admin screens come with System Masters |
| Consent | person (one per lifetime; keyed to `ClientMember`), staff-filled details, wording version, link token, accepted at, channel, stored link |
| Enquiry | case no., client, department, source, services, summary, stage, next step, due at, owner, desk, status (open / postponed / cancelled / lost / closed) + reason, origin (direct or cross-sell lead) |
| FollowUp | enquiry, due at, done at, by, what happened, next step, next date |
| VisaCase | country, visa type, adults, children, entry type, duration, travel date, hotel stay, vendor, docket, vendor file no., expected collection date, recall |
| ChecklistItem | case or claim, traveller, document type, requirement (Original / Xerox / Arranged by us / Not needed), received as (O/X), received at, by |
| Docket | number, vendor, courier, docket/AWB no., files, dispatched at, vendor-confirmed at, vendor email sent at |
| VisaDecision | case, traveller, approved/refused, sticker no., validity, refusal-letter link |
| PassportMovement | case, status (with vendor / in transit / in stock / handed over), expected at, received at, booklet count, by |
| FieldJob | department that raised it, assignee (any user; skeleton table exists), type (document pickup / passport delivery / payment collection), address, slot, amount, status, proof (OTP verified, photo link, selfie link, lat/long, time) |
| Quote / QuoteOption / QuoteLine | enquiry, version, price breakup lines, options (hotel A/B/C, insurance plans, fare families), totals, margin (restricted visibility) |
| HotelRateCheck | quote option, competitor, rate per night, vendor rate |
| Booking | hotel block/book (where, confirmation no., time limit, reference, source), ticket PNR, policy no. |
| Invoice | number, case, type (main / additional), lines copied from the quote, GST, total, issued at, sent via/at. **Immutable.** |
| CreditNote | invoice, reason, amount, HOD override (by whom) |
| Payment | invoice, amount, mode, received at, by |
| AccountsFollowUp | invoice, due at (set by the raising department), call-after-send done, count (max 2), 3rd-follow-up approval |
| CrossSellLead | source invoice, source dept, target dept, answer, answered by/at, outcome |
| InsurancePlan / Policy | insurer, plan, covers, premium; policy no., purpose, start/expiry, renewal status |
| Claim | policy, claim type, contacts, documents, sent to insurer at, expected decision, approved amount, paid at, UTR, client confirmed at, rejection reason |
| FlightOption / FareFamily | flight details; airline fare-family master (seat, bags, change, refund, no-show) |
| WebCheckIn | booking, departure at, status (done / client did it / paid seat offered), boarding-pass link |
| FareChange | booking, change type, amount, billed via (new invoice / credit note) |
| Vendor | type, location, countries/services, approval status, approved by |
| EmbassyHoliday | embassy/applies to, date / range / recurrence, name, source |
| PortalCredential | portal, URL, department, allowed users, encrypted secret, rotation frequency, next due, locked, office-only |
| PortalUsageLog | user, portal, at, case |
| Notice | department, category (airline / embassy / hotel / general), tag, title, body, author, source (IVS / staff / calendar), login-popup flag |
| MessageLog | template, recipient, channel (WhatsApp / SMS / email), payload, status, sent at, case |
| RoutineTask | name, frequency, owner, due, done at |
| Masters | reasons (by type), sources, visa types, entry types, document types, checklists, price breakups, competitors, markup floors, claim types, insurers/products, fare families, billing cycles, reminder rules, covering-letter templates (effective-dated) |
| AuditLog | actor, action, entity, before/after, at, IP, geo |

---

## 14. Integrations and third-party services

| Service | Used for | Status / notes |
|---|---|---|
| **WhatsApp Business API** (through a BSP) | All client messages, reminders, consent links, collection-boy jobs | ✅ Required. Needs Masti's Meta Business Manager, number and business verification, plus Meta-approved templates. About 35 paise/msg; ₹30–40k/month is acceptable. **Long lead time: start in week 1.** |
| **SMS / OTP** provider | Fallback reminders, the consent link, OTPs (handover, terms acceptance) | ✅ Required. Indian SMS needs DLT registration (sender ID, templates). |
| **Email** (SMTP / Google Workspace) | Vendor dispatch emails, invoices | ✅ |
| **Google Drive / OneDrive** | Store documents; the CRM keeps links | ✅ The folder structure and owner are ❓ |
| Google Workspace login through the CRM | One switch-off ends all access | ❓ Feasibility and scope (Q15). Listed in the PID's third-party costs. |
| **Visa portals** (VFS, China, e-visa…) and **airline/booking portals** (IndiGo…) | Click-to-login vault | ✅ Promised. The mechanism is unproven (browser extension?): spike it first. |
| **IVS** visa-news feed (paid) | Daily visa updates → notice board and login popup | ❓ Subscription, cost, integration (Q24). Also written "IVF" or "IBS" in the sources. |
| PAN verification | Fetch details from a PAN (like EasyLife/TBO) into bookings and vouchers | ❓ In scope? Which provider? (Q23). Listed in the PID's third-party costs. |
| **AI / LLM** | Enquiry fill-from-message/screenshot (Hindi/Gujarati/English), ticket screenshot parsing, holiday itineraries | ✅ Enquiry parsing (PID); ❓ ticket parsing (Q20). Assistive. Track the cost per call. |
| Passport MRZ / barcode | Visa form autofill | ❓ "If technology allows" (Q13) |
| Accounting software (unnamed) | Store client codes; export/upload file | ❓ Name, format, phase (Q26) |
| Weather API | Forecast for the next 10 days' travellers | ❓ Nice-to-have (Q25) |
| Couriers (e.g. Blue Dart) | Docket number typed in | ✅ Manual, no integration |
| MakeMyTrip / Agoda / Booking.com, GDS Galileo | Rate references, layout reference | ✅ Manual entry. **No API.** |
| Hosting | Masti's own cloud or server (AWS / GCP / DigitalOcean mentioned) | ✅ Server spec and monthly cost due before go-live |

**Rule:** any feature with a recurring cost must be quoted up front, per hit or fixed, so that Vimal can decide ✅.

---

## 15. Design system

These tokens come from the approved demo. Vimal approved the look (internally "Option C": warm cream background, sea-blue accents) ✅. Staff use it all day, so it should be fast, calm and low on clicks.

**Base colours:**

| Token | Hex | Use |
|---|---|---|
| Page background | `#FBF8F3` | Cream page |
| Sidebar | `#F4EEE4` | 248 px wide, right border `#EDE6DA` |
| Surface | `#FFFFFF` | Cards, inputs, default buttons |
| Card border | `#EDE6DA` | Cards, table header border |
| Input border | `#E2D9CA` | Inputs, default buttons (hover border `#D8CDBB`) |
| Divider | `#F4EFE6` | Row dividers |
| Ink | `#1F2A37` | Main text, dark button (hover `#33404F`) |
| Secondary text | `#4A453E`, `#5E584F` | Labels, secondary text; sidebar text `#3F3A33` |
| Muted text | `#7A746B` | Meta text, table headers |
| Faint text | `#A39B8E` | Placeholders, disabled, struck-out options |
| **Primary (sea blue)** | `#1E5AA8` | Primary button, links, active nav item, "due today" |
| Primary hover | `#174A8C` | Hover/pressed |
| Primary tint | `#E7EFFA` | Info chip, avatar background. Active department in the sidebar uses `#E2EAF6` with text `#174A8C`. |
| Row hover / selected | `#F3F7FD` | A selected row adds an inset 4 px `#1E5AA8` left bar |
| Fills | `#F7F2EA` tiles · `#F1EADF` tab/segment track · `#F6F1E8` button hover · `#ECE4D7` nav hover · `#FCFAF6` table head · `#F3EEE5` bar track / muted chip | |
| Late | `#E0623A` | Overdue time |

**Department colours:**

| Department | Solid (dots, bars, active step) | Tint (chip background) | Text (chip text) |
|---|---|---|---|
| Visa | `#7C6FE0` (case accent `#6A5BD6`) | `#ECEBFB` | `#4C3FB5` |
| Holidays | `#E8734A` | `#FDECE4` | `#B4471F` |
| Hotels | `#1E9E95` | `#E2F4F2` | `#12726B` |
| Insurance | `#2F9E62` | `#E5F5EC` | `#1F7A4B` |
| Tickets | `#3BA3D0` | `#E3F1F8` | `#1B6B92` |
| Accounts | `#E0A030` | `#FBF0DC` | `#9A6200` |

**Status chips** (background / text):

| Chip | Background | Text |
|---|---|---|
| ok | `#E5F5EC` | `#1F7A4B` |
| warn | `#FDF1DA` | `#8A5A00` |
| bad | `#FDECE7` | `#B9452A` |
| muted | `#F3EEE5` | `#5E584F` |
| info | `#E7EFFA` | `#1E5AA8` |

**Typography:**
- **Outfit** (500–800) for headings and big numbers. **Nunito Sans** (400–800) for body and UI. **DM Mono** (500) for codes such as case numbers.

| Style | Spec |
|---|---|
| h1 | 28px / 700, letter-spacing −0.01em |
| h2 | 17px / 700 |
| Body and tables | 14px |
| Table headers | 12px / 700, muted |
| Labels | 11.5px / 800, uppercase, 0.07em tracking, `#7A746B` |

**Components and spacing:**

| Element | Spec |
|---|---|
| Cards | Radius 20px, padding 20×22px, shadow `0 1px 2px rgba(31,42,55,.04)` |
| Buttons | 40px tall, radius 14px, 14px/700 text. Small: 34px, radius 12. Primary sea blue; dark ink; default white with `#E2D9CA` border. |
| Inputs | 42px, radius 12px |
| Chips | 26px pill, 12.5px/700. Filter chips: 38px pill. |
| Tabs | In a `#F1EADF` track (radius 16); each tab 38px, radius 12; the active tab is white with a soft shadow. Segmented control (List/Board): 32px. |
| Nav items | 42px, radius 14. Sub-items: 35px. |
| Avatars | 36px circles with initials |
| Progress bars | 10px, rounded |
| Grids | Gap 18px (4-column grids: 14px) |
| Detail pages | Main column + **340px right rail**, gap 20px |
| Today hero | Blue gradient banner with a plane-and-sun illustration |

**Tone of copy:**
- Plain, friendly, short English for non-technical staff. Rules are explained inline, where they bite.
- Staff-facing examples: "Log in for me", "Whose job it is now", "Mark documents complete →", "Fixed reasons only — no free text anywhere.", "A file can't leave without its invoice.", "Answer required", "Nobody sends anything by hand."
- Client-facing messages are warm: "Hello Rakesh ji…", "Have a wonderful trip!"

*Note:* the offline demo embeds its fonts as base64. The real app runs on Masti's servers, so self-host the fonts rather than depending on a third-party CDN at runtime (suggestion).

---

## 16. Engineering: constraints, risks, decisions, current code

### 16.1 Hard constraints

Source: `04_Engineering_Constraints.md`. Neither the contract-based nor the client-based ones can change without Shivanshu.

**From the contract:**
1. It runs on Masti's servers or cloud account, with a clean handover (IaC or runbook, documented env vars, DB backups) and no lock-in.
2. Masti gets a clean, documented repo that a third party can build. No secrets in code; no closed or paid libraries Masti can't keep.
3. Exclusivity: its own repo, with nothing pulled in from or pushed out to other Acceleret codebases.
4. Role-based maintenance access: we maintain it without owner-level access.
5. A cost line for every paid service, for the cost sheet before go-live.
6. Go-live 1 Jan 2027; the buffer to 15 Jan is only for documented client delays.

**From the client:**

7. No free text.
8. Immutable invoices from the quote breakup. At most one additional invoice per visa file. A recall produces a credit note (embassy fee only by default, HOD override). Not accounting software.
9. Documents as Drive/OneDrive links. Each submitted visa file is saved as one PDF.
10. In-office scanning only.
11. Staff → HOD → Head roles. Disabling a user ends all access.
12. Audit trail: who, when (to the minute), where.
13. WhatsApp Business API (BSP + templates).
14. The field screen: OTP, camera, geolocation, timestamps.
15. Tech that lasts 10–15 years.
16. The UI matches the demo.
17. Configurable masters.

### 16.2 Technical risks: prove these first

| Risk | Why it matters | First step |
|---|---|---|
| **Click-to-login portal vault** | The core promise ("staff never see passwords"), on government and airline portals we don't control. Feasibility is unconfirmed. | Spike in weeks 1–2 on one visa portal and one airline portal. A likely approach: a managed browser extension that injects stored credentials, with server-side rotation and locking. Tell Shivanshu what *can't* be done before the client assumes it can. |
| **WhatsApp Business API** | Meta verification, the BSP account and template approval take days to weeks. Everything client-facing depends on it. | Pick a BSP in week 1, get Masti's Meta details, submit templates early. |
| **AI parsing** (enquiries, holiday itineraries, ticket screenshots) | Accuracy, Gujarati/Hindi input, cost per call | Keep it assistive (staff confirm). Track the cost per call. |
| **Holiday quote automation** | "Already discussed and built earlier" | Ask Shivanshu on day 1 what exists. |
| **IVS feed, PAN verification, Google Workspace login** | Unknown cost and integration method | Put them on the client inputs checklist and get the facts in week 1. |

### 16.3 Decisions owned by the project lead

Present these to Shivanshu around day 3–4, as short decision records (the options considered, the pick, and why).

1. **Stack:** frontend, backend, DB, ORM, background jobs and queues, file/PDF generation. *Partly implied by the current scaffold (§16.4); formal records still due.*
2. **Architecture:**
   - module boundaries
   - the shared enquiry and stage model across departments
   - how masters drive behaviour
   - the permissions model
3. Hosting recommendation for Masti's account, with a monthly cost, plus our dev and staging setup until handover.
4. WhatsApp BSP and template strategy.
5. SMS/OTP provider.
6. Click-to-login approach, after the spike.
7. Field-staff device: phone or tablet, PWA or WhatsApp-only.
8. Docket grouping recommendation.
9. **Engineering setup:**
   - repo and branching
   - CI/CD and code review
   - environments (dev / staging / prod)
   - backups and monitoring
10. Testing approach, especially for the money and rule logic.
11. Data migration plan, if Masti's existing clients are imported.

### 16.4 Current codebase (as of 8 Oct 2026)

Built so far: **authentication, users, department roles and the audit log**, end to end, with tests, and the **client master** (API + tests, and the Clients screens). Decision records: `docs/decisions/0001-auth-sessions.md`, `0002-user-types.md`, `0004-client-master.md` (`0003-visa-intake.md` is proposed, not built). The git repo has a GitHub remote (`origin`). `Masti-CRM-Handover/` is gitignored and kept local.

```
Masti CRM/
├── CLAUDE.md, PROJECT_KNOWLEDGE.md, QUESTIONS_TO_ASK.md
├── docs/decisions/               ← decision records (0001-auth-sessions.md)
├── Backend/                      ← Express 5 + TypeScript 6 (strict, CommonJS) + Prisma 7 + PostgreSQL
│   ├── docker-compose.yml        ← local dev Postgres 17 (credentials from .env POSTGRES_*)
│   ├── prisma/schema.prisma      ← Department, User (type HEAD/OFFICE/FIELD), UserDepartment, FieldJob (skeleton), Session, AuditLog, Setting,
│   │                                Client, ClientPhone, ClientMember, ClientNote, BillingCycle, PaymentHabit, Relation
│   ├── prisma/migrations/        ← *_auth (AuditLog append-only trigger), *_add_user_types (field-mobile CHECK, office-only department triggers),
│   │                                *_client_master (mobile/PAN/GSTIN/passport CHECKs, one default billing cycle)
│   ├── prisma/seed.ts            ← departments, client lookups + settings, first Head user (SEED_HEAD_* in .env; promotes a matching user if no Head exists)
│   ├── src/app.ts                ← helmet, cors, json, cookies, requireJson, routes, errorHandler
│   ├── src/config/               ← env.ts (zod-validated), prisma.ts (PrismaClient + @prisma/adapter-pg)
│   ├── src/modules/              ← one folder per feature: *.routes.ts (HTTP only), *.service.ts (logic, transactions,
│   │   │                            audit), *.schemas.ts (zod, frontend-shareable)
│   │   ├── auth/                 ← login/logout/me/change-password + session.ts, password.ts (argon2id),
│   │   │                            identifier.ts (mobile/email), permissions.ts (can, isHodOf), officeNetwork.ts
│   │   ├── users/                ← user management (Head only) + user.ts (withDepartments, toUserDto)
│   │   ├── clients/              ← client master: clients, extra numbers, members, notes, lookup/search, settings;
│   │   │                            access.ts (who may edit), duplicates.ts (confirmDuplicates), readiness.ts (assertInvoiceReady)
│   │   ├── departments/          ← active department list
│   │   └── health/               ← server and database status
│   ├── src/middleware/           ← auth.ts (requireAuth, requireHead, requireDepartment,
│   │                                requireUserType, requirePasswordChanged), error.ts, requireJson.ts
│   ├── src/lib/                  ← audit.ts (append-only audit helper), httpError.ts, dates.ts (IST today, @db.Date helpers)
│   ├── tests/                    ← vitest + supertest against masti_crm_test (.env.test)
│   └── .env / .env.test          ← gitignored; see .env.example / .env.test.example
└── Frontend/                     ← React 19 + Vite 8 + TypeScript 6
    ├── src/main.tsx, App.tsx     ← React Query + React Router 8 + ToastProvider; routes /login, /change-password, /, /clients,
    │                                /clients/:id, /settings/users, /tasks (field staff)
    ├── src/auth/                 ← useMe/useLogin/useLogout/useChangePassword, RequireAuth, RequireDesktop, RequireField, RequireHead,
    │                                permissions.ts (can, canEditClients, canEditAccountsFields: mirrors the backend)
    ├── src/pages/                ← LoginPage, ChangePasswordPage, TodayPage (placeholder), UsersPage, TasksPage (field placeholder)
    │   └── clients/              ← ClientDirectoryPage, ClientDetailPage, form drawers (react-hook-form + zod mirroring the backend),
    │                                queries.ts (TanStack Query), useDuplicateGuard + DuplicateWarningModal (confirmDuplicates), apiErrors.ts
    ├── src/components/           ← AppShell (approved sidebar), Toast (ToastProvider), FormField, ConfirmDialog
    ├── src/lib/                  ← api.ts (fetch wrapper, ApiError), departments.ts (colours), format.ts, toast.ts (useToast), useDebouncedValue.ts
    └── src/styles/               ← tokens.css (demo colours/fonts), base.css (incl. toasts, form errors), shell.css, auth.css, clients.css
```

**API so far:**

| Endpoint | Who | What |
|---|---|---|
| `GET /api/health` | anyone | Server and database status |
| `POST /api/auth/login` | anyone | `{ identifier, password }`. The identifier is a mobile number (any Indian format) or an email. Sets the `masti_sid` cookie. |
| `POST /api/auth/logout` | anyone | Ends the session |
| `GET /api/auth/me` | signed in | Current user with departments |
| `POST /api/auth/change-password` | signed in | Clears `mustChangePassword` and logs out other devices. Needs `currentPassword`, except for the forced change right after a temporary-password login |
| `GET /api/departments` | Head, office staff | Active departments |
| `GET/POST /api/users`, `GET/PATCH /api/users/:id` | Head | List, create (returns a one-time `tempPassword`), edit. `type` is HEAD / OFFICE / FIELD; departments only for OFFICE; FIELD needs a mobile. |
| `POST /api/users/:id/deactivate` / `activate` / `reset-password` | Head | Deactivating or resetting **ends their sessions immediately** |
| `/api/clients/*` | Head, office staff (edit: any department EDIT; billing fields: Accounts) | Client master: lookup, search, profile, create/edit (optimistic locking), main/extra numbers, members, notes, readiness, settings. Full list in `docs/decisions/0004-client-master.md`. |

**Rules every new route must follow:**
- Protect routes with `requireAuth`, then `requirePasswordChanged`, then `requireDepartment('VISA', 'EDIT')` (or `requireHead`).
- A route with no department check needs `requireUserType(...)`, e.g. `("HEAD", "OFFICE")` for desktop-only data. Field staff get only `/api/auth/*` and, later, `/api/field/*` (their own jobs).
- Read the user with `currentUser(req)`.
- Check finer rules with `can()` / `isHodOf()` from `src/modules/auth/permissions.ts`.
- Record every change with `audit({...}, tx)` from `src/lib/audit.ts`, inside the same transaction.
- Throw `HttpError` / `badRequest()` / `forbidden()` etc.; `errorHandler` turns them (and zod errors) into JSON.
- State-changing requests must be JSON (`requireJson`, the CSRF guard).

**Versions** (from `package.json`):

| Part | Packages |
|---|---|
| Backend | `express ^5.2.1`, `typescript ^6.0.3`, `prisma` / `@prisma/client` / `@prisma/adapter-pg ^7.10.0`, `pg`, `zod ^4`, `@node-rs/argon2`, `cookie-parser`, `express-rate-limit ^8`, `helmet`, `cors`, `morgan`, `dotenv`, `tsx`; tests: `vitest ^5`, `supertest` |
| Frontend | `react` / `react-dom ^19.2`, `react-router ^8`, `@tanstack/react-query ^5`, `@fontsource/*` (Outfit, Nunito Sans, DM Mono, self-hosted), `vite ^8.3`, `typescript ^6.0.3`, `oxlint` |
| Local | Node v24.13, npm 11.12, Docker (dev Postgres) |

**Commands:**

| Where | Command | What it does |
|---|---|---|
| Backend | `npm run db:up` / `db:down` | Start/stop the local Postgres container (`docker compose`) |
| Backend | `npm run db:migrate` | `prisma migrate dev` |
| Backend | `npm run db:generate` | `prisma generate` (run after every schema change) |
| Backend | `npm run db:seed` | Departments, client lookups and settings, first Head user (prints a one-time temporary password). Never overwrites existing rows. |
| Backend | `npm run db:studio` | Prisma Studio |
| Backend | `npm run dev` | tsx watch on `src/server.ts` (port 5000) |
| Backend | `npm test` | vitest: creates and migrates `masti_crm_test`, wipes it before each test |
| Backend | `npm run typecheck` | Typechecks src, tests and seed (`tsconfig.check.json`) |
| Backend | `npm run build` / `npm start` | `tsc` → `dist/`, then `node dist/src/server.js` |
| Frontend | `npm run dev` | Vite (port 5173), proxies `/api` to the backend |
| Frontend | `npm run build` | `tsc -b && vite build` |
| Frontend | `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |

**Environment variables:**

| Where | Variable | Notes |
|---|---|---|
| `Backend/.env` | `DATABASE_URL` | Required |
| `Backend/.env` | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Local docker-compose DB; must match `DATABASE_URL` |
| `Backend/.env` | `PORT` (5000), `CLIENT_URL` (CORS list), `NODE_ENV` | |
| `Backend/.env` | `TRUST_PROXY` | `false` by default; set it behind nginx so `req.ip` is real |
| `Backend/.env` | `SESSION_IDLE_HOURS` (12), `SESSION_MAX_DAYS` (7) | Session expiry |
| `Backend/.env` | `TEMP_PASSWORD_SESSION_MINUTES` (15) | How long a temporary-password login has to set a new password before it must log in again |
| `Backend/.env` | `SEED_HEAD_NAME` / `SEED_HEAD_MOBILE` / `SEED_HEAD_EMAIL` / `SEED_HEAD_PASSWORD` | First Head user for `db:seed` |
| `Backend/.env.test` | `DATABASE_URL` | Must contain "test" in the database name (it is wiped) |
| Frontend | `VITE_API_URL` | Optional; defaults to `/api` |

**Conventions:**
- Backend features live in `src/modules/<feature>/`, mounted under `/api/...` in `app.ts`:
  - `<feature>.routes.ts` handles HTTP only: middleware, `schema.parse(req.body)`, call the service, send the response (and cookies). Express 5 async handlers, no controller layer.
  - `<feature>.service.ts` holds the business rules, every Prisma query and `$transaction`, and the `audit()` calls. It takes plain inputs (parsed body, ids, the acting user and IP), never `req`/`res`, and returns DTOs.
  - `<feature>.schemas.ts` holds the zod schemas and their inferred input types. It imports only `zod`, the generated enums (`generated/prisma/enums`) and other schema files, so it can later be shared with the frontend.
  - Shared infrastructure stays outside modules: `config/`, `lib/` (audit, httpError), `middleware/`, `types/`.
- The backend compiles to **CommonJS**, so relative imports stay extensionless.
- **Prisma 7:**
  - The datasource URL and the seed command live in `prisma.config.ts`.
  - The client is generated to `generated/prisma` and imported from `generated/prisma/client` (`../../../generated/prisma/client` inside a module; pure enums from `generated/prisma/enums`).
  - A driver adapter (`PrismaPg`) is required.
  - **Departments are rows, not enums**; keep masters as tables too.
- **Express 5** forwards rejected promises from async handlers to the error middleware, so just `throw`.
- **TypeScript is very strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Write code that satisfies it rather than loosening the config.
- **Frontend:**
  - Call the API only through `api()` in `src/lib/api.ts`. A 401 anywhere marks the user signed out (see `main.tsx`).
  - Use the CSS tokens in `src/styles/tokens.css`, never raw hex.
- **Dates:** stored as `timestamptz`; displayed in IST (`formatDateTime`).

**Not there yet:**
- **Backend:** a job scheduler, WhatsApp/SMS/email, PDF/sticker generation, masters screens, any business module beyond the client master.
- **Frontend:** the header search and New-enquiry button, the Today dashboard (placeholder only).
- **Project setup:** CI/CD and deploy scripts.

**Portability note:** production must run on Masti's own server or cloud. Keep plain PostgreSQL through `@prisma/adapter-pg`, and don't depend on hosted-only services (e.g. Prisma Accelerate or Prisma Postgres, or vendor-specific serverless platforms) unless Shivanshu and Masti agree. The Prisma "platform" skill in `Backend/.claude/skills/` describes such hosted products.

### 16.5 Implementation notes

> Suggestions only, **not decisions**. The project lead's decision records override them.

- **Money:** integer paise (or `Decimal`), never floats. Display with `Intl.NumberFormat('en-IN')`.
- **Time:** store timestamps as UTC `timestamptz`; display in IST (Asia/Kolkata), showing minutes.
- **Invoice immutability:** enforce it below the API too. No update routes, plus a DB trigger or revoked UPDATE/DELETE privileges on invoice tables. Corrections are credit notes or the additional invoice.
- **Masters as tables**, not Prisma enums, so admins can add values without a deploy. Keep stable IDs so reports survive renames.
- **Stage flows as data** per department. Phase-2 departments then slot in.
- **A durable, self-hostable job scheduler** for reminders, rotations, cycle days and check-in lists (e.g. pg-boss, or BullMQ + Redis).
- **Idempotent outbound messaging** with a message log, so retries never double-send to a client.
- **Vault:** encrypt credentials at rest with a key kept outside the DB. Never send a secret to the browser in readable form. Log every use.
- **Field app:** a mobile web view (PWA-style). Camera and geolocation need HTTPS.
- **Personal data:** the CRM holds sensitive personal data (passport numbers, DOBs, income, addresses). Use least-privilege access, HTTPS everywhere and encrypted backups, and check obligations under India's DPDP Act with Shivanshu.

---

## 17. Where the sources disagree

| # | Topic | What the sources say | Working assumption until confirmed |
|---|---|---|---|
| 1 | Pending-document reminder schedule | Client: the company sets the interval (e.g. 1, 2 or 3 days); no time of day mentioned. Demo: "every 2 days at 11:00". PID: "reminders every 2 days". | **Decided 8 Oct 2026:** an admin setting (interval, send time, channel), seeded with 2 days / 11:00. Masti can still tell us their preferred values (Q5). |
| 2 | Web check-in window | Written doc: 48 h. Meeting: Vimal said "48 hours", then settled on "give us the list 72 hours before" (8:16 PM). Demo and PID: 72 h. | Configurable, seeded with 72 h (the PID and Vimal's last word). Confirm in writing (Q21). |
| 3 | Visa decision granularity | Client: "status only: refused or approved". Demo and PID: per traveller. Handover guide: per-traveller is our assumption. | Build per traveller (the PID's wording). Confirm (Q11). |
| 4 | Hotel options per quote | Client: max 3–4 (5 tolerated). Demo and PID: up to 4. | Limit 4, configurable. |
| 5 | Hotel markup floor | Client: nice-to-have ("no big need right now"), by category or price range. PID: "minimum markup is set by star rating". Demo: 3★ 10%, 4★ 8%, 5★ 6%. | In scope (PID), by star rating. The values are samples (Q17). |
| 6 | Hotel competitor sites | Client: the company picks its competitors (e.g. 4; MakeMyTrip + 3). PID and demo: MakeMyTrip, Agoda, Booking.com + vendor. | A configurable list, seeded with the PID's three + vendor (Q18). |
| 7 | When the visa invoice is raised | Written doc: before couriering to the vendor. Meeting: at courier time, or earlier where fees are paid upfront (VFS). Demo: it must be locked before the docket leaves. | It must exist before dispatch; allow it earlier (Q6). |
| 8 | Visa intake fields | Written doc: "country, time, type, no. of pax". Meeting and demo: country, visa type, adults, children (+ mobile). | **Decided 8 Oct 2026:** "time" is the travel month/date, captured at intake. Intake = country, visa type, adults, children, travel month (+ optional exact date) + mobile. |
| 9 | Additional-invoice limit outside visa | Only stated for visa files (max 1) | Apply it to visa; ask before generalising. |
| 10 | Ticket fare changes vs locked invoices | The fare-change log shows "Add to invoice" | Bill through a new invoice or a credit note. Never edit an issued invoice. Confirm the mechanism. |
| 11 | Routine accounts tasks | Vimal: optional, can be dropped (it's in Excel). Demo and PID: included. | In scope, lowest priority, Stage 3. |
| 12 | Field-staff screen timing | The PID's module table lists it under Accounts (Stage 3); PID payment milestone 2 puts it in the Visa stage. | Stage 1: visa pickups and handovers need it. |
| 13 | PAN verification, Google Workspace login | The PID lists both under third-party running costs. Neither is in the demo; the handover says "probably not in scope". | Don't build until Shivanshu confirms (Q15, Q23). |
| 14 | Passport-scan autofill | Handover guide: not in the demo. But demo step 3 shows "Read passport scan" and "Fill from consent & trip details" buttons. | ❓ Confirm the scope with Shivanshu (Q13). |
| 15 | "White-label, IP-based" CRM login | Meeting: discussed. Demo: office-network-only is shown for portal logins only. | ❓ (Q14) |
| 16 | Holiday auto-send vs "AI is assistive" | Guide: AI fill-in should be assistive. Holiday demo and PID: the itinerary quote goes out automatically and staff take over when the client replies. | Holiday auto-send is intended (the client asked for it). Ask what already exists (Q16). |
| 17 | Name of the visa-news service | Written doc "IVF"; transcript "IBS"/"RIA"; handover "IVS" | Use "IVS". Confirm the provider (Q24). |
| 18 | Timeline | Meeting: "two months" mentioned. PID: go-live 1 Jan 2027 (buffer 15 Jan). | The PID wins. |
| 19 | Insurance premium examples | Meeting ₹1,000 / 1,200 / 1,500; written doc ₹100 / 200 / 500 | Examples only, not a rule. |
| 20 | Masti's office in the demo messages | The demo WhatsApp says "collect from our Vesu office"; Masti is in Varachha. | Demo wording. Vimal writes the real messages (Q8). |
| 21 | Case-number prefixes | The demo uses both `I-0577` and `IN-0561` for insurance | **Decided 8 Oct 2026:** `{prefix}-{YYYY}-{NNNN}`, e.g. `VISA-2026-0001`. The prefix is set per department (not hard-coded); the counter runs per department per calendar year. |
| 22 | Email as an enquiry source | Vimal: no email channel today, "maybe in future" (6:46 PM). Ticketing head: ticket queries come by WhatsApp and email (7:52 PM). Demo: Email is a source option. | **Decided 8 Oct 2026:** no automatic email capture for now. Email stays a source staff can pick. Later, enquiries also arrive automatically from a WhatsApp bot and website forms, so intake is built to accept them. |
| 23 | Rate check for predefined hotels | Vimal: "comparison doesn't come in" for the 10–20 predefined hotels where Masti is "master" (7:30 PM). PID and demo: a rate check before any quote. | Build the check for every quote. Add a per-hotel exemption only if the client confirms it (Q31). |
| 24 | Galileo GDS | Vimal showed a quote from "our Galileo" (8:03 PM); the ticketing head said "GDS nahi hai" ("there's no GDS"). | Unclear (Q32). It affects how fares get into the quote: typed in, parsed from screenshots, or taken from GDS output. |
| 25 | Vimal's stated purposes | Mid-meeting: "loss tracking and automation" (8:18 PM). At the close: "lead generation and automation" (8:50 PM). | Loss tracking + automation. Capturing every lead is part of that. |
| 26 | "Quote variance of ₹10k–50k 'not a big deal'" (in `02` §4, with no context) | Transcript: Vimal meant Acceleret's project price moving by ₹10–50k, a one-time cost, which matters less to him than having no space to grow (8:47 PM). | Not a product rule. Ignore it when building. |

---

## 18. Open questions

`Masti-CRM-Handover/05_Open_Questions.md` is the live decision log. Record answers there, with the date and who answered, and reflect them here. A ready-to-send version of every question, split by who to ask and by stage, is in [QUESTIONS_TO_ASK.md](QUESTIONS_TO_ASK.md).

**Who:**
- **C:** client (Vimal or his team)
- **S:** Shivanshu
- **Y:** the project lead recommends, Shivanshu approves

**Blocks** is the stage the question holds up (1 = Visa, 2 = Departments, 3 = Final).

**Already settled since the meeting:**
- timeline (1 Jan 2027, buffer 15 Jan)
- no resale (exclusivity)
- Masti owns the code at completion
- hosting on Masti's own cloud
- routine accounts tasks are in scope but low priority (Stage 3)

**Answered 8 Oct 2026 (project lead), for Visa Step 1.** Details are in §10, §12.3 and §17; the design is `docs/decisions/0003-visa-intake.md`.
- **Q2:** visa follow-up is done by the Visa employee assigned to the case (⚠️ confirm with Vimal: it differs from the meeting and the demo).
- **Q5:** the reminder schedule is an admin setting, seeded with every 2 days at 11:00.
- **Q8:** placeholder wording in the build; the real text is decided later and approved by the client. Still needed from Masti.
- **Q29:** old clients come as an Excel file; an import job is built later.
- **§17 #8, #21, #22:** travel month at intake; case numbers `VISA-2026-0001`; no automatic email capture.
- **AI fill-in from a message:** deferred; the manual form comes first.

**Decided 8 Oct 2026 (project lead), for the client master.** Details are in §10.1; the design is `docs/decisions/0004-client-master.md`.
- The client master is built **before** the System Masters (embassy holidays, rules, vendors, dropdown admin screens), which are on hold.
- Clients get extra mobile numbers, a GSTIN and a PAN (typed, not verified). "Complete before invoicing" is a setting, not code.
- Duplicate passport numbers, PANs, GSTINs and extra numbers are warnings staff confirm, not errors.
- The client document vault is **not built** (Q37). Aadhaar numbers are not stored.

| # | Question | Who | Blocks |
|---|---|---|---|
| 1 | Docket grouping: one docket per file, or one per vendor per day? One vendor email per docket, or one per day? | Y→C | 1 |
| 2 | ~~Follow-up team split~~ **Answered 8 Oct:** the assigned Visa employee follows up (confirm with Vimal) | C | 1 |
| 3 | Collection boy's device: phone or tablet; web app or WhatsApp-only jobs? | Y→C | 1 |
| 4 | Click-to-login: how it works, which portals it supports | Y | 1 |
| 5 | ~~Reminder schedule~~ **Answered 8 Oct:** an admin setting, seeded 2 days / 11:00 | C | 1 |
| 6 | Visa invoice trigger: at courier time, or earlier when fees are paid upfront (VFS)? | C | 1 |
| 7 | Vendor onboarding format for visa submission agents | C | 1 |
| 8 | WhatsApp message step list and wording (urgent: Meta approval). **8 Oct:** placeholder text until then; still needed | C | 1 |
| 9 | Consent wording (passport-transit risk, booking-before-visa risk) | C | 1 |
| 10 | Covering-letter formats (which processes and family types); the "100 subscription" remark | C | 1 |
| 11 | Decision per traveller or per case? | C | 1 |
| 12 | Handover OTP/photo flow: confirm the steps shown in the field app | C | 1 |
| 13 | Visa form autofill from a passport MRZ scan: in scope? | S | 1 |
| 14 | "White-label / IP-based" CRM login: office IPs; everyone or only some roles? | C | 1 |
| 15 | Google Workspace login through the CRM (one switch-off kills all access): feasible? in scope? | S/Y | 1 |
| 16 | Holiday AI quote: what was built or discussed earlier, and what changes? | S | 2 |
| 17 | Hotel markup floors: the real values; needed now or later? | C | 2 |
| 18 | Which competitor sites are mandatory in the hotel rate check | C | 2 |
| 19 | Insurance product data: entered by hand or fetched? Which insurers? | C | 2 |
| 20 | Ticket quote input: fare families by hand vs AI from screenshots; bookability; full fare rules in the first quote? | C/Y | 2 |
| 21 | Web check-in window: 48 h or 72 h? | C | 2 |
| 22 | Ticket copy delivery "via link" | C | 2 |
| 23 | PAN verification: in scope? Provider? Which modules? | S | 2 |
| 24 | IVS visa news feed: subscription, cost, how we get the data | C | 3 |
| 25 | Notice-board auto-alerts and weather: sources; in or out? | S/C | 3 |
| 26 | Accounting software: its name; export file now or in phase 2? | C | 3 |
| 27 | Reports: what goes into the Visa, Staff workload, Outstanding and Cross-sell tabs | C | 3 |
| 28 | Dashboards per role (Staff / HOD / Head) | C | 3 |
| 29 | ~~Existing data to import~~ **Answered 8 Oct:** Excel file; import job built later | C | 1 |
| 30 | Notification of the 3rd follow-up: the permission flow, and who approves | C | 3 |
| 31 | Can office staff (e.g. Accounts) cover the collection run, using the same phone screen? The data model allows it; today `/tasks` is field staff only. | C | 1 |
| 31 | **New:** Does the hotel rate check apply to staff's predefined hotels, where Masti is "master"? | C | 2 |
| 32 | **New:** Does the ticket desk use the Galileo GDS? (It affects how fares get into the quote.) | C | 2 |
| 33 | **New:** Which client details must be on file before an invoice, for individuals and for companies? Is an accounting code needed for every client? Seeded ⚠️: individuals need name, address, city, state; companies also need a contact person and GSTIN (`clients.invoiceReadiness`). | C | 1 |
| 34 | **New:** Only Accounts (and the Head) may set the accounting code, billing cycle and payment habit. Is that right, or may each department set them when it creates a client? Built Accounts-only. | Y→C | 1 |
| 35 | **New:** How long before expiry should a passport show "renew soon"? Seeded 12 months ⚠️ (matches the demo). | C | 1 |
| 36 | **New:** The payment-habit options. Only "Part advance, rest on delivery" comes from the demo; seeded with Full advance / Part advance, rest on delivery / On delivery / On credit. | C | 1 |
| 37 | **New:** A client document vault (passport, PAN and photo scans kept per person and reused on later cases): in scope, or a change request? It isn't in the demo and wasn't asked for. Not built. If built: Drive/OneDrive links, not uploads. | S | 2 |

Q31 and Q32 come from the transcript review. They aren't in `05_Open_Questions.md` yet; add them there when you next update the decision log. Q33–Q37 (client master, 8 Oct) are in `05_Open_Questions.md`.

---

## 19. What we need from Masti

Source: `07_Client_Inputs_Checklist_TEMPLATE.md`, a draft the project lead finalises. The rule: if Masti already has an account or API, they give us access; if it has to be applied for fresh, **we** apply, and the running cost goes on the cost sheet.

**Most urgent (week 1):**
- **A3:** the WhatsApp Business number, Meta Business Manager access, and business verification documents
- **C2:** the WhatsApp message step list and wording

Both have Meta lead times.

**A. Accounts, access and APIs:**

| # | Item | Needed by |
|---|---|---|
| A1 | Cloud/server account with a user for us | Stage 1 |
| A2 | Domain/sub-domain and DNS | Stage 1 |
| A3 | WhatsApp Business (see above) | Urgent |
| A4 | Google Workspace admin contact and a CRM Google account (Drive storage, email) | Stage 1 |
| A5 | Drive/OneDrive folder structure and owner | Stage 1 |
| A6 | Email/SMTP | Stage 1 |
| A7 | SMS/OTP provider and DLT registration | Stage 1 |
| A8 | Visa portal accounts, with rotation frequency per portal | Stage 1 |
| A9 | Airline and booking-platform accounts | Stage 2 |
| A10 | IVS subscription | Stage 3 |
| A11 | PAN provider, if in scope | Confirm scope first |
| A12 | Office internet IP address(es) | Stage 1 |
| A13 | Existing tools to connect (website chat, lead forms, Justdial, Instagram/Facebook) | Stage 1 |

**B. Data and masters:**

| # | Item | Needed by |
|---|---|---|
| B1 | Country × visa-type checklists (original/xerox flags, child alternatives) and price breakups | Stage 1 |
| B2 | Embassy holiday calendar, and who keeps it updated | Stage 1 |
| B3 | Approved visa vendors (onboarding details) and courier details | Stage 1 |
| B4 | All dropdown values | Stage 1 |
| B5 | Staff list (name, department, role, mobile, email) | Stage 1 |
| B6 | Existing client data, with accounting codes and billing cycles | Stage 1 |
| B7 | Holiday rate sheets | Stage 2 |
| B8 | Hotel competitor list, markup floors, hotel vendors, staff's predefined hotels | Stage 2 |
| B9 | Insurers and plans; claim types and their document lists | Stage 2 |
| B10 | Airline fare families | Stage 2 |
| B11 | Routine accounts task list (frequency, owner) | Stage 3 |

**C. Formats, branding and wording:**

| # | Item | Needed by |
|---|---|---|
| C1 | Logo, brand colours, letterhead | Stage 1 |
| C2 | WhatsApp wording (see above) | Urgent |
| C3 | Consent wording | Stage 1 |
| C4 | Covering-letter formats | Stage 1 |
| C5 | Invoice and credit-note format, with GST details | Stage 1 |
| C6 | Quotation formats (holiday, hotel, insurance, ticket) | Stage 2 |
| C7 | Hotel voucher design and non-refundable consent wording | Stage 2 |
| C8 | Accounting software name and import/export format | Stage 3 |

**D. Decisions:**

| # | Decision | Needed by |
|---|---|---|
| D1 | Follow-up team structure | Stage 1 |
| D2 | Reminder interval and timing | Stage 1 |
| D3 | Visa invoice trigger | Stage 1 |
| D4 | Collection boy's device | Stage 1 |
| D5 | Web check-in window | Stage 2 |
| D6 | One decision-making contact at Masti, plus a contact per department | Week 1 |

---

## 20. Discussed in the meeting but not in the demo

These are probably **not in scope**, but the client may assume they are. Discuss each with Shivanshu before building or promising anything.

- **PAN verification:** fetch details from a PAN, like EasyLife/TBO. Listed in the PID's third-party costs. In the meeting Vimal raised it as "an example" of a worthwhile paid feature: "whether you put it in our system or not is a separate matter" *(transcript, 7:38 PM)*.
- **Google Workspace / Gmail access through the CRM**, so that one switch-off kills all of a leaver's access. Also listed in the PID's third-party costs.
- **"White-label, IP-based" CRM login.** The demo only shows office-network-only for *portal* logins.
- **Visa form autofill from a passport MRZ scan**, "if technology allows". The demo does show "Read passport scan" buttons (§17 #14).
- **An export file for the accounting software.** The client said phase 2 is fine.
- **Insurance reports by policy type**, only implied in Reports.
- **A small calculator.**
- **Client self-upload of documents:** explicitly *disallowed*.
- **Call recording / IVR:** never mentioned by the client. The PID lists a "mobile app for calling" as a later phase.

---

## 21. Glossary

| Term | Meaning in this project |
|---|---|
| **Acceleret** | Us: the software firm building the CRM (Surat). Tagline "Build › Automate › Accelerate". |
| **Masti** | The client, Masti Tours & Travels |
| **PID** | Project Initiation Document: the contract (ACC/MTT/PID/2026-01) |
| **Head** | The top role (Vimal): everything |
| **HOD** | Head of Department: a department lead with override powers |
| **Query / enquiry / lead** | A client request. "Lead" is used for cross-sell and insurance. |
| **Follow-up desk / follow-up pool** | Staff who chase clients until a case matures |
| **Processing / processor** | Visa staff who prepare the file after maturity |
| **Matured / maturing query** | A visa case whose documents are complete. It's handed to processing. |
| **Postpone / cancel / lost** | Enquiry outcomes, always with a dropdown reason |
| **Original / Xerox** | Whether a document came in as the original or as a photocopy |
| **Arranged by us** | Checklist items Masti produces: flight reservation, hotel bookings, insurance |
| **Booklet** | A passport booklet. Clients hand in current + old passports ("4 current + 3 old"); booklets are counted at intake and at handover. |
| **Consent (form)** | The one-time liability/authorisation per person, accepted by tapping "I agree" |
| **Covering letter** | A fixed-format letter to the embassy, printed on the customer's letterhead |
| **Vendor / submission agent** | An approved third party (e.g. in Mumbai or Delhi) that submits files at the embassy/VFS and collects passports |
| **Docket** | A courier consignment to a vendor (one file or several). Also used for the courier tracking number. |
| **Sticker** | (1) The parcel label printed for a docket. (2) The visa sticker (foil) placed in an approved passport. |
| **File number / application number** | The number the vendor gives after submission (e.g. FR-MUM-88421) |
| **Acknowledgement number** | The portal's application reference, typed in during file preparation |
| **Collection date** | (Visa) the expected date to collect the decision and passport from the embassy. Mandatory; skips embassy holidays. |
| **Collection boy / delivery boy** | Field staff who pick up documents, deliver passports and collect payments |
| **Recall** | Taking a file back from the vendor before submission. Produces a credit note. |
| **Credit note** | A document that reduces what a client owes (e.g. the recall refund = embassy fee only) |
| **Additional invoice** | The single extra invoice allowed per visa file (e.g. urgent fee, photos) |
| **Debit** | An invoice raised, i.e. an amount the client owes. Accounts sees it at once. |
| **Outstanding** | Unpaid receivables (about ₹1.75 Cr today) |
| **Billing cycle** | Weekly / half-monthly / monthly invoicing day for a customer (default monthly) |
| **Cycle vs routine customer** | Cycle customers (often corporates) surface on their bill day. Routine customers get at most 2 follow-ups before escalation. |
| **Call after sending** | The compulsory phone call after an invoice is sent |
| **Cross-sell (lead)** | A lead auto-created in other departments when one department invoices |
| **Rate check / market rate** | Competitor prices (MakeMyTrip etc.) entered before a hotel quote |
| **Markup floor / minimum markup** | The lowest markup % allowed (by star rating) |
| **Block vs book** | A hotel hold with a time limit vs a confirmed booking |
| **Voucher** | The hotel booking confirmation, in Masti's design |
| **Go-ahead** | The client's acceptance of a hotel option and its terms |
| **Fare family** | An airline's fare variants (e.g. Saver / Flex / Flex Plus). Their rules are fixed per airline. |
| **Web check-in list** | Upcoming flights (in the 72 h or 48 h window) where staff do or confirm check-in |
| **PNR** | Airline booking reference |
| **Fare change log** | Changes after booking, billed or credited to the client |
| **Auto-assigned seat** | The airline assigned a seat at check-in, so offer the client a paid seat |
| **Claim** | An insurance claim (lost bag, lost passport, medical, baggage delay…) |
| **UTR** | Bank transfer reference (the insurer's payout) |
| **IVS** | Paid visa-news platform that feeds the notice board (also written "IVF"/"IBS") |
| **VFS** | Visa application centre operator. "VFS fee" is a price-breakup line. |
| **MRZ** | Machine-readable zone on a passport (for autofill) |
| **ITR** | Income Tax Return, a common visa document |
| **NOC** | No-objection certificate (leave letter; parents' NOC for minors) |
| **GSTR-1 / 3B / 2B, TDS, advance tax** | Indian tax filings in Accounts' routine tasks |
| **AMC** | Annual maintenance contract, after the 6 months of free support |
| **BSP** | WhatsApp Business Solution Provider |
| **DLT** | India's SMS sender and template registration |
| **Masters** | The admin-editable lists and rules that drive the system |
| **MIS** | Masti's own management-information dashboard (Excel/Google Sheets), built because nothing else fit. If the CRM works, Vimal won't need it *(transcript, 8:50 PM)*. |
| **Notice board / login popup** | Department news / important visa updates shown once per login |
| **Lakh / crore** | 1 lakh = ₹1,00,000; 1 crore = ₹1,00,00,000 |
| **"ji"** | Respectful suffix used in client messages ("Rakesh ji") |

**Ambiguous words to watch:**

| Word | Meanings |
|---|---|
| **collection** | (a) visa decision/passport collection at the embassy; (b) the collection boy's pickups; (c) payment collection |
| **sticker** | the parcel label vs the visa sticker |
| **holiday** | the Holidays department (packages) vs embassy holidays / the holiday calendar |
| **docket** | the consignment vs the courier number |
| **Head** | the top role vs HOD |

Clients also write in mixed Hindi, Gujarati and English, so the AI parsing must cope with that.

---

## 22. File map, screenshots and the demo

**Handover pack** (`Masti-CRM-Handover/`):

```
00_START_HERE.md                    overview, reading order, three key reminders
01_Project_Brief.md                 client, goals, commitments, stages, people
02_Requirements_from_Meeting.md     everything the client said, by module (most detailed source)
03_Demo_Screens_Guide.md            screen by screen: confirmed (✅) vs sample (⚠️)
04_Engineering_Constraints.md       hard constraints, risks, decisions that are ours
05_Open_Questions.md                the live decision log (30 questions)
06_First_Week_Plan.md               day-by-day plan for week 1
07_Client_Inputs_Checklist_TEMPLATE.md  draft list of what we need from Masti
08_Ways_of_Working.md               reporting, client group, change requests
references/
  Project_Initiation_Document_Masti_Travels_CRM.pdf   the contract
  client-files/Masti_Travels_requirements.docx        client's own notes (Hinglish)
  client-files/Meeting_transcript_30-Sep-2026.docx    raw ~2 h machine transcript
  demo/masti-crm-demo.html                            offline clickable demo (open in Chrome)
  demo/screens/01…30-*.png                            one screenshot per screen/state
```

**Screenshots** (`references/demo/screens/`):

| File | Shows |
|---|---|
| 01-today.png | Today home screen |
| 02-enquiries-all.png | All-department enquiry list |
| 03-enquiries-row-open.png | Enquiry row with the department-steps side panel |
| 04-enquiries-visa-board.png | Visa kanban board + visa-team login popup |
| 05-new-enquiry.png | New enquiry with fill-from-message |
| 06…13-visa-case-step1…8 | The 8 visa steps (enquiry, documents, file prep, dispatch, at vendor, decision, passport back, delivered) |
| 14-field-staff-app.png | Collection/delivery boy's phone view |
| 15-holidays.png | AI holiday itinerary and quote |
| 16-hotels.png | Hotel rate check, options, terms, booking |
| 17-insurance.png | Insurance plans side by side and renewals |
| 18-insurance-claim.png | Claim tracking |
| 19-tickets-checkin.png | Web check-in list and fare-change log |
| 20-ticket-quote.png | Fare-options quote |
| 21-follow-ups.png | Follow-up desk |
| 22-cross-sell.png | Cross-sell leads |
| 23-clients.png | Client profile |
| 24-accounts-invoices.png | Invoices and payment follow-up |
| 25-accounts-tasks.png | Routine tasks and the collection run |
| 26-reports.png | Lost-business report |
| 27-notice-board.png | Notice board, weather, IVS |
| 28-settings-portal-logins.png | Credential vault |
| 29-settings-masters.png | Masters and holiday calendar |
| 30-client-whatsapp.png | The client's WhatsApp messages |

**Using the demo:**
- Open `references/demo/masti-crm-demo.html` in Chrome; no internet is needed.
- **Walk me through** (top right) runs a 7-step tour:
  1. Every day starts on Today
  2. A WhatsApp query becomes an enquiry
  3. Every enquiry in one list
  4. Inside a visa case
  5. A hotel quote with a safe margin
  6. Every invoice gets chased
  7. The client hears at every step
- **URL parameters set the demo's state directly**, which is handy for screenshots and comparisons:
  - `?view=` one of `today, enq, notice, follow, client, newEnq, visaCase, holiday, hotel, insurance, claim, tickets, tquote, invoices, tasks, cross, portals, masters, reports, field`
  - `&step=1…8` for the visa case
  - `&dept=Visa&mode=board` for the visa board
  - `?tour=0…6` to start the tour at a step
  - `?phone=1` to show the client's WhatsApp
