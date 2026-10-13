import { prisma } from "../../config/prisma";
import { saveSetting } from "../../lib/settings";
import type { Actor } from "../users/user";
import type { UpdateCompanyDetailsInput } from "./company.schemas";
import { COMPANY_DETAILS_KEY, getCompanyDetails } from "./company.settings";

/** The Head only (the route checks). Only a real change is written, audited as setting.update. */
export async function updateCompanyDetails(input: UpdateCompanyDetailsInput, actor: Actor) {
  const before = await getCompanyDetails();
  const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (JSON.stringify(after) === JSON.stringify(before)) return before;
  await prisma.$transaction((tx) => saveSetting(tx, { key: COMPANY_DETAILS_KEY, before, after, actorId: actor.user.id, ip: actor.ip }));
  return getCompanyDetails();
}
