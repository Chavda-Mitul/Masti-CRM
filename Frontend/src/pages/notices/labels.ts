import { dayMonth } from '../enquiries/case/labels'
import { daysFromToday, istTime } from '../enquiries/due'
import type { Notice, NoticeCategory } from './types'

// The notice board's wording (demo screen 27), in India time.

export const CATEGORY_LABEL: Record<NoticeCategory, string> = { AIRLINE: 'Airline', EMBASSY: 'Embassy', HOTEL: 'Hotel', GENERAL: 'General' }

const IST_WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' })

/** The muted tag chip: "Embassy · China", "Airline", or a general notice's own word ("Process"). */
export function tagLabel(n: Pick<Notice, 'category' | 'about'>): string {
  if (n.category === 'GENERAL') return n.about ?? CATEGORY_LABEL.GENERAL
  return n.about ? `${CATEGORY_LABEL[n.category]} · ${n.about}` : CATEGORY_LABEL[n.category]
}

/** When it was posted: "today, 9:40 am", "yesterday", "Fri" within the week, then "28 Sep". */
export function postedWhen(iso: string): string {
  const days = daysFromToday(iso)
  if (days === 0) return `today, ${istTime(new Date(iso))}`
  if (days === -1) return 'yesterday'
  if (days > -7) return IST_WEEKDAY.format(new Date(iso))
  return dayMonth(iso)
}

/** "Vimal · from IVS · 28 Sep", "Nidhi Vyas · today, 9:40 am". */
export function postedLine(n: Pick<Notice, 'postedBy' | 'source' | 'createdAt'>): string {
  return [n.postedBy.name, n.source === 'IVS' ? 'from IVS' : null, postedWhen(n.createdAt)].filter(Boolean).join(' · ')
}
