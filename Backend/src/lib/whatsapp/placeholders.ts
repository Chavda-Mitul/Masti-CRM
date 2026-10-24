// A wording's {{placeholders}}, as the outbox fills them (messages.service.ts fill()) and a provider's template names
// them (0020 Amendment 2).

/** The placeholders in the words, in the order they first appear, each once: "client_name", "visa", "case_no". */
export function placeholdersIn(words: string): string[] {
  return [...new Set([...words.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!))];
}
