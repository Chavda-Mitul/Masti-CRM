import { useState } from 'react'
import { lostAccess } from '../../../lib/apiErrors'
import { formatMobile } from '../../../lib/format'
import { istTime } from '../due'
import { useCaseMessages } from '../queries'
import type { CaseMessage, CaseReply, VisaCase } from '../types'
import { dayMonth } from './labels'

/**
 * "Sent to the client" (demo screen 06, 0021): every WhatsApp the CRM sent about this case, oldest first, with where it
 * has got to and the file it carried (0025); a failed one says why. Clicking a message shows its words, exactly as
 * sent. Under it, "The client wrote" (0026 amendment 1): their replies, newest first, once there are any. It checks
 * again by itself: often while a message is on its way, otherwise every minute.
 */
export function MessagesSection({ visaCase: c }: { visaCase: VisaCase }) {
  const card = useCaseMessages(c.caseNo)
  const replies = card.data && !lostAccess(card) ? card.data.replies : []
  return (
    <>
      <div className="rail-section">
        <div className="lbl">Sent to the client</div>
        <Messages card={card} />
      </div>
      {replies.length > 0 && (
        <div className="rail-section">
          <div className="lbl">The client wrote</div>
          <ul className="message-list">
            {replies.map((r) => (
              <ReplyRow key={r.id} reply={r} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Messages({ card }: { card: ReturnType<typeof useCaseMessages> }) {
  if (card.isPending) return <p className="muted small rail-note">Loading…</p>
  // A failed refresh keeps the list it showed (lib/apiErrors.ts lostAccess).
  if (card.isLoadingError || lostAccess(card)) return <p className="muted small rail-note">Couldn't load the messages.</p>
  if (card.data.messages.length === 0) return <p className="muted small rail-note">Nothing sent yet.</p>
  return (
    <ul className="message-list">
      {card.data.messages.map((m) => (
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
      {m.attachment && <p className="message-file muted small">File: {m.attachment.fileName}</p>}
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

/** One reply: when, who wrote if it wasn't the client's own number, what it carried, and the words, always shown. */
function ReplyRow({ reply: r }: { reply: CaseReply }) {
  const kind = kindOf(r)
  return (
    <li className="reply-row">
      <div className="reply-head">
        <i className="reply-mark" aria-hidden="true" />
        <span className="muted small">
          {dayMonth(r.receivedAt)} · {istTime(new Date(r.receivedAt))}
          {r.from === 'test' ? ' · from your test number' : r.from ? ` · from ${formatMobile(r.from)}` : ''}
        </span>
      </div>
      {kind && <p className="reply-kind muted small">{kind}</p>}
      {r.text && r.type !== 'reaction' && <p className="message-body">{r.text}</p>}
    </li>
  )
}

/** A line for a reply that isn't only words: what it carried, which only WhatsApp itself can show. */
function kindOf(r: CaseReply): string | null {
  switch (r.type) {
    case 'text':
    case 'button':
    case 'interactive':
      return null
    case 'image':
      return 'Sent a photo: please call to see it'
    case 'document':
      return 'Sent a document: please call to see it'
    case 'video':
      return 'Sent a video: please call to see it'
    case 'audio':
      return 'Sent a voice note: please call to hear it'
    case 'sticker':
      return 'Sent a sticker'
    case 'location':
      return 'Shared a location'
    case 'contacts':
      return 'Shared a contact'
    case 'reaction':
      return r.text ? `Reacted ${r.text}` : 'Took back a reaction'
    default:
      return r.text ? null : "Sent something the CRM can't show"
  }
}
