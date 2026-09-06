import { z } from "zod";

export const researchObjectiveSchema = z.object({
  id: z.string().min(1).max(100),
  module: z.string().min(1).max(200),
  objective: z.string().min(1).max(1500),
  questionIds: z.array(z.string()).min(1).max(40),
  criteria: z.array(z.object({ id: z.string(), description: z.string(), followUp: z.string() }).strict()).min(1).max(4),
  transition: z.string(),
}).strict();
export const researchSignalSchema = z.object({ objectiveId: z.string(), criterionId: z.string(), evidence: z.string().min(1).max(12000) }).strict();
export const researchPlanStateSchema = z.object({
  version: z.literal(1),
  objectives: z.array(researchObjectiveSchema.extend({
    status: z.enum(["uncovered", "partial", "covered", "deferred"]),
    evidence: z.array(researchSignalSchema.extend({ turn: z.number().int().nonnegative() }).strict()).max(128),
    followUpsAsked: z.number().int().min(0).max(1),
  }).strict()).max(40),
  turn: z.number().int().nonnegative(),
}).strict();
export type ResearchObjective = z.infer<typeof researchObjectiveSchema>;
export type ResearchPlanState = z.infer<typeof researchPlanStateSchema>;
