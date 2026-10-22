import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, dayLabel, istDateTimeToUtc, istToday, timeLabel, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import {
  VISA_APPLIED_ONLINE,
  VISA_APPROVED,
  VISA_COLLECTION_VISIT,
  VISA_DELIVERY_VISIT,
  VISA_DOCUMENT_LIST,
  VISA_DOCUMENT_REMINDER,
  VISA_HANDED_OVER,
  VISA_INVOICE,
  VISA_PARTLY_APPROVED,
  VISA_PASSPORTS_BACK,
  VISA_PRICE,
  VISA_REFUSED,
  VISA_SUBMITTED,
} from "../src/modules/messages/messages.seed";
import { DOCUMENT_REMINDERS_KEY } from "../src/modules/visa/visa.settings";
import { fitList, namesText, passportCountText } from "../src/modules/visa/visaMessages";
import { sendDueReminders } from "../src/modules/visa/visaReminders.service";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { aWednesday, decidedCase, dispatchCase, makeInvoiceable, mastiReady, receivedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The visa messages (docs/whatsapp-visa-messages.md; docs/decisions/0021-whatsapp-outbox.md amendments 3 to 5): 1 the
// document list, 2 the price, 3 the pending-documents reminder, 5 the collection visit, 7 the invoice, 8 file
// submitted, 9 applied online, 10–12 the decision, 13 passports at our office, 14 the delivery visit, 15 handed over.
// Each is queued with the change it follows; messages.test.ts covers how a queued message is sent.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await seedHolidays(prisma); // the weekly Sunday off
});

/** The messages of one kind, oldest first. */
const sent = (code: string) => prisma.outboundMessage.findMany({ where: { template: { code } }, orderBy: { createdAt: "asc" } });
/** Masti's phone and office address as Settings → Company has them until the Head changes them. */
const PHONE = "+91-93777-57580";
const OFFICE = "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA";
/** The client's home, where the boy collects and delivers. */
const HOME = "B-702, Raghuvir Residency, Vesu, Surat 395007";
/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const minutes = (n: number) => n * 60_000;
const caseOf = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;

/** Saves the quote: the adult itemised, the child a lump sum, ₹500 service charge (₹6,000 in all with GST). */
async function quote(agent: Agent, caseNo: string, serviceChargePaise = 50_000) {
  const c = (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;
  const speed = (await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } })).id;
  const [adult, child] = c.travellers;
  return agent.put(`/api/visa/cases/${caseNo}/quote`).send({
    processingSpeedId: speed,
    serviceChargePaise,
    lines: [
      { travellerId: adult.id, form: "ITEMISED", embassyFeePaise: 50_000, vfsFeePaise: 80_000, otherFeePaise: 211_000 },
      { travellerId: child.id, form: "LUMP_SUM", lumpSumPaise: 200_000 },
    ],
    updatedAt: c.quote?.updatedAt ?? null,
  });
}

/** Raises the case's invoice from its quote, as the Raise dialog does. */
async function raise(agent: Agent, caseNo: string) {
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${caseNo}/invoice/check`)).body.preview;
  return agent.post(`/api/visa/cases/${caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise });
}

describe("message 1, the document list", () => {
  it("goes with a new case: what to bring, each paper once, for how many, and our phone", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff); // France, an adult and a child
    const messages = await sent(VISA_DOCUMENT_LIST);
    expect(messages).toHaveLength(1);
    const [m] = messages;
    expect(m).toMatchObject({ status: "QUEUED", enquiryId: c.id, toMobile: "+919825041234" });
    expect(m!.body).toContain(`for your France tourist visa. Your case number is ${c.caseNo}.`);
    expect(m!.body).toContain("Documents needed for 2 travellers: 1. Passport (original); ");
    expect(m!.body).toContain("Photos, 35×45 mm, white background × 2 (original)");
    expect(m!.body).toContain("Birth certificate (for children)");
    // What we arrange is never asked for.
    expect(m!.body).not.toMatch(/flight|insurance/i);
    expect(m!.body).toContain(`call us on ${PHONE}.`);
  });

  it("leaves out children's papers when no child travels", async () => {
    const staff = await visaStaff();
    await saveCase(staff, { children: 0 });
    const [m] = await sent(VISA_DOCUMENT_LIST);
    expect(m!.body).toContain("Documents needed for 1 traveller: ");
    expect(m!.body).not.toContain("for children");
  });

  it("cuts a long list short, to fit what WhatsApp allows", () => {
    const items = Array.from({ length: 40 }, (_, i) => `${i + 1}. A paper with a long description, number ${i + 1}`);
    const text = fitList(items);
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).toMatch(/^1\. A paper/);
    expect(text).toMatch(/; and \d+ more \(we will tell you\)$/);
    expect(fitList(["1. Passport", "2. Photos"])).toBe("1. Passport; 2. Photos");
  });
});

describe("message 2, the price", () => {
  it("goes the first time the case has a price; a later change sends nothing", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect((await quote(staff, c.caseNo)).status).toBe(200);
    const [m] = await sent(VISA_PRICE);
    expect(m!.body).toContain(`The price for your France tourist visa (${c.caseNo}) is ₹6,000 for 2 travellers, including all fees and taxes.`);
    expect(m!.body).toContain(`call us on ${PHONE}.`);

    // The invoice (message 7) carries the final amount.
    expect((await quote(staff, c.caseNo, 60_000)).status).toBe(200);
    expect(await sent(VISA_PRICE)).toHaveLength(1);
  });
});

describe("message 3, the pending-documents reminder", () => {
  /** The first reminder of a case saved today: two days on at 11:00, moved off a Sunday or an office holiday. */
  const firstReminder = async () => istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 2), { office: true }), "11:00");
  const setReminders = (value: object) =>
    prisma.setting.upsert({ where: { key: DOCUMENT_REMINDERS_KEY }, update: { value }, create: { key: DOCUMENT_REMINDERS_KEY, value } });

  /** Rakesh (named) and the child (not yet), each with one paper still to bring; the rest in or arranged by us. */
  async function caseWithTwoMissing() {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SELF" } })).id;
    const member = (await staff.post(`/api/clients/${c.client.id}/members`).send({ name: "Rakesh Mehta", relationId })).body.member;
    const travellers = (await staff.get(`/api/visa/cases/${c.caseNo}`)).body.case.travellers;
    expect((await staff.put(`/api/visa/cases/${c.caseNo}/travellers/${travellers[0].id}/member`).send({ memberId: member.id })).status).toBe(200);
    await prisma.visaCaseDocument.updateMany({
      where: {
        traveller: { caseId: c.id },
        requirement: { not: "ARRANGED_BY_US" },
        NOT: [{ traveller: { position: 1 }, name: { startsWith: "Bank statement" } }, { traveller: { position: 2 }, name: "Birth certificate" }],
      },
      data: { status: "NOT_NEEDED" },
    });
    return { staff, c };
  }

  it("goes at the planned day and time with what's still missing, once that day", async () => {
    const { c } = await caseWithTwoMissing();
    const due = await firstReminder();
    await sendDueReminders(new Date(due.getTime() - minutes(1)));
    expect(await sent(VISA_DOCUMENT_REMINDER)).toHaveLength(0);

    await sendDueReminders(new Date(due.getTime() + minutes(5)));
    await sendDueReminders(new Date(due.getTime() + minutes(20)));
    const reminders = await sent(VISA_DOCUMENT_REMINDER);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.body).toContain(
      `A reminder for your France tourist visa (${c.caseNo}). We are still waiting for: Bank statement, last 6 months (Rakesh); Birth certificate (Child 1).`,
    );
    expect(reminders[0]!.body).toContain(`Call us on ${PHONE} to book a time.`);
  });

  it("isn't sent hours late: past two hours it waits for the next planned day", async () => {
    await caseWithTwoMissing();
    const due = await firstReminder();
    await sendDueReminders(new Date(due.getTime() + minutes(150)));
    expect(await sent(VISA_DOCUMENT_REMINDER)).toHaveLength(0);
  });

  it("doesn't go while switched off, set to SMS, with only what we arrange left, or once the case moved on", async () => {
    const { c } = await caseWithTwoMissing();
    const late = new Date((await firstReminder()).getTime() + minutes(5));
    const count = async () => {
      await sendDueReminders(late);
      return (await sent(VISA_DOCUMENT_REMINDER)).length;
    };

    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { remindersOn: false } });
    expect(await count()).toBe(0);
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { remindersOn: true } });

    await setReminders({ enabled: false, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" });
    expect(await count()).toBe(0);
    // SMS isn't built yet: nothing goes.
    await setReminders({ enabled: true, everyDays: 2, sendAt: "11:00", channel: "SMS" });
    expect(await count()).toBe(0);
    await setReminders({ enabled: true, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" });

    // Past the documents (File preparation): nothing to ask for any more.
    const prep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { stageId: true } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: prep.id } });
    expect(await count()).toBe(0);
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: enquiry.stageId } });

    // Only what we arrange is left (the flight, the hotel, the insurance): nothing to ask the client for.
    await prisma.visaCaseDocument.updateMany({ where: { traveller: { caseId: c.id }, requirement: { not: "ARRANGED_BY_US" } }, data: { status: "NOT_NEEDED" } });
    expect(await count()).toBe(0);
  });
});

// The field boy's visits (messages 5 and 14): booked for the first open office day after today, 4–6 pm, at the home.

/** The client's email on file (the door code goes there for now), and Ramesh the field boy. */
async function fieldReady(clientId: string) {
  await prisma.client.update({ where: { id: clientId }, data: { email: "rakesh@example.com" } });
  return createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
}
const visitDay = () => nextOpenDay(addDays(istToday(), 1), { office: true });

async function bookVisit(agent: Agent, caseNo: string, assigneeId: string, kind: "PICKUP" | "DELIVERY") {
  const c = await caseOf(agent, caseNo);
  const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
  const day = await visitDay();
  return agent.post(`/api/visa/cases/${caseNo}/field-jobs`).send({ kind, assigneeId, day, slotId: slot.id, address: HOME, updatedAt: c.updatedAt });
}

/** "Change" the case's booked visit: as it is, but for `body`. */
async function changeVisit(agent: Agent, caseNo: string, body: object) {
  const now = await caseOf(agent, caseNo);
  const job = now.fieldJobs.find((j: { status: string }) => j.status === "BOOKED");
  return agent.put(`/api/visa/cases/${caseNo}/field-jobs/${job.id}`).send({
    assigneeId: job.assignee.id,
    day: job.day,
    slotId: job.slot.id,
    address: job.address,
    mapLink: job.mapLink,
    updatedAt: now.updatedAt,
    ...body,
  });
}

async function cancelVisit(agent: Agent, caseNo: string) {
  const now = await caseOf(agent, caseNo);
  const job = now.fieldJobs.find((j: { status: string }) => j.status === "BOOKED");
  return agent.post(`/api/visa/cases/${caseNo}/field-jobs/${job.id}/cancel`).send({ updatedAt: now.updatedAt });
}

describe("message 5, the collection visit", () => {
  it("goes when the boy is booked, and again when the visit changes; not for a map link or a cancel", async () => {
    const aarti = await visaStaff();
    const c = await saveCase(aarti);
    const ramesh = await fieldReady(c.client.id);
    expect((await bookVisit(aarti, c.caseNo, ramesh.id, "PICKUP")).status).toBe(200);
    const day = await visitDay();
    const [first] = await sent(VISA_COLLECTION_VISIT);
    expect(first!.body).toContain(`Our staff member Ramesh will come to collect the documents for ${c.caseNo} on ${dayLabel(day)}, 4–6 pm, at: ${HOME}.`);
    expect(first!.body).toContain(`To change the time, call us on ${PHONE}.`);

    // A new slot: the client hears again.
    const morning = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "MORNING" } });
    expect((await changeVisit(aarti, c.caseNo, { slotId: morning.id })).status).toBe(200);
    const after = await sent(VISA_COLLECTION_VISIT);
    expect(after).toHaveLength(2);
    expect(after[1]!.body).toContain(`on ${dayLabel(day)}, ${morning.name}, at:`);

    // A map link alone is for the boy.
    expect((await changeVisit(aarti, c.caseNo, { mapLink: "https://maps.app.goo.gl/abc123" })).status).toBe(200);
    expect(await sent(VISA_COLLECTION_VISIT)).toHaveLength(2);

    // A cancel sends nothing: staff call the client.
    expect((await cancelVisit(aarti, c.caseNo)).status).toBe(200);
    expect(await sent(VISA_COLLECTION_VISIT)).toHaveLength(2);
  });
});

describe("message 7, the invoice", () => {
  /** Aarti's case at the Enquiry step, ready to invoice for ₹6,000, with Masti's details filled in. */
  async function invoiceable() {
    await mastiReady();
    const aarti = await visaStaff();
    const c = await saveCase(aarti);
    await makeInvoiceable(aarti, c);
    return { aarti, c };
  }

  it("goes with each invoice raised, with its number and amount: the main one, a corrected one, the additional one", async () => {
    const { aarti, c } = await invoiceable();
    expect((await raise(aarti, c.caseNo)).status).toBe(200);
    const [main] = await sent(VISA_INVOICE);
    expect(main!.body).toContain(`Your invoice MVI00000001 for the France tourist visa (${c.caseNo}) is ready. Amount: ₹6,000.`);
    expect(main!.body).toContain("You can pay by bank transfer or at our office. Our bank details are on the invoice.");

    // Cancelled with a credit note, the service charge corrected to ₹600, and raised again.
    const shown = (await aarti.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body;
    const reasonId = (await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } })).id;
    const cancel = await aarti.post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send({ invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, reasonId });
    expect(cancel.status).toBe(200);
    expect((await quote(aarti, c.caseNo, 60_000)).status).toBe(200);
    expect((await raise(aarti, c.caseNo)).status).toBe(200);

    // The one additional invoice: ₹1,500 for an urgent submission.
    const { mainInvoiceNo } = (await aarti.get(`/api/visa/cases/${c.caseNo}/additional-invoice/check`)).body;
    const urgent = await prisma.extraCharge.findUniqueOrThrow({ where: { code: "URGENT_SUBMISSION" } });
    const additional = await aarti
      .post(`/api/visa/cases/${c.caseNo}/additional-invoice`)
      .send({ mainInvoiceNo, charges: [{ chargeId: urgent.id, amountPaise: 150_000 }], totalPaise: 150_000 });
    expect(additional.status).toBe(200);

    const messages = await sent(VISA_INVOICE);
    expect(messages).toHaveLength(3);
    expect(messages[1]!.body).toContain(`Your invoice MVI00000002 for the France tourist visa (${c.caseNo}) is ready. Amount: ₹6,118.`);
    expect(messages[2]!.body).toContain(`Your invoice MVI00000002-A for the France tourist visa (${c.caseNo}) is ready. Amount: ₹1,500.`);
  });

  it("isn't sent when the raise is refused", async () => {
    const { aarti, c } = await invoiceable();
    const later = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId: later, resumeOn: toDbDate(addMonths(istToday(), 1)) } });
    const res = await raise(aarti, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Resume it first/);
    expect(await sent(VISA_INVOICE)).toHaveLength(0);
  });
});

describe("message 8, file submitted", () => {
  it("goes when the file is first marked submitted, with the embassy and the expected date; a correction sends nothing", async () => {
    // Mehta's file: dispatched, received by the vendor, and marked submitted for collection on a Wednesday.
    const { c, processor } = await decidedCase({ decided: false });
    const messages = await sent(VISA_SUBMITTED);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(`Your France tourist visa file (${c.caseNo}) has been submitted to the French embassy, Mumbai.`);
    expect(messages[0]!.body).toContain(`We expect the result around ${dayLabel(aWednesday())} and will message you as soon as we hear.`);

    // The collection date moves a week: the case changes, the client isn't messaged again.
    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const { updatedAt } = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    const moved = await processor
      .put(`/api/visa/cases/${c.caseNo}/submission`)
      .send({ vendorFileNo: "FR-MUM88421", embassyId: embassy.id, collectionOn: addDays(aWednesday(), 7), updatedAt });
    expect(moved.status).toBe(200);
    expect(await sent(VISA_SUBMITTED)).toHaveLength(1);
  });
});

/** Neha's e-visa at Docket & dispatch: Vendor needed off, no vendor, its invoice raised. */
async function eVisa() {
  await mastiReady();
  const c = await dispatchCase();
  const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
  await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
  await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
  const neha = await loginAs("neha@masti.test");
  await makeInvoiceable(neha, c);
  expect((await raise(neha, c.caseNo)).status).toBe(200);
  return { c, neha };
}

async function submitOnline(agent: Agent, caseNo: string) {
  const { updatedAt } = await caseOf(agent, caseNo);
  return agent.post(`/api/visa/cases/${caseNo}/submit-online`).send({ updatedAt });
}

describe("message 9, applied online", () => {
  it("goes when an e-visa is marked applied online; the refused second press sends nothing", async () => {
    const { c, neha } = await eVisa();
    expect((await submitOnline(neha, c.caseNo)).status).toBe(200);
    const messages = await sent(VISA_APPLIED_ONLINE);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(`We have applied online for your France tourist visa (${c.caseNo}). We will message you as soon as the result comes.`);

    expect((await submitOnline(neha, c.caseNo)).status).toBe(409);
    expect(await sent(VISA_APPLIED_ONLINE)).toHaveLength(1);
  });
});

describe("messages 10–12, the decision", () => {
  type Outcome = "APPROVED" | "REFUSED";

  /** "Record the decision": each traveller, in order, approved (with a sticker and dates covering the trip) or refused. */
  async function decide(agent: Agent, caseNo: string, travellerIds: string[], outcomes: Outcome[]) {
    const valid = { validFrom: addDays(istToday(), 20), validTo: addDays(istToday(), 60) };
    const { updatedAt } = await caseOf(agent, caseNo);
    return agent.post(`/api/visa/cases/${caseNo}/decision`).send({
      outcomes: travellerIds.map((travellerId, i) =>
        outcomes[i] === "APPROVED" ? { travellerId, outcome: "APPROVED", visaNo: `0182 447${i}`, ...valid } : { travellerId, outcome: "REFUSED" },
      ),
      updatedAt,
    });
  }
  const decisionMessages = () => prisma.outboundMessage.count({ where: { template: { code: { in: [VISA_APPROVED, VISA_REFUSED, VISA_PARTLY_APPROVED] } } } });

  it("sends Partly approved when some are approved and some refused, with the names and the working days", async () => {
    const { c } = await decidedCase(); // Rakesh approved, Aarav refused
    const messages = await sent(VISA_PARTLY_APPROVED);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(
      `The embassy has decided on your France tourist visa (${c.caseNo}). Good news: it is approved for Rakesh Mehta. We are sorry that it was refused for Aarav Mehta.`,
    );
    expect(messages[0]!.body).toContain(
      `Your passports should reach our office in about 2 working days, and we will message you when they arrive. Please call us on ${PHONE} to talk about the refusal.`,
    );
    expect(await decisionMessages()).toBe(1);
  });

  it("sends Visa approved when everyone is, with where to collect; a corrected decision sends nothing more", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    expect((await decide(processor, c.caseNo, [adult, child], ["APPROVED", "APPROVED"])).status).toBe(200);
    const [m] = await sent(VISA_APPROVED);
    expect(m!.body).toContain(`Congratulations! The France tourist visa is approved for Rakesh Mehta and Aarav Mehta (${c.caseNo}).`);
    expect(m!.body).toContain(
      `Your passports should reach our office in about 2 working days. We will then deliver them on our delivery schedule. If you need them sooner, you can collect them from our office at ${OFFICE} once they arrive.`,
    );

    // Aarav's entry corrected to Refused: staff call the client.
    const { updatedAt } = await caseOf(processor, c.caseNo);
    expect((await processor.put(`/api/visa/cases/${c.caseNo}/travellers/${child}/decision`).send({ outcome: "REFUSED", updatedAt })).status).toBe(200);
    expect(await decisionMessages()).toBe(1);
  });

  it("sends Visa refused when everyone is; the working days follow the setting", async () => {
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    for (const workingDays of [0, 31, 1.5]) expect((await hod.put("/api/visa/settings").send({ passportsArrive: { workingDays } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ passportsArrive: { workingDays: 1 } })).status).toBe(200);
    expect((await hod.get("/api/visa/settings")).body.settings.passportsArrive).toEqual({ workingDays: 1 });

    const { c, processor, adult, child } = await decidedCase({ decided: false });
    expect((await decide(processor, c.caseNo, [adult, child], ["REFUSED", "REFUSED"])).status).toBe(200);
    const [m] = await sent(VISA_REFUSED);
    expect(m!.body).toContain(`We are sorry to tell you that the embassy has refused the France tourist visa for Rakesh Mehta and Aarav Mehta (${c.caseNo}).`);
    expect(m!.body).toContain(
      `Your passports should reach our office in about 1 working day, and we will message you when they arrive. Please call us on ${PHONE}: we will explain the reason and what can be done next.`,
    );
  });

  it("isn't sent for an e-visa yet (how its client gets the visa is still open)", async () => {
    const { c, neha } = await eVisa();
    expect((await submitOnline(neha, c.caseNo)).status).toBe(200);
    const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
    expect((await decide(neha, c.caseNo, travellers.map((t) => t.id), ["APPROVED", "APPROVED"])).status).toBe(200);
    expect(await decisionMessages()).toBe(0);
  });
});

describe("message 13, passports at our office", () => {
  /** Mehta's decided file (Rakesh approved) on its way back, then counted in with `back` (2 + 0 went out). */
  async function received(back: { current: number; old: number }) {
    const d = await decidedCase();
    const { c, processor } = d;
    const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
    const decided = (await caseOf(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt: decided })).status).toBe(200);
    const inTransit = (await caseOf(processor, c.caseNo)).updatedAt;
    const stickers = [{ travellerId: d.adult, check: "MATCHES" }];
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-received`).send({ booklets: back, stickers, updatedAt: inTransit })).status).toBe(200);
    return d;
  }

  it("goes when every passport is back, with where to collect them", async () => {
    const { c } = await received({ current: 2, old: 0 });
    const messages = await sent(VISA_PASSPORTS_BACK);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(`Your passports for ${c.caseNo} are back at our office.`);
    expect(messages[0]!.body).toContain(`If you prefer, you can collect them from our office at ${OFFICE}.`);
  });

  it("waits while one is missing, sends nothing when it's cleared as lost, and goes once it turns up after all", async () => {
    const { c, processor } = await received({ current: 1, old: 0 });
    expect(await sent(VISA_PASSPORTS_BACK)).toHaveLength(0);

    const reasonId = (await prisma.missingPassportReason.findUniqueOrThrow({ where: { code: "EMBASSY_KEPT" } })).id;
    const short = await caseOf(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-received/clear`).send({ reasonId, updatedAt: short.updatedAt })).status).toBe(200);
    expect(await sent(VISA_PASSPORTS_BACK)).toHaveLength(0);

    const cleared = await caseOf(processor, c.caseNo);
    const rest = await processor.post(`/api/visa/cases/${c.caseNo}/passports-received/rest`).send({ booklets: { current: 1, old: 0 }, updatedAt: cleared.updatedAt });
    expect(rest.status).toBe(200);
    expect(await sent(VISA_PASSPORTS_BACK)).toHaveLength(1);
  });
});

describe("message 14, the delivery visit", () => {
  it("goes when the delivery boy is booked, and again when the visit changes; not for a cancel", async () => {
    const { c, processor } = await receivedCase();
    const ramesh = await fieldReady(c.client.id);
    expect((await bookVisit(processor, c.caseNo, ramesh.id, "DELIVERY")).status).toBe(200);
    const [first] = await sent(VISA_DELIVERY_VISIT);
    expect(first!.body).toContain(`Our staff member Ramesh will bring your passports for ${c.caseNo} on ${dayLabel(await visitDay())}, 4–6 pm, to: ${HOME}.`);
    expect(first!.body).toContain("they will take a photo of the person receiving the passports.");
    expect(first!.body).toContain(`To change the time, call us on ${PHONE}.`);

    const morning = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "MORNING" } });
    expect((await changeVisit(processor, c.caseNo, { slotId: morning.id })).status).toBe(200);
    expect(await sent(VISA_DELIVERY_VISIT)).toHaveLength(2);
    expect((await cancelVisit(processor, c.caseNo)).status).toBe(200);
    expect(await sent(VISA_DELIVERY_VISIT)).toHaveLength(2);
    expect(await sent(VISA_COLLECTION_VISIT)).toHaveLength(0);
  });
});

describe("message 15, passports handed over", () => {
  it("goes when the office hands them over: how many, to whom and when", async () => {
    const { c, processor, adult } = await receivedCase();
    const photo = (await processor.post(`/api/visa/cases/${c.caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo;
    const { updatedAt } = await caseOf(processor, c.caseNo);
    const res = await processor
      .post(`/api/visa/cases/${c.caseNo}/handover`)
      .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: adult }, photoId: photo.id, updatedAt });
    expect(res.status).toBe(200);

    const { at } = await prisma.visaHandover.findUniqueOrThrow({ where: { enquiryId: c.id } });
    const messages = await sent(VISA_HANDED_OVER);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(`We have handed over 2 passports for ${c.caseNo} to Rakesh Mehta on ${dayLabel(istToday(at))}, ${timeLabel(at)}.`);
    expect(messages[0]!.body).toContain(`Thank you for choosing us. If anything is not right, please call us on ${PHONE}.`);
  });

  it("words the count, the names and the time as the client reads them", () => {
    expect(passportCountText({ current: 2, old: 0 })).toBe("2 passports");
    expect(passportCountText({ current: 4, old: 3 })).toBe("4 passports and 3 old passports");
    expect(passportCountText({ current: 1, old: 1 })).toBe("1 passport and 1 old passport");
    expect(passportCountText({ current: 0, old: 1 })).toBe("1 old passport");
    expect(namesText(["Rakesh Mehta"])).toBe("Rakesh Mehta");
    expect(namesText(["Rakesh Mehta", "Priya Mehta", "Aarav Mehta"])).toBe("Rakesh Mehta, Priya Mehta and Aarav Mehta");
    // India is UTC+5:30.
    expect(timeLabel(new Date("2026-10-31T06:40:00Z"))).toBe("12:10 pm");
    expect(timeLabel(new Date("2026-10-31T03:35:00Z"))).toBe("9:05 am");
  });
});
