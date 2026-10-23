import type { Prisma } from "../../../generated/prisma/client";
import type { ScanRules } from "./clients.schemas";

// A paper's upload rules (docs/decisions/0016-client-documents.md Amendment 1), read from the document master as it is
// now. A module of its own with no runtime imports: the visa case's query (visaCase.ts) spreads this select when the
// app loads, and clientDocuments.service.ts sits in an import cycle with it, so would still be undefined then.

export const SCAN_RULE_SELECT = {
  fileTypes: true,
  minSizeMb: true,
  maxSizeMb: true,
  photoWidthMm: true,
  photoHeightMm: true,
  minWidthPx: true,
  minHeightPx: true,
  maxWidthPx: true,
  maxHeightPx: true,
} satisfies Prisma.DocumentMasterSelect;

export function scanRulesOf(row: Prisma.DocumentMasterGetPayload<{ select: typeof SCAN_RULE_SELECT }>): ScanRules {
  return {
    fileTypes: row.fileTypes,
    minSizeMb: row.minSizeMb,
    maxSizeMb: row.maxSizeMb,
    photoWidthMm: row.photoWidthMm,
    photoHeightMm: row.photoHeightMm,
    minWidthPx: row.minWidthPx,
    minHeightPx: row.minHeightPx,
    maxWidthPx: row.maxWidthPx,
    maxHeightPx: row.maxHeightPx,
  };
}
