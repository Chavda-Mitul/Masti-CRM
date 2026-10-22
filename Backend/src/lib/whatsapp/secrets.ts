// What only the client may see in a message (docs/decisions/0021-whatsapp-outbox.md amendment 6): the door code
// (message 16), which proves the client was at the door. Staff never see it, a live server log never keeps it, and a
// message forgets it once it has gone or won't go. A consent link's secret is masked the same way by its own rule
// (docs/decisions/0022-consent-form.md).

/** The placeholders whose value is the client's alone. */
export const SECRET_PLACEHOLDERS: readonly string[] = ["code"];

/** What a hidden value reads as. */
export const HIDDEN = "••••••";

/** The secret values among a message's values. */
export function secretValues(variables: Record<string, string>): string[] {
  return SECRET_PLACEHOLDERS.flatMap((name) => (variables[name] ? [variables[name]] : []));
}

/** `text` with each of `secrets` hidden. */
export function hideSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce((hidden, secret) => hidden.split(secret).join(HIDDEN), text);
}
