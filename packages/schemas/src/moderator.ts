import { z } from "zod";
import { sourceQuestionPlanSchema } from "./source-question";
import { participantUnderstandingSchema, presentationPlanSchema } from "./presentation";

const evidenceExcerptSchema = z.string().min(1).max(4000);
const answerStatusSchema = z.enum(["answered", "partial", "not_answered"]);
export const moderatorEvidenceRoleSchema = z.enum(["direct", "contextual"]);

export const moderatorEvidencePacketSchema = z.object({
  sources: z.array(z.object({
    evidenceRole: moderatorEvidenceRoleSchema.optional(),
    id: z.string().min(1),
    surveySlug: z.enum(["brukinsa", "padcev", "nubeqa"]),
    title: z.string().min(1),
    url: z.union([z.string().url(), z.literal("")]),
    description: z.string(),
    text: z.string().min(1).max(12000),
    tags: z.array(z.string()),
    assets: z.array(z.object({
      title: z.string().min(1),
      url: z.string().url(),
      description: z.string().nullable(),
      assetKind: z.string().min(1),
      tags: z.array(z.string()),
      priority: z.number().finite(),
    }).strict()).max(6),
  }).strict()).min(1).max(3),
}).strict().superRefine((packet, context) => {
  if (new Set(packet.sources.map((source) => source.id)).size !== packet.sources.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "Evidence packet source IDs must be unique." });
  }
  if (new Set(packet.sources.map((source) => source.surveySlug)).size !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "Evidence packets cannot mix source brands." });
  }
});

export const moderatorPrioritySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  participantEvidence: evidenceExcerptSchema,
  status: z.enum(["pending", "presented", "reacted", "skipped"]),
  probeCount: z.number().int().min(0).default(0),
  sourceQuestion: z.string().min(1).max(2000),
  reactionEvidence: z.array(evidenceExcerptSchema).max(32),
  referenceIds: z.array(z.string().min(1)).max(32),
  evidencePacket: moderatorEvidencePacketSchema.optional(),
}).strict();

export const moderatorStateSchema = z.object({
  version: z.literal(1),
  priorities: z.array(moderatorPrioritySchema).max(64),
  activePriorityId: z.string().min(1).nullable(),
  understanding: participantUnderstandingSchema.optional(),
  sourceDiscussion: z.object({
    query: z.string().min(1).max(12000),
    evidencePacket: moderatorEvidencePacketSchema.optional(),
    pendingQuestion: z.string().min(1).max(12000).optional(),
    status: z.enum(["open", "failed"]).optional(),
    returnTarget: z.object({ kind: z.enum(["guide", "priority"]), id: z.string().min(1) }).strict().nullable().optional(),
    navigationHintShown: z.boolean().optional(),
    failure: z.object({
      stage: z.enum(["unavailable", "planning", "retrieval", "composition", "grounding"]),
      message: z.string().min(1).max(1000),
    }).strict().nullable().optional(),
  }).strict().optional(),
}).strict().superRefine((state, context) => {
  const ids = new Set(state.priorities.map((priority) => priority.id));
  if (ids.size !== state.priorities.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["priorities"], message: "Priority IDs must be unique." });
  }
  if (state.activePriorityId !== null && !ids.has(state.activePriorityId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["activePriorityId"], message: "The active priority must exist in the priority list." });
  }
});

export const moderatorPlanInputSchema = z.object({
  brand: z.string().min(1).max(100),
  currentQuestion: z.string().min(1).nullable(),
  participantMessage: z.string().min(1).max(12000),
  recentTurns: z.array(z.object({
    role: z.enum(["interviewer", "participant"]),
    content: z.string().min(1).max(12000),
  }).strict()).max(24),
  state: moderatorStateSchema,
  isPriorityQuestion: z.boolean(),
  asksSourceQuestion: z.boolean(),
  answerStatus: answerStatusSchema,
  isResumeCue: z.boolean(),
}).strict();

export const moderatorPlanResultSchema = z.object({
  newPriorities: z.array(z.object({
    label: z.string().min(1).max(200),
    participantEvidence: evidenceExcerptSchema,
    sourceQuestion: z.string().min(1).max(2000),
  }).strict()).max(32),
  reactionStatus: answerStatusSchema,
  reactionEvidence: z.array(evidenceExcerptSchema).max(16),
  action: z.enum(["present_priority", "probe_reaction", "answer_source", "resume_guide"]),
  selectedPriorityId: z.string().min(1).nullable(),
  rationale: z.string().min(1).max(1000),
}).strict().superRefine((result, context) => {
  if ((result.reactionStatus === "not_answered") !== (result.reactionEvidence.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reactionEvidence"], message: "Reaction credit requires evidence; unanswered reactions have no evidence." });
  }
});

// The model identifies mentions before the engine projects them into the
// application plan. Reaction details never become new agenda entries merely
// because the participant described an existing priority in different words.
export const moderatorPlanModelResultSchema = moderatorPlanResultSchema.innerType()
  .omit({ newPriorities: true })
  .extend({
    priorityMentions: z.array(z.object({
      label: z.string().min(1).max(200),
      participantEvidence: evidenceExcerptSchema,
      sourceQuestion: z.string().min(1).max(2000),
      existingPriorityId: z.string().min(1).nullable(),
      kind: z.enum(["initial_priority", "additional_priority", "existing_priority", "reaction_detail"]),
      additionEvidence: evidenceExcerptSchema.nullable(),
    }).strict()).max(32),
  }).strict();

export const moderatorPhrasingInputSchema = z.object({
  brand: z.string().min(1).max(100),
  action: z.enum(["reaction", "transition"]),
  priorityLabel: z.string().min(1).max(200),
  participantMessage: z.string().max(12000),
  previousPriorityLabel: z.string().min(1).max(200).nullable(),
  understanding: participantUnderstandingSchema.optional(),
  presentationPlan: presentationPlanSchema.optional(),
  selectedObjective: z.string().min(1).max(1000).optional(),
  evidenceSummary: z.string().max(6000).optional(),
  reactionEvidence: z.array(evidenceExcerptSchema).max(16).optional(),
  recentQuestionTexts: z.array(z.string().min(1).max(1000)).max(8).optional(),
  probeIntent: z.enum(["clarification", "implication", "information_need"]).optional(),
}).strict();

export const moderatorPhrasingResultSchema = z.object({
  text: z.string().trim().min(1).max(600),
}).strict();

export const moderatorEvidenceSelectionInputSchema = z.object({
  surveySlug: z.enum(["nubeqa", "brukinsa", "padcev"]),
  query: z.string().min(1).max(4000),
  evidenceFocus: z.enum(["all", "contextual"]).default("all"),
  sourceTopicContext: z.string().min(1).max(6000).nullable().default(null),
  priorSourceIds: z.array(z.string().min(1)).max(3).default([]),
  sourceQuestionPlan: sourceQuestionPlanSchema.nullable().optional(),
  candidates: z.array(z.object({
    id: z.string().min(1),
    title: z.string(),
    url: z.union([z.string().url(), z.literal("")]),
    description: z.string(),
    text: z.string().max(12000),
    tags: z.array(z.string()),
    assets: z.array(z.object({
      id: z.string().min(1),
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      assetKind: z.string(),
      tags: z.array(z.string()),
    }).strict()).max(32),
  }).strict()).max(24),
}).strict();

const moderatorEvidenceSelectionSchema = z.object({
    sourceId: z.string().min(1),
    supportExcerpt: z.string().min(1).max(1500),
    assetIds: z.array(z.string().min(1)).max(6),
    evidenceRole: moderatorEvidenceRoleSchema.default("direct"),
  }).strict();

export const moderatorEvidenceSelectionResultSchema = z.object({
  selections: z.array(moderatorEvidenceSelectionSchema).max(3),
  rationale: z.string().min(1).max(1000),
}).strict();

// Model output requires the role; only application/legacy inputs receive a default.
export const moderatorEvidenceSelectionModelResultSchema = moderatorEvidenceSelectionResultSchema.extend({
  selections: z.array(moderatorEvidenceSelectionSchema.extend({ evidenceRole: moderatorEvidenceRoleSchema })).max(3),
}).strict();

export type ModeratorPriority = z.infer<typeof moderatorPrioritySchema>;
export type ModeratorEvidencePacket = z.infer<typeof moderatorEvidencePacketSchema>;
export type ModeratorState = z.infer<typeof moderatorStateSchema>;
export type ModeratorPlanInput = z.infer<typeof moderatorPlanInputSchema>;
export type ModeratorPlanResult = z.infer<typeof moderatorPlanResultSchema>;
export type ModeratorPlanModelResult = z.infer<typeof moderatorPlanModelResultSchema>;
export type ModeratorPhrasingInput = z.infer<typeof moderatorPhrasingInputSchema>;
export type ModeratorPhrasingResult = z.infer<typeof moderatorPhrasingResultSchema>;
export type ModeratorEvidenceSelectionInput = z.input<typeof moderatorEvidenceSelectionInputSchema>;
export type ModeratorEvidenceSelectionResult = z.infer<typeof moderatorEvidenceSelectionResultSchema>;
