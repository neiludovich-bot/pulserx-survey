import { z } from "zod";

export const sourceQuestionRecentTurnsSchema = z.array(z.object({
  role: z.enum(["interviewer", "participant"]),
  content: z.string().min(1).max(12000),
}).strict()).max(24);

export const sourceQuestionPlanInputSchema = z.object({
  surveySlug: z.enum(["nubeqa", "brukinsa", "padcev"]),
  brand: z.string().min(1).max(100).optional(),
  participantMessage: z.string().min(1).max(12000),
  sourceTopicContext: z.string().min(1).max(6000).nullable(),
  recentTurns: sourceQuestionRecentTurnsSchema,
}).strict();

export const sourceQuestionPlanSchema = z.object({
  version: z.literal(1),
  interpretedQuestion: z.string().min(1).max(4000),
  usesSourceContext: z.boolean(),
  retrievalQueries: z.array(z.string().min(1).max(4000)).min(1).max(3),
  answerApproach: z.enum(["direct", "contextual_explanation", "clarify"]),
  contextBoundary: z.string().min(1).max(2000).nullable(),
  rationale: z.string().min(1).max(2000),
}).strict();

export type SourceQuestionPlanInput = z.infer<typeof sourceQuestionPlanInputSchema>;
export type SourceQuestionPlan = z.infer<typeof sourceQuestionPlanSchema>;
