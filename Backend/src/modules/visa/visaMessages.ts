import type { Db } from "../../config/prisma";

// What every visa message says about its case (docs/whatsapp-visa-messages.md): {{client_name}}, {{visa}} and
// {{case_no}}. Each step's message adds its own values to these (docs/decisions/0021-whatsapp-outbox.md).

/** "France tourist visa": the country and the visa type, as the messages name the visa. */
export function visaLabel(country: string, visaType: string): string {
  return `${country} ${visaType.toLowerCase()} visa`;
}

/** The client a case's messages go to, and the values every visa message uses. */
export async function visaMessageBasics(db: Db, enquiryId: string) {
  const enquiry = await db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      caseNo: true,
      clientId: true,
      client: { select: { name: true } },
      visa: { select: { offering: { select: { country: { select: { name: true } }, visaType: { select: { name: true } } } } } },
    },
  });
  if (!enquiry.visa) throw new Error(`${enquiry.caseNo} isn't a visa case.`);
  const { country, visaType } = enquiry.visa.offering;
  return {
    clientId: enquiry.clientId,
    variables: { client_name: enquiry.client.name, visa: visaLabel(country.name, visaType.name), case_no: enquiry.caseNo },
  };
}
