import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { doorCodeMessages, lastDoorCode as lastCode, PNG, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The field staff app, phase 4b (docs/decisions/0015-field-staff-app.md Decision 4): the pickup at the door. The client's
// one-time code on WhatsApp (message 16; only its hash kept; a wait before another; wrong tries counted; where its
// message has got to on his phone), his selfie, and "Picked up": the booklets he counted become the case's intake
// count. No code, no pickup.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const PLACE = { lat: 21.1959, lng: 72.7933, accuracy: 12 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

/** Ramesh's pickup today at Hiren Kapadia's (Aarti's case at Step 1; no email on file), written straight to the database. */
async function setup() {
  const ramesh = await createUser({ name: "Ramesh Patel", mobile: "+919825000001", type: "FIELD" });
  const aarti = await visaStaff();
  const c = await saveCase(aarti, { mobile: "98250 41299", clientName: "Hiren Kapadia" });
  const aartiUser = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
  const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
  const job = (data: Record<string, unknown> = {}) =>
    prisma.fieldJob.create({
      data: {
        departmentId: visa.id,
        kind: "PICKUP",
        enquiryId: c.id,
        assigneeId: ramesh.id,
        day: toDbDate(istToday()),
        slotId: slot.id,
        address: "12, Shantikunj Society, Adajan",
        mobile: "+919825041299",
        createdById: aartiUser.id,
        ...data,
      } as never,
    });
  const pickup = await job();
  const boy = await loginAs("98250 00001");
  return { ramesh, aarti, c, pickup, job, boy };
}

const send = (boy: Agent, jobId: string) => boy.post(`/api/field/jobs/${jobId}/otp`).send({});
const check = (boy: Agent, jobId: string, code: string) => boy.post(`/api/field/jobs/${jobId}/otp/check`).send({ code });
const selfie = (boy: Agent, jobId: string, bytes: Buffer = JPEG, type = "image/jpeg") =>
  boy.post(`/api/field/jobs/${jobId}/selfie`).set("Content-Type", type).send(bytes);
const done = (boy: Agent, jobId: string, body: Record<string, unknown>) => boy.post(`/api/field/jobs/${jobId}/done`).send(body);
/** Lets him send a new code now: the last one went more than the wait ago. */
const afterTheWait = (jobId: string) =>
  prisma.fieldJob.update({ where: { id: jobId }, data: { otpSentAt: new Date(Date.now() - 61_000) } });

describe("the client's code", () => {
  it("goes to the client's WhatsApp, kept only as a hash; the number shows masked; staff never see it; another only after the wait", async () => {
    const { pickup, boy, c, aarti } = await setup();
    const res = await send(boy, pickup.id);
    expect(res.status).toBe(200);
    const { otp } = res.body;
    expect(otp).toMatchObject({ sentTo: "+91••••••1299", confirmedAt: null, message: { status: "QUEUED", error: null } });
    expect(Date.parse(otp.expiresAt) - Date.parse(otp.sentAt)).toBe(10 * 60_000);
    expect(Date.parse(otp.resendAt) - Date.parse(otp.sentAt)).toBe(60_000);

    // Message 16, Meta's fixed words, to the client's main number. No email is needed.
    const [message] = await doorCodeMessages();
    expect(message).toMatchObject({ enquiryId: c.id, toMobile: "+919825041299", status: "QUEUED" });
    const code = await lastCode();
    expect(message!.body).toBe(`${code} is your verification code.\n\nThis code expires in 10 minutes.`);

    const row = await prisma.fieldJob.findUniqueOrThrow({ where: { id: pickup.id } });
    expect(row.otpHash).toBe(createHash("sha256").update(`${pickup.id}:${code}`).digest("hex"));
    expect(row).toMatchObject({ otpSentTo: "+919825041299", otpTries: 0, otpConfirmedAt: null });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "field.otp.send" } })).toMatchObject({
      entityId: pickup.id,
      after: { to: "+919825041299" },
    });

    // The case's "Sent to the client" card shows the message without the code, even while it waits to go.
    const card = (await aarti.get(`/api/visa/cases/${c.caseNo}/messages`)).body.messages as { title: string; body: string }[];
    expect(card.find((m) => m.title === "Code at the door")!.body).toBe("•••••• is your verification code.\n\nThis code expires in 10 minutes.");
    expect(JSON.stringify(card)).not.toContain(code);

    const soon = await send(boy, pickup.id);
    expect(soon.status).toBe(409);
    expect(soon.body.message).toMatch(/^Wait \d+ seconds, then send a new code\.$/);
    await afterTheWait(pickup.id);
    expect((await send(boy, pickup.id)).status).toBe(200);
    expect(await doorCodeMessages()).toHaveLength(2);
  });

  it("shows on his phone where its WhatsApp has got to, and why it couldn't go", async () => {
    const { pickup, boy } = await setup();
    await send(boy, pickup.id);
    const shown = async () => (await boy.get(`/api/field/jobs/${pickup.id}`)).body.otp.message;
    expect(await shown()).toEqual({ status: "QUEUED", error: null });

    // As the outbox records it when the provider refuses it.
    const [message] = await doorCodeMessages();
    const error = "That number isn't on WhatsApp, or isn't written correctly.";
    await prisma.outboundMessage.update({ where: { id: message!.id }, data: { status: "FAILED", error, failedAt: new Date() } });
    expect(await shown()).toEqual({ status: "FAILED", error });

    // A new code has its own message: his phone follows that one.
    await afterTheWait(pickup.id);
    expect((await send(boy, pickup.id)).body.otp.message).toEqual({ status: "QUEUED", error: null });
  });

  it("is checked: a typo isn't a try; wrong ones count down; then it's dead, or expires; the right one confirms", async () => {
    const { pickup, boy } = await setup();
    const first = await check(boy, pickup.id, "123456");
    expect(first.status).toBe(409);
    expect(first.body.message).toBe("Send the code first.");

    await send(boy, pickup.id);
    const code = await lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const typo = await check(boy, pickup.id, "12345");
    expect(typo.status).toBe(400);
    expect(typo.body.issues.code).toEqual(["Type the 6 digits the client reads out."]);

    const answers = [];
    for (let i = 0; i < 5; i++) answers.push((await check(boy, pickup.id, wrong)).body.issues.code[0]);
    expect(answers).toEqual([
      "That's not the code. 4 tries left.",
      "That's not the code. 3 tries left.",
      "That's not the code. 2 tries left.",
      "That's not the code. 1 try left.",
      "That's not the code, and that was the last try. Send a new code.",
    ]);
    expect((await prisma.fieldJob.findUniqueOrThrow({ where: { id: pickup.id } })).otpTries).toBe(5);
    expect(await prisma.auditLog.count({ where: { action: "field.otp.wrong" } })).toBe(5);
    expect((await check(boy, pickup.id, code)).body.issues.code).toEqual(["Too many wrong tries. Send a new code."]);

    await afterTheWait(pickup.id);
    await send(boy, pickup.id);
    const second = await lastCode();
    expect((await prisma.fieldJob.findUniqueOrThrow({ where: { id: pickup.id } })).otpTries).toBe(0);
    await prisma.fieldJob.update({ where: { id: pickup.id }, data: { otpExpiresAt: new Date(Date.now() - 1000) } });
    expect((await check(boy, pickup.id, second)).body.issues.code).toEqual(["This code has expired. Send a new one."]);

    await afterTheWait(pickup.id);
    await send(boy, pickup.id);
    const third = await lastCode();
    const ok = await check(boy, pickup.id, third);
    expect(ok.status).toBe(200);
    expect(ok.body.otp.confirmedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "field.otp.confirm" } })).toBe(1);
    // Confirmed stays confirmed; no new code after it.
    expect((await check(boy, pickup.id, wrong)).status).toBe(200);
    expect((await send(boy, pickup.id)).body.message).toBe("The client has already confirmed with the code.");
  });
});

describe("his selfie", () => {
  it("is a JPEG or PNG, really, within the limit, for his own pickup on today's run", async () => {
    const { pickup, boy, ramesh, c } = await setup();
    const res = await selfie(boy, pickup.id, PNG, "image/png");
    expect(res.status).toBe(200);
    expect(res.body.selfie).toMatchObject({ fileName: `${c.caseNo}_selfie.png` });
    const file = await prisma.caseFile.findUniqueOrThrow({ where: { id: res.body.selfie.id } });
    expect(file).toMatchObject({ enquiryId: c.id, kind: "FIELD_SELFIE", pageCount: null, uploadedById: ramesh.id });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload" } })).toMatchObject({ after: { kind: "FIELD_SELFIE", jobId: pickup.id } });

    expect((await selfie(boy, pickup.id, JPEG, "text/plain")).status).toBe(415);
    const lying = await selfie(boy, pickup.id, PNG, "image/jpeg");
    expect(lying.status).toBe(400);
    expect(lying.body.message).toBe("This isn't a JPEG photo. Take it again.");
    await prisma.setting.create({ data: { key: "field", value: { otpMinutes: 10, otpTries: 5, otpResendSeconds: 60, selfieMaxMb: 1 } } });
    const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024 + 1, 1)]);
    expect((await selfie(boy, pickup.id, big)).status).toBe(413);

    await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    expect((await selfie(await loginAs("98250 00002"), pickup.id)).status).toBe(404);
    // The photo of the person receiving is a delivery's (phase 5).
    const receiver = await boy.post(`/api/field/jobs/${pickup.id}/receiver-photo`).set("Content-Type", "image/jpeg").send(JPEG);
    expect(receiver.status).toBe(409);
    expect(receiver.body.message).toBe("Only a delivery is handed over this way.");
  });
});

describe("Picked up (phase 4b)", () => {
  it("needs the client's code, his selfie, the booklets and the place; records the proof and the intake count", async () => {
    const { pickup, boy, aarti, c, ramesh } = await setup();
    const body = { booklets: { current: 2, old: 1 }, place: PLACE };

    const early = await done(boy, pickup.id, { ...body, selfieId: "none" });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("The client hasn't confirmed with the code yet.");
    await send(boy, pickup.id);
    expect((await check(boy, pickup.id, await lastCode())).status).toBe(200);

    expect((await done(boy, pickup.id, { place: PLACE, selfieId: "x" })).body.issues.booklets).toEqual(["Count the booklets: current and old (0 if none)."]);
    expect((await done(boy, pickup.id, { ...body, booklets: { current: 51, old: 0 }, selfieId: "x" })).status).toBe(400);
    expect((await done(boy, pickup.id, { booklets: body.booklets, selfieId: "x" })).body.issues.place).toBeDefined();
    const noSelfie = await done(boy, pickup.id, { ...body, selfieId: "not-a-selfie" });
    expect(noSelfie.status).toBe(400);
    expect(noSelfie.body.issues.selfieId).toEqual(["Take your selfie at the door."]);

    const taken = (await selfie(boy, pickup.id)).body.selfie;
    const res = await done(boy, pickup.id, { ...body, selfieId: taken.id });
    expect(res.status).toBe(200);
    expect(res.body.stop).toMatchObject({ status: "DONE" });

    const row = await prisma.fieldJob.findUniqueOrThrow({ where: { id: pickup.id } });
    expect(row).toMatchObject({ status: "DONE", bookletsCurrent: 2, bookletsOld: 1, selfieId: taken.id, latitude: 21.1959, longitude: 72.7933, accuracyM: 12 });
    expect(await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({ bookletsCurrent: 2, bookletsOld: 1 });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.done" } })).toMatchObject({
      actorId: ramesh.id,
      entityId: pickup.id,
      after: { status: "DONE", booklets: { current: 2, old: 1 }, selfieId: taken.id, place: PLACE },
    });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.case.update", actorId: ramesh.id } })).toMatchObject({
      before: { bookletsCurrent: null, bookletsOld: null },
      after: { bookletsCurrent: 2, bookletsOld: 1 },
    });

    // A case at Step 1 moved to Documents, as any Step 2 write does; the office sees the proof and opens the selfie.
    const seen = (await aarti.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect(seen.stage.code).toBe("DOCUMENTS");
    expect(seen.booklets).toEqual({ current: 2, old: 1 });
    expect(seen.fieldJobs[0]).toMatchObject({
      status: "DONE",
      counted: { current: 2, old: 1 },
      selfie: { id: taken.id, fileName: `${c.caseNo}_selfie.jpg` },
      place: { lat: 21.1959, lng: 72.7933, accuracy: 12 },
    });
    expect(seen.fieldJobs[0].otpConfirmedAt).not.toBeNull();
    expect((await aarti.get(`/api/visa/cases/${c.caseNo}/files/${taken.id}/link`)).status).toBe(200);

    expect((await done(boy, pickup.id, { ...body, selfieId: taken.id })).body.message).toBe("This stop is already recorded.");
    expect((await boy.get("/api/field/jobs")).body).toMatchObject({ done: 1, total: 1 });
  });

  it("refuses a selfie taken for another stop or used already, and a delivery", async () => {
    const { pickup, boy, job } = await setup();
    const second = await job({ slotId: (await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "MORNING" } })).id });
    for (const id of [pickup.id, second.id]) {
      await send(boy, id);
      await check(boy, id, await lastCode());
    }
    const taken = (await selfie(boy, pickup.id)).body.selfie;
    expect((await done(boy, pickup.id, { booklets: { current: 1, old: 0 }, selfieId: taken.id, place: PLACE })).status).toBe(200);
    // The same picture again, for the other stop: it's this case's, but already proves the first.
    const reused = await done(boy, second.id, { booklets: { current: 1, old: 0 }, selfieId: taken.id, place: PLACE });
    expect(reused.status).toBe(400);
    expect(reused.body.issues.selfieId).toEqual(["Take your selfie at the door."]);

    // "Picked up" is a pickup's; a delivery is handed over (phase 5).
    const delivery = await job({ kind: "DELIVERY" });
    expect((await done(boy, delivery.id, { booklets: { current: 1, old: 0 }, selfieId: taken.id, place: PLACE })).body.message).toBe(
      "Only a pickup is recorded this way.",
    );
  });
});

describe("the field settings", () => {
  it("are the Head's or an HOD's to change, checked, and the code follows them", async () => {
    const { pickup, boy } = await setup();
    const staff = await visaStaff();
    expect((await staff.get("/api/masters/field-settings")).body.settings).toEqual({ otpMinutes: 10, otpTries: 5, otpResendSeconds: 60, selfieMaxMb: 5 });
    expect((await staff.put("/api/masters/field-settings").send({ otpMinutes: 15 })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/masters/field-settings").send({ otpTries: 0 })).status).toBe(400);
    const res = await hod.put("/api/masters/field-settings").send({ otpMinutes: 15 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ otpMinutes: 15, otpTries: 5, otpResendSeconds: 60, selfieMaxMb: 5 });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update", entityId: "field" } })).toMatchObject({
      before: { otpMinutes: 10 },
      after: { otpMinutes: 15 },
    });

    const { otp } = (await send(boy, pickup.id)).body;
    expect(Date.parse(otp.expiresAt) - Date.parse(otp.sentAt)).toBe(15 * 60_000);
    expect((await doorCodeMessages()).at(-1)!.body).toContain("This code expires in 15 minutes.");
  });
});

describe("the database", () => {
  it("keeps a finished job's time and place, a failed one's reason, a done one's proof, and the code's columns together", async () => {
    const { pickup, ramesh, c } = await setup();
    const set = (data: Record<string, unknown>) => prisma.fieldJob.update({ where: { id: pickup.id }, data: data as never });
    const finished = { finishedAt: new Date(), latitude: 21.1959, longitude: 72.7933, accuracyM: 12 };
    const notHome = (await prisma.fieldFailReason.findUniqueOrThrow({ where: { code: "CLIENT_NOT_HOME" } })).id;
    const selfie = await prisma.caseFile.create({
      data: { enquiryId: c.id, kind: "FIELD_SELFIE", storageKey: "t/selfie", fileName: "s.jpg", sizeBytes: 1, uploadedById: ramesh.id },
    });
    const now = new Date();
    const code = { otpHash: "h", otpSentAt: now, otpSentTo: "+919825041299", otpExpiresAt: now };

    await expect(set({ finishedAt: new Date() })).rejects.toThrow(/FieldJob_finished/);
    await expect(set({ status: "FAILED", failReasonId: notHome, ...finished, latitude: 95 })).rejects.toThrow(/FieldJob_place/);
    await expect(set({ status: "FAILED", ...finished })).rejects.toThrow(/FieldJob_failed/);
    await expect(set({ status: "DONE", ...finished, ...code, otpConfirmedAt: now, bookletsCurrent: 1, bookletsOld: 0 })).rejects.toThrow(/FieldJob_done/);
    await expect(set({ status: "DONE", ...finished, ...code, bookletsCurrent: 1, bookletsOld: 0, selfieId: selfie.id })).rejects.toThrow(/FieldJob_done/);
    await expect(set({ status: "DONE", ...finished, ...code, otpConfirmedAt: now, bookletsCurrent: 51, bookletsOld: 0, selfieId: selfie.id })).rejects.toThrow(
      /FieldJob_booklets_range/,
    );
    await expect(set({ otpHash: "h" })).rejects.toThrow(/FieldJob_otp/);
    await expect(set({ otpConfirmedAt: now })).rejects.toThrow(/FieldJob_otp/);
    await set({ status: "DONE", ...finished, ...code, otpConfirmedAt: now, bookletsCurrent: 1, bookletsOld: 0, selfieId: selfie.id });
  });
});
