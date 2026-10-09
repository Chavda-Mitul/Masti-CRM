import type { Prisma } from "../../generated/prisma/client";
import type { Db } from "../config/prisma";
import { audit } from "./audit";

export interface SettingChange {
  key: string;
  before: unknown;
  after: Prisma.InputJsonValue;
  actorId: string;
  ip: string | null;
}

/** Writes one Setting row (one row per key) and audits it as setting.update. Pass the caller's transaction. */
export async function saveSetting(tx: Db, { key, before, after, actorId, ip }: SettingChange): Promise<void> {
  await tx.setting.upsert({ where: { key }, update: { value: after }, create: { key, value: after } });
  await audit({ actorId, action: "setting.update", entityType: "Setting", entityId: key, before, after, ip }, tx);
}
