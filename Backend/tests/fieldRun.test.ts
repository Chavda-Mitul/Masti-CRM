import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import { receivedCase, saveCase, visaStaff } from "./visaHelpers";

// The field staff app, phase 3 (docs/decisions/0015-field-staff-app.md): the boy's run on his phone. Only his own jobs,
// in slot order, with what each stop needs (a pickup's pending papers, a delivery's booklets); cancelled stops last;
// "done of total" without the cancelled ones. Field staff only.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface StopDto {
  id: string;
  kind: string;
  status: string;
  department: string;
  slot: { name: string; startsAt: string };
  caseNo: string;
  client: { name: string };
  address: string;
  mapLink: string | null;
  mobile: string;
  booklets: { current: number; old: number } | null;
  pending: { document: string; traveller: string }[];
}
interface RunDto {
  day: string;
  today: string;
  jobs: StopDto[];
  done: number;
  total: number;
}

const slot = (code: string) => prisma.fieldSlot.findUniqueOrThrow({ where: { code } });

/**
 * Ramesh's day: a delivery at 11 am (Mehta's passports in our stock: 2 + 0), a pickup at 4 pm (Shah's case at Step 1,
 * one paper already received), a cancelled delivery, a pickup tomorrow; and Suresh's own pickup today. Jobs are written
 * straight to the database: booking itself is tested in visaFieldJobs.test.ts.
 */
async function setup() {
  const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
  const suresh = await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
  const delivered = await receivedCase();
  const aarti = await visaStaff();
  const shah = await saveCase(aarti, { mobile: "98250 41299", clientName: "Sunil Shah" });
  const aartiUser = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
  const [morning, evening] = [await slot("MORNING"), await slot("EVENING")];
  const today = istToday();
  const job = (data: Record<string, unknown>) =>
    prisma.fieldJob.create({
      data: { departmentId: visa.id, address: "B-702, Raghuvir Residency, Vesu", mobile: "+919825041234", createdById: aartiUser.id, day: toDbDate(today), ...data } as never,
    });
  await job({ kind: "PICKUP", enquiryId: shah.id, assigneeId: ramesh.id, slotId: evening.id, mapLink: "https://maps.app.goo.gl/AbC123xyz" });
  await job({ kind: "DELIVERY", enquiryId: delivered.c.id, assigneeId: ramesh.id, slotId: morning.id });
  await job({ kind: "DELIVERY", enquiryId: shah.id, assigneeId: ramesh.id, slotId: morning.id, status: "CANCELLED", cancelledAt: new Date(), cancelledById: aartiUser.id });
  await job({ kind: "PICKUP", enquiryId: shah.id, assigneeId: ramesh.id, slotId: morning.id, day: toDbDate(addDays(today, 1)) });
  await job({ kind: "PICKUP", enquiryId: delivered.c.id, assigneeId: suresh.id, slotId: morning.id });
  // One of Shah's papers is already in: it isn't asked for again.
  const passport = await prisma.visaCaseDocument.findFirstOrThrow({ where: { traveller: { caseId: shah.id, position: 1 }, name: "Passport" } });
  await prisma.visaCaseDocument.update({ where: { id: passport.id }, data: { status: "RECEIVED", receivedAs: "ORIGINAL", receivedAt: new Date(), receivedById: aartiUser.id } });
  return { ramesh, delivered, shah, today };
}

describe("his run (phase 3)", () => {
  it("lists his own stops for today in slot order, with what each needs; cancelled ones last", async () => {
    const { delivered, shah, today } = await setup();
    const ramesh = await loginAs("98250 00001");
    const res = await ramesh.get("/api/field/jobs");
    expect(res.status).toBe(200);
    const run = res.body as RunDto;
    expect(run).toMatchObject({ day: today, today, done: 0, total: 2 });
    expect(run.jobs.map((j) => `${j.kind} ${j.status} ${j.slot.name}`)).toEqual(["DELIVERY BOOKED 11 am – 1 pm", "PICKUP BOOKED 4–6 pm", "DELIVERY CANCELLED 11 am – 1 pm"]);

    const [delivery, pickup] = run.jobs;
    expect(delivery).toMatchObject({ department: "VISA", caseNo: delivered.c.caseNo, client: { name: "Rakesh Mehta" }, booklets: { current: 2, old: 0 }, pending: [], mobile: "+919825041234" });
    expect(pickup).toMatchObject({ caseNo: shah.caseNo, client: { name: "Sunil Shah" }, booklets: null, mapLink: "https://maps.app.goo.gl/AbC123xyz" });
    // Unnamed travellers by their placeholder; what we arrange ourselves and what's already in aren't asked for.
    const pending = pickup!.pending;
    expect(pending.length).toBeGreaterThan(0);
    expect(pending).not.toContainEqual({ document: "Passport", traveller: "Adult 1" });
    expect(pending).toContainEqual({ document: "Passport", traveller: "Child 1" });
    const arranged = await prisma.visaCaseDocument.findMany({ where: { traveller: { caseId: shah.id }, requirement: "ARRANGED_BY_US" }, select: { name: true } });
    for (const a of arranged) expect(pending.map((p) => p.document)).not.toContain(a.name);
  });

  it("counts finished stops; another day shows that day's; another boy sees only his", async () => {
    const { today } = await setup();
    await prisma.fieldJob.updateMany({ where: { kind: "PICKUP", day: toDbDate(today), assignee: { mobile: "+919825000001" } }, data: { status: "DONE" } });
    const ramesh = await loginAs("98250 00001");
    expect((await ramesh.get("/api/field/jobs")).body).toMatchObject({ done: 1, total: 2 });
    const tomorrow = (await ramesh.get(`/api/field/jobs?day=${addDays(today, 1)}`)).body as RunDto;
    expect(tomorrow).toMatchObject({ day: addDays(today, 1), today });
    expect(tomorrow.jobs.map((j) => `${j.kind} ${j.slot.name}`)).toEqual(["PICKUP 11 am – 1 pm"]);

    const suresh = await loginAs("98250 00002");
    const his = (await suresh.get("/api/field/jobs")).body as RunDto;
    expect(his.jobs.map((j) => j.kind)).toEqual(["PICKUP"]);
    expect(his.total).toBe(1);
  });

  it("refuses a bad day, office staff, the Head and anyone signed out", async () => {
    await setup();
    const ramesh = await loginAs("98250 00001");
    const bad = await ramesh.get("/api/field/jobs?day=tomorrow");
    expect(bad.status).toBe(400);
    expect(bad.body.issues.day).toEqual(["Pick a day as YYYY-MM-DD."]);
    expect((await (await visaStaff()).get("/api/field/jobs")).status).toBe(403);
    // The Head (Vimal) was made with the case.
    expect((await (await loginAs("vimal@masti.test")).get("/api/field/jobs")).status).toBe(403);
    expect((await request(app).get("/api/field/jobs")).status).toBe(401);
  });
});
