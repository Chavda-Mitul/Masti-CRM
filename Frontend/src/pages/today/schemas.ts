import { z } from 'zod'

/** The Today page's setting (Backend today.schemas.ts): a 24-hour time, as a time input gives it. */
export const todaySettingsFormSchema = z.object({
  newSinceAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 18:00.'),
})

export type TodaySettingsFormValues = z.infer<typeof todaySettingsFormSchema>
