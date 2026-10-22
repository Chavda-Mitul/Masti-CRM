import type { LetterTraveller } from '../../../../components/LetterPaper'
import { LETTER_BLANKS } from '../schemas'
import type { CoveringLetterParty, CoveringLetterSummary, WordingAuthor } from '../types'

// Words and examples the covering-letter screens share (kept out of component files so fast refresh keeps working).

export const PARTY_LABEL: Record<CoveringLetterParty, string> = {
  ONE: 'One traveller',
  SEVERAL: 'Two or more',
}

/** "Neha Joshi", or "Set up with the system" for a sample wording. */
export const authorName = (author: WordingAuthor) => author?.name ?? 'Set up with the system'

/** "Tourist · China, France" */
export const coverage = (letter: Pick<CoveringLetterSummary, 'visaType' | 'countries'>) =>
  `${letter.visaType.name} · ${letter.countries.map((c) => c.name).join(', ')}`

/**
 * A new letter's wording starts as the frame every covering letter has, for the HOD to fill in: shaped like Masti's own
 * letters, with {purpose} where the AI or staff write why they travel (0019 amendments 2 and 4).
 */
export const STARTING_WORDING = `{date}

To,
The Visa Officer,
The Consulate General of {country},
Mumbai, India.

Sub: Application for a {visaType} visa

Respected Sir/Madam,

{purpose}

Thanking you in anticipation,

Yours truly,

{applicant}
{clientAddress}`

/** What the preview fills the blanks with: a made-up family, the demo's Mehtas. */
export const EXAMPLE_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  LETTER_BLANKS.filter((b) => b.token !== 'travellers').map((b) => [b.token, b.example]),
)

export const EXAMPLE_TRAVELLERS: readonly LetterTraveller[] = [
  { name: 'Rakesh Mehta', relation: 'Self', dateOfBirth: '12 Mar 1980', passportNo: 'Z1234567' },
  { name: 'Anita Mehta', relation: 'Spouse', dateOfBirth: '4 Aug 1983', passportNo: 'Z1234568' },
  { name: 'Aarav Mehta', relation: 'Son', dateOfBirth: '19 Jan 2014', passportNo: 'Z1234569' },
  { name: 'Diya Mehta', relation: 'Daughter', dateOfBirth: '2 Jun 2017', passportNo: 'Z1234570' },
]
