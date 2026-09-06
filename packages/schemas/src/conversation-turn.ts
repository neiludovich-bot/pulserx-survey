import { z } from "zod";
import { sourceEvidenceSpansInputSchema, websiteAnswerModelResultSchema } from "./source-evidence-spans";

export const conversationTurnContextSchema = z.object({
  version: z.literal(2), brand: z.string(), participantMessage: z.string().min(1).max(12000),
  question: z.object({ id: z.string(), text: z.string(), kind: z.enum(["guide", "priorities", "reaction", "information_need"]) }).strict().nullable(),
  discussionQuery: z.string().nullable(),
  recentTurns: z.array(z.object({ role: z.enum(["participant", "interviewer"]), content: z.string() }).strict()).max(12),
  topics: z.array(z.object({ id: z.string(), label: z.string(), status: z.string() }).strict()).max(64),
}).strict();
export const conversationObservationSchema = z.object({
  answerStatus: z.enum(["answered", "partial", "not_answered"]),
  answerEvidence: z.array(z.string().min(1).max(12000)).max(8),
  request: z.object({ text: z.string().min(1).max(4000), evidence: z.string().min(1).max(12000) }).strict().nullable(),
  priorities: z.array(z.object({ label: z.string().min(1).max(200), query: z.string().min(1).max(4000), evidence: z.string().min(1).max(12000) }).strict()).max(16),
  familiarity: z.enum(["low", "moderate", "high"]).nullable(),
  familiarityEvidence: z.string().nullable(),
  outOfScope: z.boolean(),
}).strict();
export const conversationTurnInputSchema = z.object({ context: conversationTurnContextSchema, evidence: sourceEvidenceSpansInputSchema }).strict();
export const conversationTurnResultSchema = z.object({ observation: conversationObservationSchema, answer: websiteAnswerModelResultSchema.nullable() }).strict();
export type ConversationTurnContext = z.infer<typeof conversationTurnContextSchema>;
export type ConversationObservation = z.infer<typeof conversationObservationSchema>;
