/** Department colours from the approved demo (PROJECT_KNOWLEDGE.md §15). */
export const DEPARTMENT_STYLE: Record<string, { label: string; solid: string; tint: string; text: string }> = {
  VISA: { label: 'Visa', solid: '#7c6fe0', tint: '#ecebfb', text: '#4c3fb5' },
  HOLIDAYS: { label: 'Holidays', solid: '#e8734a', tint: '#fdece4', text: '#b4471f' },
  HOTELS: { label: 'Hotels', solid: '#1e9e95', tint: '#e2f4f2', text: '#12726b' },
  INSURANCE: { label: 'Insurance', solid: '#2f9e62', tint: '#e5f5ec', text: '#1f7a4b' },
  TICKETS: { label: 'Tickets', solid: '#3ba3d0', tint: '#e3f1f8', text: '#1b6b92' },
  ACCOUNTS: { label: 'Accounts', solid: '#e0a030', tint: '#fbf0dc', text: '#9a6200' },
}

/** The departments that take enquiries, in menu order. Accounts doesn't sell. */
export const SELLING_DEPARTMENTS = ['VISA', 'HOLIDAYS', 'HOTELS', 'INSURANCE', 'TICKETS'] as const

export function departmentStyle(code: string) {
  return DEPARTMENT_STYLE[code] ?? { label: code, solid: '#7a746b', tint: '#f3eee5', text: '#5e584f' }
}
