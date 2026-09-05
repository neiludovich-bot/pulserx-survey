import { z } from "zod";

/** A participant speech act, distinct from a topic mentioned in an answer. */
export const sourceRequestSchema = z.object({
  kind: z.enum(["question", "explanation_request", "clarification_request"]),
  participantEvidence: z.string().min(1).max(4000),
  resolvedQuestion: z.string().min(1).max(2000),
}).strict();

export type SourceRequest = z.infer<typeof sourceRequestSchema>;
