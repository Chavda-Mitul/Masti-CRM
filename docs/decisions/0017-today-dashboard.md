# 0017 · The Today dashboard

- **Status:** decided (19 Oct 2026, project lead). Being built one component at a time (Decision 7). Built: the banner
  and the four tiles (19 Oct 2026, component 1); Up next (19 Oct 2026, component 2); open enquiries by department and
  the "Comes with …" cards (19 Oct 2026, component 3).
- **Date:** 19 Oct 2026
- **Scope:** everyone's home page, `/` (demo screen 01, PROJECT_KNOWLEDGE.md §12.1):
  - the banner: the date, the greeting and the day's sentence
  - four tiles: Due today, Running late, New enquiries, Cross-sell to answer
  - Up next, open enquiries by department, business lost this month, money to collect
  - the notice board (its card here and its own page) and the visa team's login popup
- **Builds on:**
  - [0002](0002-user-types.md): field staff have their run on `/tasks`, not Today
  - [0003](0003-visa-intake.md): every case has one due time (`dueAt`) and a next step
  - [0005](0005-system-masters.md): office days (`previousOpenDay`) and the holiday calendar
  - [0006](0006-visa-documents.md): who sees which enquiry (Decision 1, amended), the follow-up desk and its badge
    (Decision 9), postpone and cancel with fixed reasons (Decision 6)

## Context

| Source | What it says |
| --- | --- |
| PID, the Today module | "Daily home screen per person: due, running late, open enquiries by department, money to collect, business lost, notice board (embassy holidays, airline/hotel updates, visa news)". Due in Stage 1. |
| Demo screen 01 | The banner ("Monday, 5 October", "Good morning, Vimal", "8 enquiries need someone today and 2 are running late. Start with the late ones."), four tiles, Up next, open enquiries by department, the notice board (latest 3), business lost this month, money to collect. Shown as Vimal, with every department. |
| The demo's code | Computes only the sentence's two numbers, three of the tiles, Up next and the bar widths; the rest is fixed text, including "since yesterday evening" and "oldest: 2 days". No role differences. |
| Vimal, 30 Sep meeting | Lost business and its reasons is the headline; outstanding money; third follow-ups on his dashboard; "my dashboard the way I want" (Q28). |
| The code, 19 Oct 2026 | Only Visa has cases. No cross-sell, no payments or invoice follow-ups, no "Lost" in use (cases are cancelled, with a reason), no notices. |

## Decision

### 1. Whose cases: staff their own, an HOD the department, the Head everything

**Decided 19 Oct 2026 (project lead):** the Follow-ups badge's rule (decided 10 Oct 2026), applied department by
department:
- the Head counts every department;
- an HOD counts the whole of each department they lead, cases waiting for a processor included;
- anywhere else, only the cases the person owns.

So view-only staff, who own no cases, see an empty day, as their badge does, and a department an HOD can only view
doesn't count. The Due today tile says whose: "across all departments" (the Head), "in Visa" (an HOD), "your cases".

Per-role dashboards (Q28 / M32) stay open with Vimal; this is our answer until he gives his.

### 2. Due today and running late

- **A case someone has to act on:** it has a due time and is open, postponed (due again on its resume day), or
  cancelled with its passports still to hand back (0006 amendment 15). Closed cases have no due time (a database
  check), and plain cancelled ones have none either.
- **Every step counts,** not just follow-ups: unlike the follow-up desk, a matured visa case's processing is due too.
- **Running late:** due before now. The small line gives the oldest: "oldest: 2 days", "oldest: yesterday",
  "oldest: today, 11:00 am" or "nothing late".
- **Due today:** due from now until midnight tonight, India time. The late ones are counted apart, as in the demo's
  "8 … and 2 …".
- **The sentence:** "8 enquiries need someone today and 2 are running late. Start with the late ones.", with the
  singulars ("1 enquiry needs…", "1 is running late. Start with the late one.") and "Nothing is running late.",
  "Nothing new is due today, but 2 are running late…" and "Nothing is due today and nothing is running late."
- **Rechecked every minute,** so a case turns late without a reload.
- **Due today and Running late lead to Up next** (Decision 9), not to the whole Enquiries list as the demo's do: the
  list's Open tab leaves postponed cases out, so its numbers wouldn't match.

### 3. New enquiries: since the previous office day's evening ⚠️

- **Every enquiry created since 18:00 ⚠️ on the previous office day,** whatever its status now: it counts what came in.
  Sundays and office holidays are skipped (`previousOpenDay`), so on a Monday it counts from Saturday evening.
- **The time is a setting** (`today`, `{ newSinceAt: "18:00" }`, golden rule 1), seeded with our guess at the demo's
  "since yesterday evening". The Head changes it in Settings → Masters & holiday calendar → **Today page**; everyone
  else sees it there.
- The small line reads "since yesterday, 6:00 pm", or "since Sat, 6:00 pm" after a Sunday.
- **Not a link:** the Enquiries list has no "new since" filter (the demo's tile opened the New enquiry form).

### 4. Cards with nothing to count yet say what they wait for

**Decided 19 Oct 2026 (project lead):** they keep the demo's layout and say what brings them, like the client page's
"Still to pay · Comes with Accounts":
- **Cross-sell to answer:** "—", "Comes with cross-sell" (Stage 3)
- **Money to collect:** a "—" and "Comes with Accounts: payments, the outstanding amount and invoice follow-ups"
  (Stage 3)
- **Business lost this month:** the demo's four small tiles (Queries in, Booked, Lost, Still open) showing "—", and
  "Comes with marking enquiries lost" where the top three reasons go (Decision 5). No "Open report" link until Reports.

### 5. Business lost waits for "mark as Lost"

**Decided 19 Oct 2026 (project lead):** cancelled cases are not counted as lost. Cancelled and Lost stay separate
statuses (0006: the reason list gets LOST when losing is built), and what counts as "Booked" isn't defined yet. The card
says it comes with marking enquiries lost; its numbers come from that.

### 6. The notice board and the visa team's login popup are built now

**Decided 19 Oct 2026 (project lead):** the PID puts the notice board inside Today (Stage 1), so it's built after the
cards, and the login popup after it. Each is planned when its turn comes. Weather and IVS news stay out until Q24 and
Q25 are answered.

### 7. Build order: one component at a time

Each component is planned, built, tested, checked in the browser and committed before the next starts:
1. **The banner and the four tiles** (19 Oct 2026, built)
2. **Up next** (19 Oct 2026, built; Decision 9)
3. **Open enquiries by department,** with the "Comes with …" cards (business lost, money to collect) (19 Oct 2026,
   built; Decision 10)
4. **The notice board**
5. **The visa team's login popup**

### 8. "Change password" moves to the sidebar

The placeholder page held office staff's only link to change their password. It moves under the user card, beside Log
out (field staff keep theirs on `/tasks`). The placeholder's "Your access" card goes: the user card shows the role, and
the Head has Settings → Staff & roles.

The Head's sidebar shows only Log out: their "Change password" is on their own row in Settings → Staff & roles, beside
Edit, where other rows have Reset password (project lead, 19 Oct 2026).

### 9. Up next

**Decided 19 Oct 2026 (project lead), with component 2:**
- **What it lists:** the cases behind Due today and Running late (Decisions 1–2): late or due before midnight, in the
  enquiries list's order (late first, then by time due). At most 200 come at once; past that the card says the rest are
  in All enquiries.
- **The first 7, then "Show all"** ("Show all 12" opens the rest in place). The demo stops at 7; this way nothing late
  stays hidden.
- **Each row, as in the demo:** when (late in red: "2 days late", "Yesterday", or the time for earlier today; later
  today in blue: "3:00 pm"), a bar in the department's colour, what to do, "client · case number · summary", the
  department chip, and the owner's initials on an HOD's or the Head's day (a staff member's rows are all their own).
- **What to do, in the lists' words:** the status note (postponed, cancelled with passports still to hand back,
  "Matured · assign a processor"), else the follow-up desk's "8 of 11 documents pending", else the case's next step.
  The desk and Up next share it (`whatFor`).
- **A row opens the All enquiries list** with that case picked and its steps panel open, as in the demo; a postponed
  case opens on the Postponed tab. The list loads on, up to 8 pages, until the case shows. The New enquiry form's
  "open the case I just saved" gained the same.

### 10. Open enquiries by department

**Decided 19 Oct 2026 (project lead), with component 3:**
- **A bar counts what the list's Open tab counts:** open cases, plus cancelled ones whose passports are still to hand
  back; postponed ones have their own tab. Whose cases follow Decision 1.
- **A row opens that department's list** on the Open tab; where the count is the person's own cases (a department they
  don't lead), with Only mine ticked, so the list shows the same number.
- **Every selling department the person can see is listed, at 0 until Stage 2 brings its cases,** as in the demo; any
  other department only when it has open cases (the list's chip rule). Each bar is sized against the largest.
- **The layout is the demo's two columns:** Up next and Business lost on the left; the bars, then (component 4) the
  notice board, then Money to collect in a 360 px column on the right. Below 1100 px they stack.

## Not in this record

- **The header search and the header's New enquiry button,** and the sidebar's department counts: their own items.
- **Per-role dashboards** (Q28): one page for everyone until Vimal answers.
- **The demo's unused ideas** (per-department cards, an attention list): not built.

## Still needed

- **M32 (Q28):** what staff, HODs and Vimal should see on the home screen. Decision 1 stands until then.
- **The 18:00 cut-off ⚠️:** Masti's own "evening".
