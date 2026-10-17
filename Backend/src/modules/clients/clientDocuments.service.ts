import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { istToday } from "../../lib/dates";
import { fileNamePart } from "../../lib/fileNames";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { imageType } from "../../lib/images";
import { logger } from "../../lib/logger";
import { MB, pdfPageCount } from "../../lib/pdf";
import { deleteObject, presignGet, putObject } from "../../lib/storage";
import { isHodOfAny } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { SCAN_TYPES, type AddClientDocumentQuery, type ScanType } from "./clients.schemas";
import { getClientSettings } from "./clients.settings";

// The client document vault (docs/decisions/0016-client-documents.md): scans of a client's papers (passport, Aadhaar
// card, PAN card…), per family member, kept in the private bucket for good (rule 4) and reused on later cases. This is
// the client page's side: only the Head and the HOD of any department see a client's whole list, add scans and open
// them (Decision 4). Every save and every opening is audited. Nothing is changed or deleted: a newer scan of a paper for
// the same person becomes the current one, and the older ones stay.

/** Only the Head and HODs (any department) see a client's documents (Decision 4). Field staff never reach here. */
function assertCanSeeDocuments(user: UserWithDepartments) {
  if (!isHodOfAny(user)) throw forbidden("Only an HOD or the Head can see a client's documents.");
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
    prisma.documentMaster.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
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
    papers,
    maxMb: settings.documents.maxMb,
  };
}

export async function listClientDocuments(clientId: string, user: UserWithDepartments) {
  assertCanSeeDocuments(user);
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw notFound("Client not found.");
  return vaultOf(clientId);
}

/**
 * Where a new scan goes: the client, the person (on its family list, not taken off it; none for the client's own
 * paper) and the paper (one the document master still offers).
 */
async function scanTarget(db: Db, clientId: string, { documentId, memberId }: AddClientDocumentQuery) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) throw notFound("Client not found.");
  let member: { id: string; name: string } | null = null;
  if (memberId) {
    const row = await db.clientMember.findFirst({ where: { id: memberId, clientId }, select: { id: true, name: true, archivedAt: true } });
    if (!row) throw notFound("Person not found on this client.");
    if (row.archivedAt) throw badRequest("This person was taken off the family list.");
    member = { id: row.id, name: row.name };
  }
  const paper = await db.documentMaster.findUnique({ where: { id: documentId }, select: { id: true, name: true, isActive: true } });
  if (!paper) throw notFound("Paper not found.");
  if (!paper.isActive) throw badRequest(`"${paper.name}" is switched off in the document list.`);
  return { client, member, paper: { id: paper.id, name: paper.name } };
}

/**
 * Before the upload is read: this user may add scans, and the client, person and paper are right. The setting gives the
 * size limit (clients.documents.maxMb). Refusing here means a wrong upload is never held in memory.
 */
export async function clientDocumentLimit(clientId: string, query: AddClientDocumentQuery, user: UserWithDepartments) {
  assertCanSeeDocuments(user);
  await scanTarget(prisma, clientId, query);
  const { maxMb } = (await getClientSettings()).documents;
  return { maxBytes: maxMb * MB, tooBig: `This file is over ${maxMb} MB. Scan it at a lower resolution and upload it again.` };
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

/** "Aarav-Mehta_Passport_2026-10-17.pdf" ⚠️: whose it is (the client, for their own paper), the paper, the day saved. */
function scanFileName(owner: string, paper: string, contentType: ScanType) {
  const parts = [fileNamePart(owner), fileNamePart(paper), istToday()].filter(Boolean);
  return `${parts.join("_")}.${SCAN_TYPES[contentType]}`;
}

/**
 * Saves a scan in the client's vault, under a bucket key no other upload shares. The bucket upload happens first, so a
 * slow upload holds no transaction. In the transaction the person and paper are checked again; if they fail now (taken
 * off the list, switched off), the row isn't saved and the object is removed again. Returns the whole vault.
 */
export async function addClientDocument(clientId: string, query: AddClientDocumentQuery, contentType: ScanType, bytes: Buffer, actor: Actor) {
  assertCanSeeDocuments(actor.user);
  const pageCount = await checkScan(bytes, contentType);
  const { client, member, paper } = await scanTarget(prisma, clientId, query);
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
          },
          ip: actor.ip,
        },
        tx,
      );
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
  return vaultOf(client.id);
}

/** A short-lived link to one scan (rule 4), made per click and never stored. Every opening is audited. */
export async function openClientDocument(clientId: string, clientDocumentId: string, actor: Actor) {
  assertCanSeeDocuments(actor.user);
  const scan = await prisma.clientDocument.findFirst({
    where: { id: clientDocumentId, clientId },
    select: { id: true, clientId: true, storageKey: true, fileName: true },
  });
  if (!scan) throw notFound("Document not found on this client.");

  const link = await presignGet(scan.storageKey, { fileName: scan.fileName });
  await audit({
    actorId: actor.user.id,
    action: "client.document.open",
    entityType: "ClientDocument",
    entityId: scan.id,
    clientId: scan.clientId,
    after: { fileName: scan.fileName, expiresAt: link.expiresAt },
    ip: actor.ip,
  });
  return link;
}
