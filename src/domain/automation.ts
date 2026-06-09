import { z } from "zod";

export const AutomationModeSchema = z.enum(["DRAFT_ONLY", "HUMAN_APPROVAL", "AUTOMATIC"]);
export type AutomationMode = z.infer<typeof AutomationModeSchema>;

export const DraftDeliveryStatusSchema = z.enum(["DRAFT_ONLY", "PENDING_APPROVAL", "SENT", "BLOCKED"]);
export type DraftDeliveryStatus = z.infer<typeof DraftDeliveryStatusSchema>;
