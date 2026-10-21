import { useState } from 'react'
import { istTime } from '../due'
import { useCaseMessages } from '../queries'
import type { CaseMessage, VisaCase } from '../types'
import { dayMonth } from './labels'

/**
 * "Sent to the client" (demo screen 06, 0021): every WhatsApp the CRM sent about this case, oldest first, with where it
 * has got to; a failed one says why. Clicking a message shows its words, exactly as sent. It checks again by itself
 * while a message is on its way.
 */
export function MessagesSection({ visaCase: c }: { visaCase: VisaCase }) {
  return (
    <div className="rail-section">
      <div className="lbl">Sent to the client</div>
      <Messages caseNo={c.caseNo} />
    </div>
  )
}

function Messages({ caseNo }: { caseNo: string }) {
  const messages = useCaseMessages(caseNo)
  if (messages.isPending) return <p className="muted small rail-note">Loading…</p>
  if (messages.isError) return <p className="muted small rail-note">Couldn't load the messages.</p>
  if (messages.data.length === 0) return <p className="muted small rail-note">Nothing sent yet.</p>
  return (
    <ul className="message-list">
      {messages.data.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
    </ul>
  )
}

function MessageRow({ message: m }: { message: CaseMessage }) {
  const [open, setOpen] = useState(false)
  const { word, tone } = statusOf(m)
  const at = m.sentAt ?? m.failedAt ?? m.createdAt
  return (
    <li className={`message-row message-${tone}`}>
      <button type="button" className="message-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className="message-dot" aria-hidden="true" />
        <span>
          <strong>{m.title}</strong>
          <span className="muted small">
            WhatsApp · {dayMonth(at)} · {istTime(new Date(at))} · {word}
            {m.toTestNumber && ' · to your test number'}
          </span>
        </span>
      </button>
      {m.status === 'FAILED' && m.error && <p className="message-error small">{m.error}</p>}
      {open && <p className="message-body">{m.body}</p>}
    </li>
  )
}

/** The word under the message, and its dot's colour. */
function statusOf(m: CaseMessage): { word: string; tone: 'ok' | 'wait' | 'bad' } {
  switch (m.status) {
    case 'QUEUED':
      return { word: 'Waiting to send', tone: 'wait' }
    case 'SENT':
      return { word: 'Sent', tone: 'ok' }
    case 'DELIVERED':
      return { word: 'Delivered', tone: 'ok' }
    case 'READ':
      return { word: 'Read', tone: 'ok' }
    case 'FAILED':
      // Twilio can refuse a message it first took: it went, then wasn't delivered.
      return { word: m.sentAt ? 'Not delivered' : 'Not sent', tone: 'bad' }
    case 'SKIPPED':
      return { word: 'Not sent: switched off', tone: 'wait' }
  }
}
