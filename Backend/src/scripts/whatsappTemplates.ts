import { prisma } from "../config/prisma";
import { syncTemplates } from "../modules/messages/messageTemplates";

// npm run whatsapp:templates -- submit | check   (docs/decisions/0020-whatsapp-sending.md Amendment 2)
// submit: sends each of the CRM's wordings to the provider (Meta) as a template to review, or its changed words, then
// checks. check: switches on each wording whose template is approved in its current words, and off the others, so they
// go as plain words. Run check again after the provider's review (minutes to a day), and after the database is
// re-seeded. Plain words, not --submit: PowerShell's npm drops flags after --. On a server:
// node dist/src/scripts/whatsappTemplates.js check

async function main(): Promise<number> {
  const word = process.argv.slice(2).map((arg) => arg.replace(/^--/, ""))[0];
  if (word !== "submit" && word !== "check") {
    console.error("Say what to do: npm run whatsapp:templates -- submit   (or check)");
    return 1;
  }
  const reports = await syncTemplates({ submit: word === "submit" });
  for (const r of reports) {
    const why = [r.reason && `reason: ${r.reason}`, r.note, ...r.problems.map((p) => `fix first: ${p}`)].filter(Boolean).join(" · ");
    console.log(`${r.on ? "ON " : "off"}  ${r.name.padEnd(30)} ${r.status}${why ? `  ${why}` : ""}`);
  }
  const on = reports.filter((r) => r.on).length;
  console.log(`\n${on} of ${reports.length} switched on. The others go as plain words, within 24 hours of the client's last message.`);
  return reports.some((r) => r.problems.length > 0) ? 1 : 0;
}

// Ends on its own rather than by process.exit(), which trips a libuv assertion on Windows just after a fetch.
main()
  .then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  )
  .finally(() => prisma.$disconnect());
