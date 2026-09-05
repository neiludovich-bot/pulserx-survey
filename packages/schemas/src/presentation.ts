import { z } from "zod";

export const explanationDepthSchema = z.enum(["brief", "standard", "detailed"]);
export const participantUnderstandingSchema = z.object({
  version: z.literal(1),
  productFamiliarity: z.enum(["unknown", "low", "moderate", "high"]),
  preferredDepth: explanationDepthSchema,
  depthPreferenceExplicit: z.boolean().optional(),
  participantEvidence: z.array(z.string().trim().min(1).max(4000)).max(32),
}).strict();

export const participantUnderstandingUpdateSchema = z.object({
  version: z.literal(1),
  productFamiliarity: z.enum(["low", "moderate", "high"]).nullable(),
  preferredDepth: explanationDepthSchema.nullable(),
  participantEvidence: z.array(z.string().trim().min(1).max(4000)).min(1).max(8),
}).strict().refine((update) => update.productFamiliarity !== null || update.preferredDepth !== null,
  "An understanding update must identify a stated familiarity or depth preference.");

export const presentationPlanSchema = z.object({
  version: z.literal(1),
  purpose: z.enum(["orientation", "source_answer", "reaction_setup"]),
  depth: explanationDepthSchema,
  maxFacts: z.number().int().min(1).max(8),
  maxTopics: z.number().int().min(1).max(3),
  askReadiness: z.boolean(),
}).strict().superRefine((plan, context) => {
  if (plan.depth === "brief" && (plan.maxFacts > 3 || plan.maxTopics > 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Brief presentation permits at most three facts about one topic." });
  }
});

const sourceTurnAttemptSchema = z.object({
  stage: z.enum(["composition", "grounding"]),
  code: z.string().min(1).max(120),
  responseId: z.string().nullable(),
  model: z.string().nullable(),
}).strict();
const outcomeFields = { version: z.literal(1), attempts: z.array(sourceTurnAttemptSchema).max(4).default([]) };
export const sourceTurnOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ ...outcomeFields, status: z.literal("success") }).strict(),
  z.object({ ...outcomeFields, status: z.literal("no_evidence") }).strict(),
  z.object({ ...outcomeFields, status: z.literal("composition_failure") }).strict(),
  z.object({ ...outcomeFields, status: z.literal("grounding_rejected") }).strict(),
  z.object({ ...outcomeFields, status: z.literal("configuration_failure") }).strict(),
]);

export type ParticipantUnderstanding = z.infer<typeof participantUnderstandingSchema>;
export type ParticipantUnderstandingUpdate = z.infer<typeof participantUnderstandingUpdateSchema>;
export type PresentationPlan = z.infer<typeof presentationPlanSchema>;
export type SourceTurnOutcome = z.infer<typeof sourceTurnOutcomeSchema>;
