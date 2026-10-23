import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { istToday } from "../../lib/dates";
import { fileNamePart } from "../../lib/fileNames";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/httpError";
import { imageSize, imageType } from "../../lib/images";
import { logger } from "../../lib/logger";
import { MB, pdfPageCount } from "../../lib/pdf";
import { deleteObject, presignGet, putObject } from "../../lib/storage";
import { isHodOfAny } from "../auth/permissions";
import { getCompanyDetails } from "../company/company.settings";
import { CLIENT_DOCUMENTS_KEPT } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import type { Actor, UserWithDepartments } from "../users/user";
import { assertCanSeeClient } from "./access";
import {
  FILE_TYPE_OF,
  fileTypeProblem,
  photoPixelsProblem,
  photoShapeProblem,
  SCAN_TYPES,
  scanFileProblem,
  type AddClientDocumentQuery,
  type ScanRules,
  type ScanType,
} from "./clients.schemas";
import { getClientSettings } from "./clients.settings";
import { SCAN_RULE_SELECT, scanRulesOf } from "./scanRules";

// The client document vault (docs/decisions/0016-client-documents.md): scans of a client's papers (passport, Aadhaar
// card, PAN card…), per family member, kept in the private bucket for good (rule 4) and reused on later cases. On the
// client page the Head and an HOD who can open the client see its whole list, add scans and open them (Decision 4,
// amended 21 Oct 2026). The core (saving a scan, opening one, the current scan of a paper) is shared with a visa case's checklist
// (Decision 5, visaCaseScans.service.ts), whose own rules say who may. Every save and every opening is audited. Nothing
// is changed or deleted: a newer scan of a paper for the same person becomes the current one, and the older ones stay.

/**
 * The Head and HODs see a client's documents (Decision 4), of a client they can open: a Holidays HOD not those of a
 * family that only has visa cases (amended 21 Oct 2026, 0004 amendment 4). Field staff never reach here.
 */
async function assertCanSeeDocuments(user: UserWithDepartments, clientId: string) {
  if (!isHodOfAny(user)) throw forbidden("Only an HOD or the Head can see a client's documents.");
  await assertCanSeeClient(user, clientId);
}

const scanSelect = {
  id: true,
  memberId: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  pageCount: true,
  uploadedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  member: { select: { id: true, name: true, sortOrder: true, createdAt: true, archivedAt: true, relation: { select: { name: true } } } },
  document: { select: { id: true, name: true, sortOrder: true } },
} satisfies Prisma.ClientDocumentSelect;

type ScanRow = Prisma.ClientDocumentGetPayload<{ select: typeof scanSelect }>;

function toScan(row: ScanRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    uploadedAt: row.uploadedAt,
    uploadedBy: row.uploadedBy,
  };
}

/**
 * The client's whole vault, for the Documents card. Groups: the client's own papers first, then each family member in
 * the family's order, anyone taken off the list last; only people with scans appear. In each group, the papers in the
 * document master's order, each with its current scan and the older ones, newest first. Also the papers a scan can be
 * (the active document master, which the masters API shows only to Visa) and the largest scan, for the Add form.
 */
async function vaultOf(clientId: string) {
  const [rows, papers, settings] = await Promise.all([
    prisma.clientDocument.findMany({ where: { clientId }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], select: scanSelect }),
    prisma.documentMaster.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, ...SCAN_RULE_SELECT },
    }),
    getClientSettings(),
  ]);

  const groups = new Map<string, { member: ScanRow["member"]; papers: Map<number, { paper: ScanRow["document"]; scans: ScanRow[] }> }>();
  for (const row of rows) {
    const key = row.memberId ?? "";
    const group = groups.get(key) ?? { member: row.member, papers: new Map() };
    groups.set(key, group);
    const paper = group.papers.get(row.document.id) ?? { paper: row.document, scans: [] };
    group.papers.set(row.document.id, paper);
    paper.scans.push(row); // Newest first: the rows came that way.
  }

  const rank = (m: ScanRow["member"]) => (m === null ? 0 : m.archivedAt ? 2 : 1);
  return {
    groups: [...groups.values()]
      .sort(
        (a, b) =>
          rank(a.member) - rank(b.member) ||
          (a.member?.sortOrder ?? 0) - (b.member?.sortOrder ?? 0) ||
          (a.member?.createdAt.getTime() ?? 0) - (b.member?.createdAt.getTime() ?? 0),
      )
      .map(({ member, papers: byPaper }) => ({
        member: member && { id: member.id, name: member.name, relation: member.relation.name, archived: member.archivedAt !== null },
        papers: [...byPaper.values()]
          .sort((a, b) => a.paper.sortOrder - b.paper.sortOrder || a.paper.name.localeCompare(b.paper.name))
          .map(({ paper, scans }) => ({
            paper: { id: paper.id, name: paper.name },
            current: toScan(scans[0]!),
            older: scans.slice(1).map(toScan),
          })),
      })),
    /** With each paper's upload rules, which the Add form checks a picked file against first. */
    papers: papers.map((p) => ({ id: p.id, name: p.name, rules: scanRulesOf(p) })),
    maxMb: settings.documents.maxMb,
  };
}

export async function listClientDocuments(clientId: string, user: UserWithDepartments) {
  await assertCanSeeDocuments(user, clientId);
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw notFound("Client not found.");
  return vaultOf(clientId);
}

/**
 * Where a new scan goes: the client, the person (on its family list, not taken off it; none for the client's own
 * paper) and the paper (one the document master still offers). A visa case's "Save scan" checks the same.
 */
export async function scanTarget(db: Db, clientId: string, { documentId, memberId }: AddClientDocumentQuery) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) throw notFound("Client not found.");
  let member: { id: string; name: string } | null = null;
  if (memberId) {
    const row = await db.clientMember.findFirst({ where: { id: memberId, clientId }, select: { id: true, name: true, archivedAt: true } });
    if (!row) throw notFound("Person not found on this client.");
    if (row.archivedAt) throw badRequest("This person was taken off the family list.");
    member = { id: row.id, name: row.name };
  }
  const paper = await db.documentMaster.findUnique({ where: { id: documentId }, select: { id: true, name: true, isActive: true, ...SCAN_RULE_SELECT } });
  if (!paper) throw notFound("Paper not found.");
  if (!paper.isActive) throw badRequest(`"${paper.name}" is switched off in the document list.`);
  return { client, member, paper: { id: paper.id, name: paper.name, rules: scanRulesOf(paper) } };
}

type ScanPaper = { name: string; rules: ScanRules };

/** "Photos", in quotes, as the rules' messages name a paper. */
const paperWord = (paper: ScanPaper) => `"${paper.name}"`;

/**
 * Before the upload is read: a type the paper doesn't take is refused, and the largest scan is the paper's own, else
 * the shared one (the setting clients.documents.maxMb), with what a bigger upload is told.
 */
export async function scanLimit(paper: ScanPaper, contentType: ScanType) {
  const wrongType = fileTypeProblem(paperWord(paper), paper.rules, FILE_TYPE_OF[contentType]);
  if (wrongType) throw new HttpError(415, wrongType);
  const maxMb = paper.rules.maxSizeMb ?? (await getClientSettings()).documents.maxMb;
  return { maxBytes: maxMb * MB, tooBig: `${paperWord(paper)} can be at most ${maxMb} MB. Scan it at a lower resolution and upload it again.` };
}

/**
 * Before the upload is read: this user may add scans, the client, person and paper are right, and the paper takes this
 * type. Refusing here means a wrong upload is never held in memory.
 */
export async function clientDocumentLimit(clientId: string, query: AddClientDocumentQuery, contentType: ScanType, user: UserWithDepartments) {
  await assertCanSeeDocuments(user, clientId);
  const { paper } = await scanTarget(prisma, clientId, query);
  return scanLimit(paper, contentType);
}

/** The scan is what the upload says: a PDF that opens (its pages are returned), or a real PNG or JPEG photo. */
async function checkScan(bytes: Buffer, contentType: ScanType): Promise<number | null> {
  if (bytes.length === 0) throw badRequest("Pick the file to upload.");
  if (contentType === "application/pdf") return pdfPageCount(bytes);
  if (imageType(bytes) !== contentType) {
    throw badRequest(`This isn't a ${contentType === "image/png" ? "PNG" : "JPEG"} image. Save it as a PDF, JPEG or PNG and upload it again.`);
  }
  return null;
}

/**
 * The paper's upload rules on the file itself (0016 Amendment 1): its type and size again (the paper may have changed
 * since the upload began), then a JPG's or PNG's shape and pixels when the paper has a photo size or a smallest or
 * largest photo. A PDF's aren't checked.
 */
async function checkScanRules(paper: ScanPaper, contentType: ScanType, bytes: Buffer) {
  const { maxMb } = (await getClientSettings()).documents;
  const problem = scanFileProblem(paperWord(paper), paper.rules, maxMb, { type: FILE_TYPE_OF[contentType], sizeBytes: bytes.length });
  if (problem) throw badRequest(problem);
  const { photoWidthMm, minWidthPx, maxWidthPx } = paper.rules;
  if (contentType === "application/pdf" || (photoWidthMm === null && minWidthPx === null && maxWidthPx === null)) return;
  const pixels = imageSize(bytes, contentType);
  if (!pixels) throw badRequest("Couldn't read this photo's size. Save it again as a JPG or PNG and upload it again.");
  const wrongPhoto = photoShapeProblem(paperWord(paper), paper.rules, pixels) ?? photoPixelsProblem(paperWord(paper), paper.rules, pixels);
  if (wrongPhoto) throw badRequest(wrongPhoto);
}

/** "Aarav-Mehta_Passport_2026-10-17.pdf" ⚠️: whose it is (the client, for their own paper), the paper, the day saved. */
function scanFileName(owner: string, paper: string, contentType: ScanType) {
  const parts = [fileNamePart(owner), fileNamePart(paper), istToday()].filter(Boolean);
  return `${parts.join("_")}.${SCAN_TYPES[contentType]}`;
}

/** Where a scan was saved or opened from, for the audit: a visa case's checklist (Decision 5); none for the client page. */
interface ScanSource {
  caseNo: string;
}

/** A scan saved from a visa case: the client's message about it shows on that case too. */
interface SavedFromCase extends ScanSource {
  enquiryId: string;
}

/**
 * Saves a scan in the client's vault, under a bucket key no other upload shares. The caller checks who may first: the
 * client page lets HODs and the Head, a visa case whoever can tick its papers. The file and the paper's upload rules are
 * checked before anything is kept. The bucket upload happens first, so a slow upload holds no transaction. In the
 * transaction the person and paper are checked again; if they fail now (taken off the list, switched off), the row
 * isn't saved and the object is removed again.
 */
export async function saveClientScan(
  clientId: string,
  query: AddClientDocumentQuery,
  contentType: ScanType,
  bytes: Buffer,
  actor: Actor,
  from?: SavedFromCase,
) {
  const { client, member, paper } = await scanTarget(prisma, clientId, query);
  const pageCount = await checkScan(bytes, contentType);
  await checkScanRules(paper, contentType, bytes);
  const fileName = scanFileName(member?.name ?? client.name, paper.name, contentType);
  const storageKey = `clients/${client.id}/${randomUUID()}.${SCAN_TYPES[contentType]}`;
  await putObject(storageKey, bytes, contentType);

  try {
    await prisma.$transaction(async (tx) => {
      await scanTarget(tx, clientId, query);
      const memberId = member?.id ?? null;
      const previous = await tx.clientDocument.findFirst({
        where: { clientId: client.id, memberId, documentId: paper.id },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const scan = await tx.clientDocument.create({
        data: {
          clientId: client.id,
          memberId,
          documentId: paper.id,
          storageKey,
          fileName,
          contentType,
          sizeBytes: bytes.length,
          pageCount,
          uploadedById: actor.user.id,
        },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "client.document.add",
          entityType: "ClientDocument",
          entityId: scan.id,
          clientId: client.id,
          after: {
            paper: paper.name,
            person: member?.name ?? null,
            fileName,
            contentType,
            sizeBytes: scan.sizeBytes,
            pageCount,
            storageKey,
            replaces: previous?.id ?? null,
            ...(from && { case: from.caseNo }),
          },
          ip: actor.ip,
        },
        tx,
      );
      // Message 17 (Decision 6): the client's first scan tells them we keep a copy, once ever. Saved from a case, it shows
      // on that case's "Sent to the client" card.
      await queueMessage(tx, {
        template: CLIENT_DOCUMENTS_KEPT,
        clientId: client.id,
        enquiryId: from?.enquiryId ?? null,
        key: `${CLIENT_DOCUMENTS_KEPT}:${client.id}`,
        variables: { client_name: client.name, office_phone: (await getCompanyDetails(tx)).phone },
      });
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
}

/** The client page's "Add a scan": HODs and the Head. Returns the whole vault. */
export async function addClientDocument(clientId: string, query: AddClientDocumentQuery, contentType: ScanType, bytes: Buffer, actor: Actor) {
  await assertCanSeeDocuments(actor.user, clientId);
  await saveClientScan(clientId, query, contentType, bytes, actor);
  return vaultOf(clientId);
}

/** A short-lived link to one scan (rule 4), made per click and never stored, with the audit of its opening. */
export async function openClientScan(scan: { id: string; clientId: string; storageKey: string; fileName: string }, actor: Actor, from?: ScanSource) {
  const link = await presignGet(scan.storageKey, { fileName: scan.fileName });
  await audit({
    actorId: actor.user.id,
    action: "client.document.open",
    entityType: "ClientDocument",
    entityId: scan.id,
    clientId: scan.clientId,
    after: { fileName: scan.fileName, expiresAt: link.expiresAt, ...(from && { case: from.caseNo }) },
    ip: actor.ip,
  });
  return link;
}

/** What opening a scan needs. */
const openSelect = { id: true, clientId: true, storageKey: true, fileName: true } satisfies Prisma.ClientDocumentSelect;

/** Opens one of the client's scans from the client page: HODs and the Head. */
export async function openClientDocument(clientId: string, clientDocumentId: string, actor: Actor) {
  await assertCanSeeDocuments(actor.user, clientId);
  const scan = await prisma.clientDocument.findFirst({ where: { id: clientDocumentId, clientId }, select: openSelect });
  if (!scan) throw notFound("Document not found on this client.");
  return openClientScan(scan, actor);
}

/** The current scan of a paper for a person (the newest, as the vault shows it), ready to open; null if none. */
export function currentScan(db: Db, memberId: string, documentId: number) {
  return db.clientDocument.findFirst({
    where: { memberId, documentId },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    select: { ...openSelect, uploadedAt: true },
  });
}

/** How currentScansOf keys a person's paper. */
export const scanKey = (memberId: string, documentId: number) => `${memberId}:${documentId}`;

/**
 * The current scan of every paper for these people, keyed by scanKey: what a visa case shows as "On file" (Decision
 * 5). One query; the newest of each person's paper wins.
 */
export async function currentScansOf(memberIds: string[]) {
  const current = new Map<string, { id: string; uploadedAt: Date; contentType: string; pageCount: number | null; sizeBytes: number }>();
  if (memberIds.length === 0) return current;
  const rows = await prisma.clientDocument.findMany({
    where: { memberId: { in: memberIds } },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    select: { id: true, memberId: true, documentId: true, uploadedAt: true, contentType: true, pageCount: true, sizeBytes: true },
  });
  for (const { memberId, documentId, ...scan } of rows) {
    const key = scanKey(memberId!, documentId);
    if (!current.has(key)) current.set(key, scan);
  }
  return current;
}

export type CurrentScans = Awaited<ReturnType<typeof currentScansOf>>;
