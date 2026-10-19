// The notice board (docs/decisions/0017-today-dashboard.md Decision 11): GET /api/notices.

export type NoticeCategory = 'AIRLINE' | 'EMBASSY' | 'HOTEL' | 'GENERAL'
export type NoticeSource = 'TEAM' | 'IVS'

export interface Notice {
  id: string
  department: { code: string; name: string }
  category: NoticeCategory
  /** Which airline, embassy or hotel ("China", "IndiGo"); for a general one a word such as "Process". */
  about: string | null
  title: string
  body: string | null
  source: NoticeSource
  status: 'ACTIVE' | 'REMOVED'
  postedBy: { id: string; name: string }
  createdAt: string
  updatedAt: string
  /** Its author, the department's HOD or the Head may change or remove it. */
  canChange: boolean
  /** Picked for the visa team's login popup (Decision 12). */
  inLoginPopup: boolean
}

/** One line of a notice feed (Today's card, the visa team's login popup): a notice, or a holiday entry still new. */
export type NoticeFeedItem =
  | {
      kind: 'NOTICE'
      id: string
      department: { code: string; name: string }
      category: NoticeCategory
      about: string | null
      title: string
      body: string | null
      source: NoticeSource
      postedBy: { id: string; name: string }
      createdAt: string
    }
  | {
      kind: 'HOLIDAY'
      id: string
      name: string
      /** "Tue 20 Oct 2026", "1 – 7 Oct 2026", "Every Sunday" */
      label: string
      /** "French embassy, Mumbai", "All embassies in India" */
      targets: string[]
      addedBy: { id: string; name: string } | null
      createdAt: string
    }

/** The login popup's items: new to this person, each with when it arrived (picked for it, or added to the calendar). */
export type LoginPopupItem = NoticeFeedItem & { at: string }

export interface NoticePage {
  notices: Notice[]
  nextCursor: string | null
}

/** The department tab ('' = All) and the category pill ('' = Everything). */
export interface NoticeFilters {
  department: string
  category: NoticeCategory | ''
}

/** POST (with departmentCode) or PATCH (with updatedAt, the version the form opened on). */
export interface NoticeBody {
  departmentCode?: string
  category: NoticeCategory
  about: string | null
  title: string
  body: string | null
  source: NoticeSource
  /** In the visa team's login popup: Visa notices, picked by the Head or the Visa HOD. */
  loginPopup: boolean
  updatedAt?: string
}
