import { z } from "zod";

/** Inclusive indexes into the current participant message's displayed tokens. */
export const evidenceTokenRangeSchema = z.object({
  startToken: z.number().int().min(0).max(11999),
  endToken: z.number().int().min(0).max(11999),
}).strict();
export const participantTokenSchema = z.object({
  index: z.number().int().min(0).max(11999),
  text: z.string().min(1).max(12000),
}).strict();
export const participantTokensSchema = z.array(participantTokenSchema).max(12000);
export type EvidenceTokenRange = z.infer<typeof evidenceTokenRangeSchema>;

