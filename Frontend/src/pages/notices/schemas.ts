import { z } from 'zod'

/** The notice form (Backend notices.schemas.ts, the same limits). Blank "which one" and details are left out. */
export const noticeFormSchema = z.object({
  departmentCode: z.string().min(1, 'Pick a department.'),
  category: z.enum(['AIRLINE', 'EMBASSY', 'HOTEL', 'GENERAL']),
  about: z.string().trim().max(60, 'Keep it to 60 characters.'),
  title: z.string().trim().min(1, 'Give the notice a title.').max(120, 'Keep the title to 120 characters.'),
  body: z.string().trim().max(1000, 'Keep the details to 1,000 characters.'),
  fromIvs: z.boolean(),
  /** Visa notices only; the Head and the Visa HOD see the tick. */
  loginPopup: z.boolean(),
})

export type NoticeFormValues = z.infer<typeof noticeFormSchema>
