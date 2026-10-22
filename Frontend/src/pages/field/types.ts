// The collection and delivery boy's phone screens (docs/decisions/0015-field-staff-app.md), as /api/field returns them.

import type { MessageStatus } from '../enquiries/types'

export type FieldJobKind = 'PICKUP' | 'DELIVERY'
export type FieldJobStatus = 'BOOKED' | 'DONE' | 'FAILED' | 'CANCELLED'

/** One stop on his run, with just what it needs. */
export interface RunStop {
  id: string
  kind: FieldJobKind
  status: FieldJobStatus
  /** The desk that raised it ("VISA"), for the chip's colour. */
  department: string
  day: string
  slot: { name: string; startsAt: string; endsAt: string }
  caseNo: string
  client: { name: string }
  address: string
  /** The Google Maps link the office pasted, if any. */
  mapLink: string | null
  /** Whom his Call button rings. */
  mobile: string
  /** A delivery: the booklets in our stock he hands over. */
  booklets: { current: number; old: number } | null
  /** A pickup: the papers still pending on the case's checklist, traveller by traveller. */
  pending: { document: string; traveller: string }[]
  /** A delivery: the travellers, to pick who receives (names only). */
  /** Who may receive the passports at a delivery; a child is marked. */
  travellers: { id: string; name: string; isChild: boolean }[]
  /** When he recorded it done or couldn't complete (phase 4), and why it couldn't be. */
  finishedAt: string | null
  failReason: string | null
}

/** His run for a day: the stops (cancelled ones last) and how many of the others are finished. */
export interface MyRun {
  day: string
  /** Today in India, by the server's clock. */
  today: string
  jobs: RunStop[]
  done: number
  total: number
}

/** Where the client's one-time code stands (0015 Decision 4); none until one is sent. */
export interface OtpState {
  /** The client's WhatsApp number it went to, masked: "+91••••••1299". */
  sentTo: string
  sentAt: string
  expiresAt: string
  /** When he may send another. */
  resendAt: string
  confirmedAt: string | null
  /** Where its WhatsApp has got to, and why when it couldn't go (decided 22 Oct 2026). */
  message: { status: MessageStatus; error: string | null } | null
}

/** One of his stops, where its code stands, and today by the server's clock: he records a stop only on its day. */
export interface MyStop {
  stop: RunStop
  otp: OtpState | null
  today: string
}

/** A reason a visit fails (0015 Decision 5), as his phone offers it. */
export interface FailReason {
  id: number
  name: string
}
