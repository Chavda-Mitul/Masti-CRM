import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { addDays, istDateTimeToUtc, istToday } from "../../lib/dates";
import { saveSetting } from "../../lib/settings";
import { isHodOf, type DepartmentCode } from "../auth/permissions";
import { viewableDepartments } from "../enquiries/enquiries.service";
import { TO_HAND_BACK } from "../enquiries/visibility";
import { previousOpenDay } from "../holidays/blockedDays";
import type { Actor, UserWithDepartments } from "../users/user";
import type { UpdateTodaySettingsInput } from "./today.schemas";
import { getTodaySettings, TODAY_SETTINGS_KEY } from "./today.settings";

// The Today page: one person's day (docs/decisions/0017-today-dashboard.md). In India time:
// - Running late: due before now
// - Due today: due from now until midnight tonight; the late ones are counted apart, as in the demo's "8 … and 2 …"
// - New enquiries: created since the cut-off time on the previous office day (Sunday and office holidays skipped)
// Whose cases (Decision 1): the Head's are every department's; an HOD's the whole of each department they lead; anyone
// else's (and an HOD's elsewhere) only the ones they own. View-only staff own none, so their day is empty, like their
// Follow-ups badge.

export type TodayScopeKind = "ALL" | "DEPARTMENTS" | "MINE";

/**
 * A case someone has to act on (Decision 2): open or postponed (due again on its resume day), or cancelled with its
 * passports still to hand back (docs/decisions/0006-visa-documents.md amendment 15). Closed cases have no due time.
 */
const needsSomeone: Prisma.EnquiryWhereInput = {
  OR: [{ status: { in: ["OPEN", "POSTPONED"] } }, { status: "CANCELLED", ...TO_HAND_BACK }],
};

/** The cases on this user's Today, and how the page names them. */
async function todayScope(user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const led = departments.filter((d) => isHodOf(user, d.code as DepartmentCode));
  const others = departments.filter((d) => !isHodOf(user, d.code as DepartmentCode));
  const or: Prisma.EnquiryWhereInput[] = [];
  if (led.length > 0) or.push({ departmentId: { in: led.map((d) => d.id) } });
  if (others.length > 0) or.push({ departmentId: { in: others.map((d) => d.id) }, ownerId: user.id });
  const kind: TodayScopeKind = user.type === "HEAD" ? "ALL" : led.length > 0 ? "DEPARTMENTS" : "MINE";
  return {
    where: or.length > 0 ? { OR: or } : { id: { in: [] } },
    scope: { kind, departments: led.map((d) => d.name) },
  };
}

/** Where "New enquiries" start (Decision 3): the setting's time on the last office day before today. */
async function newSince(now: Date) {
  const { newSinceAt } = await getTodaySettings();
  const day = await previousOpenDay(addDays(istToday(now), -1), { office: true });
  return istDateTimeToUtc(day, newSinceAt);
}

/** The banner's sentence and the tiles: what's due today, what's late (and the oldest), what came in. */
export async function todaySummary(user: UserWithDepartments, now: Date = new Date()) {
  const [{ where, scope }, since] = await Promise.all([todayScope(user), newSince(now)]);
  const midnight = istDateTimeToUtc(addDays(istToday(now), 1), "00:00");
  const due = (dueAt: { gte?: Date; lt: Date }): Prisma.EnquiryWhereInput => ({ AND: [where, needsSomeone, { dueAt }] });

  const [dueToday, late, oldest, newEnquiries] = await Promise.all([
    prisma.enquiry.count({ where: due({ gte: now, lt: midnight }) }),
    prisma.enquiry.count({ where: due({ lt: now }) }),
    prisma.enquiry.aggregate({ where: due({ lt: now }), _min: { dueAt: true } }),
    // Whatever happened to them since: "new" is what came in.
    prisma.enquiry.count({ where: { AND: [where, { createdAt: { gte: since } }] } }),
  ]);
  return { scope, dueToday, late, oldestLateAt: oldest._min.dueAt, newEnquiries, newSince: since };
}

export async function getSettings() {
  return getTodaySettings();
}

/** The Head changes the cut-off (the route checks). One audited change, as setting.update. */
export async function updateSettings(input: UpdateTodaySettingsInput, actor: Actor) {
  const before = await getTodaySettings();
  const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (JSON.stringify(after) === JSON.stringify(before)) return before;
  await prisma.$transaction((tx) => saveSetting(tx, { key: TODAY_SETTINGS_KEY, before, after, actorId: actor.user.id, ip: actor.ip }));
  return getTodaySettings();
}
