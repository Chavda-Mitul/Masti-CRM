import { prisma } from "../../config/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { clientScanLimit, currentScan, openClientScan, saveClientScan, scanTarget } from "../clients/clientDocuments.service";
import type { ScanType } from "../clients/clients.schemas";
import type { Actor } from "../users/user";
import { COLLECTING, findVisibleCase, loadCase } from "./caseLock";
import { getVisaCaseById } from "./visa.service";

// The client document vault in Step 2 (docs/decisions/0016-client-documents.md Decision 5), the case's side: "Save
// scan" keeps one of a traveller's papers in the client's vault for later trips, and the case opens the copy a paper is
// on file from. The case's rules say who may, not the vault's: whoever can tick the case's papers saves (Steps 1–2);
// whoever can see the case opens (the processor prints it for the file in Step 3). Ticking a paper On file is
// updateDocument (visaSteps.service.ts).

/** One of the case's papers, with the traveller's linked person (if any). */
async function paperOf(enquiryId: string, documentId: string) {
  const doc = await prisma.visaCaseDocument.findFirst({
    where: { id: documentId, traveller: { caseId: enquiryId } },
    select: { documentId: true, requirement: true, clientDocumentId: true, traveller: { select: { memberId: true } } },
  });
  if (!doc) throw notFound("Document not found on this case.");
  return doc;
}

/**
 * Where a scan saved from this paper goes: the client's vault, under the traveller's person and the paper. Only while
 * this user may tick the case's papers; never for a thing we arrange.
 */
async function scanFromCase(caseNo: string, documentId: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  const doc = await paperOf(enquiry.id, documentId);
  if (doc.requirement === "ARRANGED_BY_US") throw badRequest("We arrange this one, so it isn't kept in the client's documents.");
  if (!doc.traveller.memberId) throw badRequest("Name the traveller first: scans are kept per person.");
  return { enquiry, query: { documentId: doc.documentId, memberId: doc.traveller.memberId } };
}

/**
 * Before the upload is read: the case and the paper are right, and the vault takes it (the person still on the family
 * list, the paper switched on). The setting gives the size limit (clients.documents.maxMb).
 */
export async function caseScanLimit(caseNo: string, documentId: string, actor: Actor) {
  const { enquiry, query } = await scanFromCase(caseNo, documentId, actor);
  await scanTarget(prisma, enquiry.clientId, query);
  return clientScanLimit();
}

/** "Save scan": keeps the paper in the client's vault, audited with the case. It doesn't tick the paper. */
export async function saveCaseScan(caseNo: string, documentId: string, contentType: ScanType, bytes: Buffer, actor: Actor) {
  const { enquiry, query } = await scanFromCase(caseNo, documentId, actor);
  await saveClientScan(enquiry.clientId, query, contentType, bytes, actor, { caseNo: enquiry.caseNo, enquiryId: enquiry.id });
  return getVisaCaseById(enquiry.id);
}

/**
 * A short-lived link to a paper's copy: the scan an On file paper came from, or else the current copy for the
 * traveller's person. Opening is audited with the case.
 */
export async function openCaseScan(caseNo: string, documentId: string, actor: Actor) {
  const enquiry = await findVisibleCase(caseNo, actor.user);
  const doc = await paperOf(enquiry.id, documentId);
  const scan = doc.clientDocumentId
    ? await prisma.clientDocument.findUnique({
        where: { id: doc.clientDocumentId },
        select: { id: true, clientId: true, storageKey: true, fileName: true },
      })
    : doc.traveller.memberId
      ? await currentScan(prisma, doc.traveller.memberId, doc.documentId)
      : null;
  if (!scan) throw notFound("There's no copy of this paper on file.");
  return openClientScan(scan, actor, { caseNo: caseNo.toUpperCase() });
}
