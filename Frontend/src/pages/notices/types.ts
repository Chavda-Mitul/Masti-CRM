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
}

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
  updatedAt?: string
}
