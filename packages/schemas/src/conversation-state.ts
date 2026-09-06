import { z } from "zod";
import { researchPlanStateSchema } from "./research-objectives";

export const conversationStateSchema = z.object({
  version: z.literal(2),
  research: researchPlanStateSchema.optional(),
  parkedGuideId: z.string().nullable(),
  skippedGuideIds: z.array(z.string()).default([]),
  topics: z.array(z.object({
    id: z.string(), label: z.string(), query: z.string(),
    status: z.enum(["pending", "presented", "discussed", "skipped"]),
    evidence: z.array(z.string()),
  }).strict()).max(64),
  activeTopicId: z.string().nullable(),
  discussion: z.object({ query: z.string(), lastAnswer: z.string(), sourceIds: z.array(z.string()) }).strict().nullable(),
  reactionPending: z.boolean(),
}).strict();
export type ConversationState = z.infer<typeof conversationStateSchema>;
