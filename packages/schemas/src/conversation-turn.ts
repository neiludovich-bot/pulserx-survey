import { z } from "zod";
import { sourceEvidenceSpansInputSchema, websiteAnswerModelResultSchema } from "./source-evidence-spans";
import { evidenceTokenRangeSchema, participantTokensSchema } from "./evidence-ranges";
import { researchSignalSchema } from "./research-objectives";

export const conversationTurnContextSchema = z.object({
  version: z.literal(2), brand: z.string(), participantMessage: z.string().min(1).max(12000),
  closing: z.boolean().optional(),
  researchObjectives: z.array(z.object({ id: z.string(), objective: z.string(), missingCriteria: z.array(z.object({ id: z.string(), description: z.string() }).strict()) }).strict()).max(40).optional(),
  question: z.object({ id: z.string(), text: z.string(), kind: z.enum(["guide", "priorities", "reaction", "clarification", "information_need"]) }).strict().nullable(),
  discussionQuery: z.string().nullable(),
  recentTurns: z.array(z.object({ role: z.enum(["participant", "interviewer"]), content: z.string() }).strict()).max(12),
  topics: z.array(z.object({ id: z.string(), label: z.string(), status: z.string() }).strict()).max(64),
}).strict();
export const conversationObservationSchema = z.object({
  closingResponse: z.object({ intent: z.enum(["finish", "continue"]), evidence: z.string().min(1).max(12000) }).strict().nullable().optional(),
  researchSignals: z.array(researchSignalSchema).max(16).optional(),
  answerStatus: z.enum(["answered", "partial", "not_answered"]),
  answerEvidence: z.array(z.string().min(1).max(12000)).max(8),
  reactionEvidence: z.array(z.string().min(1).max(12000)).max(8).default([]),
  request: z.object({ text: z.string().min(1).max(4000), evidence: z.string().min(1).max(12000) }).strict().nullable(),
  priorities: z.array(z.object({ label: z.string().min(1).max(200), query: z.string().min(1).max(4000), evidence: z.string().min(1).max(12000) }).strict()).max(16),
  familiarity: z.enum(["low", "moderate", "high"]).nullable(),
  familiarityEvidence: z.string().nullable(),
  outOfScope: z.boolean(),
}).strict();
export const conversationObservationModelSchema = conversationObservationSchema.omit({ answerEvidence: true, reactionEvidence: true, request: true, priorities: true, familiarity: true, familiarityEvidence: true }).extend({
  closingResponse: z.object({ intent: z.enum(["finish", "continue"]), evidenceRange: evidenceTokenRangeSchema }).strict().nullable().default(null),
  researchSignals: z.array(researchSignalSchema.omit({ evidence: true }).extend({ evidenceRange: evidenceTokenRangeSchema }).strict()).max(16).default([]),
  answerEvidenceRanges: z.array(evidenceTokenRangeSchema).max(8),
  reactionEvidenceRanges: z.array(evidenceTokenRangeSchema).max(8),
  request: z.object({ text: z.string().min(1).max(4000), evidenceRange: evidenceTokenRangeSchema }).strict().nullable(),
  priorities: z.array(z.object({ label: z.string().min(1).max(200), query: z.string().min(1).max(4000), evidenceRange: evidenceTokenRangeSchema }).strict()).max(16),
  // One nullable fact prevents a familiarity value without its evidence (or
  // evidence without a value). Persisted observation fields remain unchanged.
  familiarity: z.object({ level: z.enum(["low", "moderate", "high"]), evidenceRange: evidenceTokenRangeSchema }).strict().nullable(),
}).strict();
export const conversationTurnInputSchema = z.object({ context: conversationTurnContextSchema.extend({ participantTokens: participantTokensSchema }).strict(), evidence: sourceEvidenceSpansInputSchema }).strict();
// A cited passage supports the answer. Legacy source-role classifications are
// not part of this runtime's model task or a medical-review claim.
export const conversationWebsiteAnswerSchema = websiteAnswerModelResultSchema.extend({
  selections: z.array(websiteAnswerModelResultSchema.shape.selections.element.omit({ evidenceRole: true, contribution: true }).strict()).max(3),
}).strict();
export const conversationTurnResultSchema = z.object({
  observation: conversationObservationModelSchema.omit({ request: true }).strict(),
  source: z.object({ request: conversationObservationModelSchema.shape.request.unwrap(), answer: conversationWebsiteAnswerSchema }).strict().nullable(),
}).strict();
export type ConversationTurnContext = z.infer<typeof conversationTurnContextSchema>;
export type ConversationObservation = z.infer<typeof conversationObservationSchema>;

/** The application determines which research fields the current question permits.
 * Enforce that constraint at generation time, not only after a model response. */
export function conversationTurnResultSchemaForQuestion(kind: NonNullable<ConversationTurnContext["question"]>["kind"] | null, objectives?: ConversationTurnContext["researchObjectives"]) {
  const objectiveIds = objectives?.map(objective => objective.id) ?? [];
  const criterionIds = [...new Set(objectives?.flatMap(objective => objective.missingCriteria.map(criterion => criterion.id)) ?? [])];
  const signals = objectiveIds.length && criterionIds.length
    ? z.array(conversationObservationModelSchema.shape.researchSignals.removeDefault().element.extend({
      objectiveId: z.enum(objectiveIds as [string, ...string[]]), criterionId: z.enum(criterionIds as [string, ...string[]]),
    }).strict()).max(16).default([])
    : conversationObservationModelSchema.shape.researchSignals.removeDefault().max(0).default([]);
  return conversationTurnResultSchema.extend({
    observation: conversationTurnResultSchema.shape.observation.extend({
      researchSignals: signals,
      priorities: kind === "priorities" ? conversationObservationModelSchema.shape.priorities : conversationObservationModelSchema.shape.priorities.max(0),
    }).strict(),
  }).strict();
}
