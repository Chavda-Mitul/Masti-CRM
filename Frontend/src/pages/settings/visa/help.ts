import type { VisaTimingsFormValues } from '../masters/schemas'

/** One ⓘ box: a heading and a sentence or two per line. */
export type HelpLines = [heading: string, text: string][]

/**
 * What each Settings → Visa value is for, in plain words, behind its ⓘ (decided 21 Oct 2026). Each example names the
 * values it uses (the starting ones), since the page's own values can be changed.
 */
export const VISA_SETTINGS_HELP: Record<keyof VisaTimingsFormValues | 'timings', HelpLines> = {
  timings: [
    [
      'What these are',
      'Reminders for our staff, not messages to the client. After each step of a visa case, the case comes back to the person handling it, so the next job isn’t forgotten.',
    ],
    ['Who sees them', 'The person handling the case at that step. The HOD sees the whole department; the Head sees everything.'],
    ['Where', 'On Today (Due today, Running late, Up next), in the Enquiries list, and on the case. Before the papers are complete, also on Follow-ups.'],
    ['Office days', 'Sundays and office holidays are skipped. 1 means the next day the office is open.'],
    ['Changing a value', 'It counts for the next case that reaches that step. Cases already waiting keep their time.'],
  ],
  firstFollowUp: [
    ['What it’s for', 'After a new enquiry is saved, a reminder to call the client and start collecting their papers.'],
    ['Example (1 day · 11:00 AM)', 'Enquiry saved on Saturday → reminder on Monday at 11:00 AM (Sunday is skipped).'],
  ],
  assignCheck: [
    ['What it’s for', 'When all the papers are in, the case waits for the Visa HOD to choose who will prepare the visa file. This reminds the HOD to choose.'],
    ['Where', 'The HOD’s Today page and the To assign list.'],
    ['Example (1 day · 11:00 AM)', 'Papers complete on Tuesday → reminder on Wednesday at 11:00 AM.'],
  ],
  vendorConfirm: [
    ['What it’s for', 'We send the file to the vendor (the agency that takes it to the embassy). This reminds us to check that the vendor got it.'],
    ['Example (1 day · 11:00 AM)', 'Sent on Monday → check on Tuesday at 11:00 AM.'],
  ],
  onlineCheck: [
    ['What it’s for', 'An e-visa is applied for on the government website, with no vendor. This reminds us to look on the website for the result.'],
    ['Example (1 day · 11:00 AM)', 'Applied on Monday → look on Tuesday at 11:00 AM.'],
  ],
  submissionCheck: [
    ['What it’s for', 'After the vendor gets the file, they submit it at the embassy and give us a file number. This reminds us to ask them for it.'],
    ['Good to know', 'If the client has an embassy appointment coming up, the reminder comes on that day instead.'],
    ['Example (1 day · 11:00 AM)', 'Vendor got it on Monday → ask on Tuesday at 11:00 AM.'],
  ],
  recallReturn: [
    ['What it’s for', 'Sometimes we take a file back from the vendor, for example when the client cancels. This reminds us to get the passports and papers back from them.'],
    ['Example (1 day · 11:00 AM)', 'Taken back on Wednesday → follow up on Thursday at 11:00 AM.'],
  ],
  passportsBackCheck: [
    ['What it’s for', 'After the embassy’s answer (visa given or refused), this reminds us to check the passports are being sent back to us.'],
    ['Example (1 day · 11:00 AM)', 'Answer saved on Monday → check on Tuesday at 11:00 AM.'],
  ],
  arrivalCheck: [
    ['What it’s for', 'When the passports are on their way, we note the day they should reach our office. This reminds us to check they arrived.'],
    ['Good to know', '0 means that same day; 1 means the next office day.'],
    ['Example (0 days · 11:00 AM)', 'Expected on Thursday → check on Thursday at 11:00 AM.'],
  ],
  handoverCheck: [
    ['What it’s for', 'Once the passports are at our office, this reminds us to give them back to the client: the client comes to collect, or the delivery boy takes them.'],
    ['Example (1 day · 11:00 AM)', 'Received on Tuesday → arrange it on Wednesday at 11:00 AM.'],
  ],
  collectionCheck: [
    ['What it’s for', 'The vendor tells us the day the passports can be collected from the embassy. This reminds us to check with the vendor before that day.'],
    ['Good to know', 'This one counts backwards: office days before the collection day.'],
    ['Example (1 day · 11:00 AM)', 'Collection on Friday → check on Thursday at 11:00 AM.'],
  ],
  passportValidity: [
    ['What it’s for', 'Most embassies refuse a passport that runs out soon after the trip. Staff get a warning, so the client can renew it in time.'],
    ['When it checks', 'When a traveller is added, when the return date changes, and again when the file is marked ready.'],
    ['Example (6 months)', 'Trip ends on 10 Jan → a passport ending before 10 Jul gets a warning.'],
  ],
  childAge: [
    ['What it’s for', 'Adults and children need different papers. If someone is added in the wrong place (an adult as a child, or a child as an adult), staff get a warning.'],
    ['Good to know', 'Age is counted on the travel date (today if there isn’t one yet). With no birth date saved, it isn’t checked.'],
    ['Example (18 years)', 'A 19-year-old added as a child gets a warning.'],
  ],
}
