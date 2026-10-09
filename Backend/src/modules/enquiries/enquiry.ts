import type { DepartmentStage } from "../../../generated/prisma/client";

// Shapes shared by every department's enquiry (the All enquiries list and each department's case view).

/** Where a case is: "Step 1 of 8 · Enquiry" plus the stage's status and next-step labels. */
export function toStageRef(stage: DepartmentStage, stageCount: number) {
  return {
    code: stage.code,
    name: stage.name,
    step: stage.sortOrder,
    of: stageCount,
    statusLabel: stage.statusLabel,
    nextStepLabel: stage.nextStepLabel,
  };
}

export type StageRef = ReturnType<typeof toStageRef>;
