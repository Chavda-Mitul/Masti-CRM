// Small helpers shared by the masters forms (kept out of component files so fast refresh keeps working).

/** Target keys used by the holiday form: "ALL_EMBASSIES", "MASTI_OFFICE", "COUNTRY:3", "EMBASSY:5". */
export const countryKey = (id: number) => `COUNTRY:${id}`
export const embassyKey = (id: number) => `EMBASSY:${id}`

/** "" → null for optional text fields. */
export const orNull = (value: string) => value.trim() || null
