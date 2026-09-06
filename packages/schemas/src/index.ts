import { z } from "zod";
import { evidenceTokenRangeSchema, participantTokensSchema } from "./evidence-ranges";
export * from "./evidence-ranges";
import { sourceRequestSchema } from "./source-request";
export * from "./source-request";
import { sourceQuestionPlanSchema, sourceQuestionRecentTurnsSchema } from "./source-question";
import { moderatorEvidenceRoleSchema } from "./moderator";
import { participantUnderstandingSchema, participantUnderstandingUpdateSchema, presentationPlanSchema } from "./presentation";
export * from "./presentation";
export * from "./moderator";
export * from "./source-question";

export const interviewTurnSchema = z.object({
  role: z.enum(["system", "interviewer", "participant"]),
  content: z.string().min(1),
});

export const researchGoalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  priority: z.number().int().min(1).max(5),
});

export const questionCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["primary", "follow_up", "probe", "close"]),
  objective: z.string().min(1),
  promptSeed: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const groundedReferenceSchema = z.object({
  citationId: z.string().min(1),
  title: z.string().min(1).nullable(),
  url: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
  assets: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.string().url(),
        description: z.string().min(1).nullable(),
        assetKind: z.string().min(1),
        tags: z.array(z.string()).default([]),
        priority: z.number().int().default(0),
      }),
    )
    .default([]),
});

export const selectorInputSchema = z.object({
  sessionId: z.string().min(1),
  goals: z.array(researchGoalSchema).min(1),
  previousTurns: z.array(interviewTurnSchema).default([]),
  candidateQuestions: z.array(questionCandidateSchema).min(1),
  coverage: z.record(z.string(), z.number().min(0).max(1)).default({}),
});

export const selectionDecisionSchema = z.object({
  action: z.enum(["ask", "probe", "reflect", "close"]),
  selectedQuestionId: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  missingCoverageGoalIds: z.array(z.string()).default([]),
});

export const phrasingInputSchema = z.object({
  sessionId: z.string().min(1),
  selectedQuestion: questionCandidateSchema,
  participantContext: z.object({
    tone: z.enum(["neutral", "warm", "direct"]).default("warm"),
    lastAnswerSummary: z.string().optional(),
  }),
  deliveryContext: z
    .object({
      interactionType: z
        .enum(["ask", "probe", "redirect", "close"])
        .default("ask"),
      answerQuality: z
        .enum(["adequate", "partial", "off_topic", "nonsense"])
        .optional(),
      turnIntent: z
        .enum([
          "survey_answer",
          "clarification_question",
          "off_topic",
          "medical_safety",
          "nonsense",
        ])
        .optional(),
      safetyFlag: z.boolean().optional(),
      participantQuestion: z.string().min(1).nullable().optional(),
      groundedResponse: z.string().min(1).nullable().optional(),
      groundedReferences: z.array(groundedReferenceSchema).default([]),
      acknowledgement: z.string().optional(),
      missingTopics: z.array(z.string()).default([]),
      assetTitle: z.string().optional(),
    })
    .default({
      interactionType: "ask",
      missingTopics: [],
    }),
});

export const phrasingResultSchema = z.object({
  utterance: z.string().min(1),
  styleNotes: z.array(z.string()),
});

export const controlledRagCompositionSourceSchema = z.object({
  evidenceRole: moderatorEvidenceRoleSchema.optional(),
  index: z.number().int().min(1).max(8),
  title: z.string().min(1),
  url: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
  tags: z.array(z.string()).default([]),
  text: z.string().min(1).max(1800),
});

export const controlledRagCompositionInputSchema = z.object({
  presentationPlan: presentationPlanSchema.optional(),
  surveySlug: z.string().min(1),
  participantMessage: z.string().min(1),
  resolvedSourceQuestion: z.string().min(1).nullable().default(null),
  sourceTopicContext: z.string().min(1).max(6000).nullable().optional(),
  sourceQuestionPlan: sourceQuestionPlanSchema.nullable().optional(),
  recentTurns: sourceQuestionRecentTurnsSchema.optional(),
  surveyContext: z.string().default(""),
  currentQuestion: z.string().min(1).nullable(),
  selectedNextQuestion: z.string().min(1).nullable(),
  selectedQuestionSourceContext: z.string().min(1).nullable(),
  recentInterviewerContext: z.string().min(1).nullable().default(null),
  responseMode: z
    .enum(["answer_only", "answer_then_ask"])
    .default("answer_then_ask"),
  clinicalEvidenceCard: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1),
      topic: z.string().min(1).nullable(),
      clinicianBrief: z.string().min(1).max(1400),
      keyFacts: z.array(z.string().min(1).max(420)).min(1).max(8),
      caveats: z.array(z.string().min(1).max(360)).max(5).default([]),
      answerDirective: z.string().min(1).max(700),
      preferredSourceIds: z.array(z.string().min(1)).max(8).default([]),
      preferredAssetTags: z.array(z.string().min(1)).max(16).default([]),
    })
    .nullable()
    .default(null),
  sources: z.array(controlledRagCompositionSourceSchema).min(1).max(8),
});

export const controlledRagCompositionResultSchema = z.object({
  answerBody: z.string().min(1).max(2600),
  usedSourceIndexes: z.array(z.number().int().min(1).max(8)).min(1).max(8),
  limitations: z.array(z.string().min(1).max(240)).max(4).default([]),
});

export const mvpTurnRouteKindSchema = z.enum([
  "planned_answer",
  "source_question",
  "in_lane_topic",
  "off_lane_excursion",
  "unknown_in_domain",
  "out_of_scope",
]);

export const mvpDisplayTopicSchema = z.enum([
  "padcev_ev302_response",
  "padcev_ev302_survival",
  "padcev_neuropathy_management",
  "padcev_dose_modification",
  "padcev_safety_resources",
  "padcev_safety_management",
  "padcev_patient_selection",
  "brukinsa_cll_sequoia",
  "brukinsa_cll_alpine",
  "brukinsa_safety_management",
  "nubeqa_mcspc_aranote",
  "nubeqa_mcspc_arasens",
  "nubeqa_nmcrpc_aramis",
  "nubeqa_safety_dosing",
  "nubeqa_guidelines_resources",
  "nubeqa_patient_selection",
  "unknown_in_domain",
]);

export const mvpTurnRouteCandidateSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  objective: z.string().min(1),
  module: z.string().min(1),
  allowedByIntent: z.boolean(),
  alreadyAsked: z.boolean(),
  routeKeywords: z.array(z.string()).default([]),
  sourceContextRequirement: z.string().min(1).nullable().default(null),
}).strict();

export const mvpTurnRouteAnalysisInputSchema = z.object({
  understanding: participantUnderstandingSchema.optional(),
  surveySlug: z.enum(["brukinsa", "padcev", "data", "nubeqa"]),
  sourceBrand: z.string().min(1),
  activeIntentSlug: z.string().min(1).nullable(),
  activeIntentLabel: z.string().min(1).nullable(),
  activeIntentSteeringRule: z.string().min(1).nullable(),
  currentQuestionId: z.string().min(1).nullable(),
  currentQuestion: z.string().min(1).nullable(),
  currentQuestionObjective: z.string().min(1).nullable().default(null),
  currentQuestionKeywords: z.array(z.string()).default([]),
  currentQuestionCompletionSignals: z.array(z.string()).default([]),
  sourceConversationActive: z.boolean().default(false),
  participantMessage: z.string().min(1),
  recentInterviewerContext: z.string().min(1).nullable().default(null),
  candidateQuestions: z.array(mvpTurnRouteCandidateSchema).min(1).max(16),
}).strict();

export const mvpTurnRouteAnalysisResultSchema = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  sourceRequest: sourceRequestSchema.nullable().optional(),
  understandingUpdate: participantUnderstandingUpdateSchema.nullable().optional(),
  answerStatus: z.enum(["answered", "partial", "not_answered"]),
  asksSourceQuestion: z.boolean(),
  answerEvidence: z.array(z.string().trim().min(1)).max(8),
  kind: mvpTurnRouteKindSchema,
  topic: mvpDisplayTopicSchema.nullable(),
  needsSource: z.boolean(),
  isOutOfScope: z.boolean(),
  isUnanticipated: z.boolean(),
  suggestedQuestionIds: z.array(z.string().min(1)).max(3).default([]),
  sourceDirective: z.string().min(1).nullable().default(null),
  rationale: z.string().min(1).max(500),
}).strict().superRefine((value, context) => {
  if ((value.schemaVersion === 5 && value.sourceRequest === undefined) ||
      ((value.schemaVersion === 5 || value.sourceRequest !== undefined) && value.asksSourceQuestion !== Boolean(value.sourceRequest))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceRequest"], message: "A source request must identify the participant's information request; a topic mention is not sufficient." });
  }
  if ((value.answerStatus === "not_answered") !== (value.answerEvidence.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["answerEvidence"], message: "Answer credit requires exact supporting participant excerpts; unanswered turns have no answer evidence." });
  }
  if (value.needsSource !== (value.asksSourceQuestion && !value.isOutOfScope)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["needsSource"], message: "Source retrieval requires an in-scope participant information request." });
  }
});

export const mvpTurnRouteAnalysisModelResultSchema = mvpTurnRouteAnalysisResultSchema.innerType().extend({
  schemaVersion: z.literal(5),
  sourceRequest: sourceRequestSchema.nullable(),
  understandingUpdate: participantUnderstandingUpdateSchema.nullable(),
  suggestedQuestionIds: z.array(z.string().min(1)).max(3),
  sourceDirective: z.string().min(1).nullable(),
}).strict();

export const mvpTurnRouteAnalysisIndexedInputSchema = mvpTurnRouteAnalysisInputSchema.extend({
  participantTokens: participantTokensSchema,
}).strict();

export const mvpTurnRouteAnalysisIndexedModelResultSchema = mvpTurnRouteAnalysisModelResultSchema.omit({ answerEvidence: true, sourceRequest: true, understandingUpdate: true }).extend({
  schemaVersion: z.literal(6),
  answerEvidenceRanges: z.array(evidenceTokenRangeSchema).max(8),
  sourceRequest: sourceRequestSchema.omit({ participantEvidence: true }).extend({ participantEvidenceRange: evidenceTokenRangeSchema }).strict().nullable(),
  understandingUpdate: participantUnderstandingUpdateSchema.innerType().omit({ participantEvidence: true }).extend({ participantEvidenceRanges: z.array(evidenceTokenRangeSchema).min(1).max(8) }).strict().nullable(),
}).strict();
export type MvpTurnRouteAnalysisIndexedModelResult = z.infer<typeof mvpTurnRouteAnalysisIndexedModelResultSchema>;

export const controlledRagContextualCompositionResultSchema = z.object({
  practicalAnswer: z.string().trim().min(1).max(2000),
  qualification: z.string().trim().min(1).max(500).nullable(),
  usedSourceIndexes: z.array(z.number().int().min(1).max(8)).min(1).max(8),
}).strict();

export type ControlledRagContextualCompositionResult = z.infer<typeof controlledRagContextualCompositionResultSchema>;

export const sourceGroundingViolationSchema = z.object({
  excerpt: z.string().min(1).max(2500),
  reason: z.string().min(1).max(600),
}).strict();

// Review/repair must accommodate both existing composer output shapes without truncation.
export const sourceAnswerDraftSchema = z.object({
  practicalAnswer: z.string().min(1).max(2600),
  qualification: z.string().min(1).max(1000).nullable(),
}).strict();

export const sourceGroundingReviewInputSchema = z.object({
  draft: sourceAnswerDraftSchema,
  sources: z.array(z.object({ index: z.number().int().min(1).max(8), text: z.string().min(1).max(1800) }).strict()).min(1).max(8),
}).strict();

export const sourceGroundingReviewResultSchema = z.object({
  version: z.literal(1),
  supported: z.boolean(),
  unsupportedClaims: z.array(sourceGroundingViolationSchema).max(16),
}).strict();

export const contextualSourceCompositionInputSchema = controlledRagCompositionInputSchema.extend({
  groundingViolations: z.array(sourceGroundingViolationSchema).max(16),
  previousDraft: sourceAnswerDraftSchema.nullable().optional(),
}).strict();

export type SourceGroundingReviewResult = z.infer<typeof sourceGroundingReviewResultSchema>;

export const sourceAnswerGroundingAuditSchema = z.object({
  version: z.literal(1),
  status: z.literal("supported"),
  attempt: z.number().int().min(1).max(3),
  model: z.string().nullable(),
  responseId: z.string().nullable(),
}).strict();
export type SourceAnswerGroundingAudit = z.infer<typeof sourceAnswerGroundingAuditSchema>;

export const controlledRagCompositionModelResultSchema = controlledRagCompositionResultSchema.extend({
  limitations: controlledRagCompositionResultSchema.shape.limitations.removeDefault(),
}).strict();

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.enum(["api", "web"]),
  timestamp: z.string().datetime(),
});

export const adminLoginRequestSchema = z.object({
  password: z.string().min(1),
});

export const adminLoginResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const integrationReadinessStatusSchema = z.enum([
  "ready",
  "missing_config",
]);

export const integrationSetupActionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
  href: z.string().min(1).nullable(),
  severity: z.enum(["blocker", "recommended"]),
});

export const integrationReadinessResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  openaiRealtime: z.object({
    status: integrationReadinessStatusSchema,
    configured: z.boolean(),
    model: z.string().min(1),
    missingEnv: z.array(z.string().min(1)),
    reason: z.string().min(1).nullable(),
  }),
  customGpt: z.object({
    status: integrationReadinessStatusSchema,
    configured: z.boolean(),
    projectConfigured: z.boolean(),
    studyProjectCount: z.number().int().min(0),
    baseUrl: z.string().url(),
    missingEnv: z.array(z.string().min(1)),
    reason: z.string().min(1).nullable(),
  }),
  setupActions: z.array(integrationSetupActionSchema),
});

export const integrationVerificationStatusSchema = z.enum([
  "passed",
  "skipped",
  "failed",
]);

const integrationVerificationItemSchema = z.object({
  status: integrationVerificationStatusSchema,
  checked: z.boolean(),
  latencyMs: z.number().int().min(0).nullable(),
  reason: z.string().min(1).nullable(),
});

export const integrationVerificationResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  openaiRealtime: integrationVerificationItemSchema.extend({
    model: z.string().min(1),
    expiresAt: z.string().datetime().nullable(),
  }),
  customGpt: integrationVerificationItemSchema.extend({
    baseUrl: z.string().url(),
    projectConfigured: z.boolean(),
    responseReceived: z.boolean(),
  }),
});

export const localCredentialStatusSchema = z.object({
  configured: z.boolean(),
  masked: z.string().nullable(),
});

export const localEnvironmentConfigResponseSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().nullable(),
  envPath: z.string().min(1),
  openaiApiKey: localCredentialStatusSchema,
  customGptApiKey: localCredentialStatusSchema,
  customGptProjectId: z.string().nullable(),
  customGptApiBaseUrl: z.string().url(),
  openaiRealtimeModel: z.string().min(1),
  openaiTranscriptionModel: z.string().min(1),
  openaiTtsModel: z.string().min(1),
  openaiTtsSpeed: z.number().min(0.25).max(4),
});

export const updateLocalEnvironmentConfigSchema = z.object({
  openaiApiKey: z.string().trim().optional(),
  customGptApiKey: z.string().trim().optional(),
  customGptProjectId: z.string().trim().optional(),
  customGptApiBaseUrl: z.string().trim().url().optional(),
  openaiRealtimeModel: z.string().trim().min(1).optional(),
  openaiTranscriptionModel: z.string().trim().min(1).optional(),
  openaiTtsModel: z.string().trim().min(1).optional(),
  openaiTtsSpeed: z.coerce.number().min(0.25).max(4).optional(),
});

export const studyAssetTypeSchema = z.enum([
  "PDF",
  "SLIDE_DECK",
  "IMAGE",
  "PI_LABEL",
  "VIDEO",
  "TEXT",
]);

export const studyActionTypeSchema = z.enum([
  "ASK_QUESTION",
  "SHOW_ASSET",
  "ASK_ASSET_REACTION",
  "PROBE",
  "REDIRECT",
  "CLOSE",
]);

export const actionRuleTypeSchema = z.enum([
  "ALWAYS",
  "AFTER_ACTION",
  "IF_FACT_PRESENT",
  "IF_FACT_EQUALS",
  "IF_CONTRADICTION",
  "IF_OFF_TOPIC",
  "IF_ASSET_SHOWN",
]);

export const assetDisplayModeSchema = z.enum([
  "INLINE_PANE",
  "MODAL",
  "FULLSCREEN",
  "DOWNLOAD_LINK",
]);

export const timeboxStrategySchema = z.enum(["HARD_CAP", "FULL_GUIDE"]);

export const assetStageTriggerTypeSchema = z.enum([
  "AFTER_ACTION",
  "ON_MODULE_ENTRY",
  "BEFORE_CLOSE",
  "IF_FACT_PRESENT",
]);

export const candidateActionReasonCodeSchema = z.enum([
  "ENTRY",
  "MUST_ASK",
  "BRANCH_PRIORITY",
  "ASSET_STAGE",
  "CONTRADICTION",
  "OFF_TOPIC_REDIRECT",
  "MODEL_RECOMMENDATION",
  "RESEARCHER_OVERRIDE",
]);

export const assetReactionKindSchema = z.enum([
  "COMPREHENSION",
  "APPEAL",
  "CONCERN",
  "OBJECTION",
  "COMPARISON",
  "OPEN_FEEDBACK",
]);

export const assetReactionStatusSchema = z.enum([
  "PENDING",
  "COMPLETED",
  "FAILED",
]);

export const factValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const contradictionFlagSchema = z.object({
  factKey: z.string().min(1),
  previousValue: factValueSchema,
  nextValue: factValueSchema,
  reason: z.string().min(1),
});

export const surveyTurnIntentSchema = z.enum([
  "survey_answer",
  "clarification_question",
  "off_topic",
  "medical_safety",
  "nonsense",
]);

export const participantTurnInputSchema = z.object({
  turnId: z.string().min(1).optional(),
  content: z.string().min(1),
  extractedFacts: z.record(z.string(), factValueSchema).default({}),
  offTopic: z.boolean().default(false),
  turnIntent: surveyTurnIntentSchema.default("survey_answer"),
  participantQuestion: z.string().min(1).nullable().default(null),
  safetyFlag: z.boolean().default(false),
  answerQuality: z
    .enum(["adequate", "partial", "off_topic", "nonsense"])
    .default("adequate"),
  shouldAdvance: z.boolean().default(true),
});

export const analysisInputSchema = z.object({
  sessionId: z.string().min(1),
  studyId: z.string().min(1),
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  nodeTitle: z.string().min(1),
  questionPrompt: z.string().min(1),
  expectedFactKeys: z.array(z.string()).default([]),
  sessionState: z.object({
    facts: z.record(z.string(), factValueSchema).default({}),
    history: z.array(interviewTurnSchema).default([]),
  }),
  participantAnswer: z.string().min(1),
});

export const analysisResultSchema = z.object({
  summary: z.string().min(1),
  extractedFacts: z.record(z.string(), factValueSchema),
  offTopic: z.boolean(),
  turnIntent: surveyTurnIntentSchema,
  participantQuestion: z.string().min(1).nullable(),
  groundedResponse: z.string().min(1).nullable(),
  groundedReferences: z.array(groundedReferenceSchema),
  safetyFlag: z.boolean(),
  answerQuality: z.enum(["adequate", "partial", "off_topic", "nonsense"]),
  shouldAdvance: z.boolean(),
  followUpAction: z.enum(["advance", "probe", "redirect", "reask"]),
  missingTopics: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const decisionCandidateSchema = z.object({
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  mustAsk: z.boolean().default(false),
});

export const interviewDecisionActionSchema = z.enum([
  "ask",
  "probe",
  "redirect",
  "close",
]);

export const decisionResultSchema = z.object({
  action: interviewDecisionActionSchema,
  selectedNodeId: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const sessionStateTurnSchema = z.object({
  role: z.enum(["system", "interviewer", "participant"]),
  nodeId: z.string().min(1).optional(),
  content: z.string().min(1),
  offTopic: z.boolean().default(false),
  turnIntent: surveyTurnIntentSchema.default("survey_answer"),
});

export const sessionStateJsonSchema = z.object({
  sessionId: z.string().min(1),
  studyId: z.string().min(1),
  status: z.enum(["active", "completed", "stopped"]).default("active"),
  startedAt: z.string().datetime().nullable().default(null),
  lastActivityAt: z.string().datetime().nullable().default(null),
  targetDurationSeconds: z.number().int().positive().default(900),
  elapsedSeconds: z.number().int().min(0).default(0),
  remainingSeconds: z.number().int().min(0).default(900),
  maxAttemptsPerNode: z.number().int().min(1).max(5).default(2),
  maxOffTopicRedirects: z.number().int().min(0).max(5).default(2),
  currentActionId: z.string().nullable().default(null),
  currentActionKey: z.string().nullable().default(null),
  currentNodeId: z.string().nullable().default(null),
  currentNodeKey: z.string().nullable().default(null),
  currentAssetId: z.string().nullable().default(null),
  askedNodeIds: z.array(z.string()).default([]),
  completedNodeIds: z.array(z.string()).default([]),
  completedActionIds: z.array(z.string()).default([]),
  attemptCountsByNodeId: z
    .record(z.string(), z.number().int().min(0))
    .default({}),
  pendingMustAskNodeIds: z.array(z.string()).default([]),
  shownAssetIds: z.array(z.string()).default([]),
  coverageByGoal: z.record(z.string(), z.number().min(0).max(1)).default({}),
  facts: z.record(z.string(), factValueSchema).default({}),
  contradictionFlags: z.array(contradictionFlagSchema).default([]),
  offTopicRedirectCount: z.number().int().min(0).default(0),
  safetyEscalationCount: z.number().int().min(0).default(0),
  history: z.array(sessionStateTurnSchema).default([]),
});

export const decisionInputSchema = z.object({
  sessionId: z.string().min(1),
  studyId: z.string().min(1),
  currentNodeId: z.string().nullable(),
  currentNodeKey: z.string().nullable(),
  sessionState: sessionStateJsonSchema,
  analysis: analysisResultSchema,
  allowedCandidates: z.array(decisionCandidateSchema).min(1),
});

export const openAIDebugTraceSchema = z.object({
  callType: z.enum([
    "analysis",
    "decision",
    "phrasing",
    "source_composition",
    "source_grounding_review",
    "turn_route",
    "moderator_plan",
    "moderator_phrasing",
    "moderator_evidence",
    "source_question_plan",
  ]),
  promptVersion: z.string().min(1),
  requestedAt: z.string().datetime(),
  request: z.object({
    model: z.string().min(1),
    schemaName: z.string().min(1),
    input: z.unknown(),
    metadata: z.record(z.string(), z.string()).default({}),
  }),
  response: z.object({
    id: z.string().nullable(),
    model: z.string().nullable(),
    status: z.string().nullable(),
    createdAt: z.string().nullable(),
    outputText: z.string().nullable(),
    usage: z
      .object({
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        totalTokens: z.number().nullable(),
      })
      .nullable(),
    raw: z.unknown(),
  }),
});

export const studyAssetSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  assetType: studyAssetTypeSchema,
  storageKey: z.string().min(1),
  mimeType: z.string().nullable(),
  metadata: z.unknown().nullable(),
  status: z.string().min(1),
  position: z.number().int().min(0),
});

export const studyActionSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  moduleId: z.string().nullable(),
  nodeId: z.string().nullable(),
  assetId: z.string().nullable(),
  key: z.string().min(1),
  actionType: studyActionTypeSchema,
  goal: z.string().nullable(),
  mustComplete: z.boolean(),
  priority: z.number().int().min(0),
  config: z.unknown().nullable(),
});

export const actionRuleSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  fromActionId: z.string().nullable(),
  toActionId: z.string().min(1),
  ruleType: actionRuleTypeSchema,
  priority: z.number().int().min(0),
  conditionJson: z.unknown().nullable(),
  rationale: z.string().nullable(),
});

export const assetStageRuleSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  assetId: z.string().min(1),
  moduleId: z.string().nullable(),
  triggerActionId: z.string().nullable(),
  triggerType: assetStageTriggerTypeSchema,
  displayMode: assetDisplayModeSchema,
  required: z.boolean(),
  priority: z.number().int().min(0),
  conditionJson: z.unknown().nullable(),
  rationale: z.string().nullable(),
});

export const sessionAssetSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  sessionId: z.string().min(1),
  assetId: z.string().min(1),
  sourceActionId: z.string().nullable(),
  turnId: z.string().nullable(),
  displayMode: assetDisplayModeSchema.nullable(),
  shownAt: z.string().datetime().nullable(),
  dismissedAt: z.string().datetime().nullable(),
  exposureMetadata: z.unknown().nullable(),
});

export const candidateActionSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().nullable(),
  studyActionId: z.string().nullable(),
  nodeId: z.string().nullable(),
  assetId: z.string().nullable(),
  actionType: studyActionTypeSchema,
  priority: z.number().int().min(0),
  allowed: z.boolean(),
  reasonCode: candidateActionReasonCodeSchema,
  input: z.unknown().nullable(),
});

export const assetReactionSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().nullable(),
  assetId: z.string().min(1),
  kind: assetReactionKindSchema,
  status: assetReactionStatusSchema,
  schemaVersion: z.number().int().min(1),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
});

export const assetReactionSummarySchema = assetReactionSchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const studySummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: z.string().min(1),
  sessionCount: z.number().int().min(0),
});

export const researcherSessionSummarySchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  respondentLabel: z.string().min(1),
  turnCount: z.number().int().min(0),
  currentNodeKey: z.string().nullable(),
});

export const studyGraphModuleSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  position: z.number().int().min(0),
});

export const studyGraphNodeSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  nodeType: z.string().min(1),
  moduleId: z.string().nullable(),
  moduleKey: z.string().nullable(),
  moduleTitle: z.string().nullable(),
  isEntry: z.boolean(),
  isTerminal: z.boolean(),
  mustAsk: z.boolean(),
  requiresGroundedStudyContext: z.boolean().default(false),
  sourceContextDetected: z.boolean().default(false),
  sourceContextOverride: z.boolean().nullable().default(null),
  sourceContextHint: z.string().min(1).nullable().default(null),
  sourceContextReferences: z.array(groundedReferenceSchema).default([]),
  position: z.number().int().min(0),
});

export const studyGraphEdgeSchema = z.object({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  conditionType: z.string().min(1),
  factKey: z.string().min(1).nullable(),
  comparisonValue: z.unknown().nullable(),
  priority: z.number().int().min(0),
  rationale: z.string().nullable(),
});

export const studyGraphAssetSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  assetType: studyAssetTypeSchema,
  mimeType: z.string().nullable(),
  storageKey: z.string().min(1),
  position: z.number().int().min(0),
});

export const studyGraphActionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  actionType: studyActionTypeSchema,
  moduleId: z.string().nullable(),
  nodeId: z.string().nullable(),
  nodeKey: z.string().nullable(),
  assetId: z.string().nullable(),
  assetKey: z.string().nullable(),
  goal: z.string().nullable(),
  mustComplete: z.boolean(),
  priority: z.number().int().min(0),
});

export const studyGraphStageRuleSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  assetKey: z.string().min(1),
  triggerActionId: z.string().nullable(),
  triggerActionKey: z.string().nullable(),
  triggerType: assetStageTriggerTypeSchema,
  displayMode: assetDisplayModeSchema,
  required: z.boolean(),
  priority: z.number().int().min(0),
  rationale: z.string().nullable(),
});

export const studyGraphAdaptiveFlowSchema = z.object({
  totalRules: z.number().int().min(0),
  conditionalRules: z.number().int().min(0),
  fallbackRules: z.number().int().min(0),
  sequentialRules: z.number().int().min(0),
  terminalNodeCount: z.number().int().min(0),
  warnings: z.array(z.string().min(1)),
});

export const studyGraphSourceContextQuestionSchema = z.object({
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  moduleTitle: z.string().min(1).nullable(),
  sourceContextDetected: z.boolean(),
  sourceContextOverride: z.boolean().nullable(),
  sourceContextHint: z.string().min(1).nullable(),
  sourceContextReferences: z.array(groundedReferenceSchema).default([]),
  assetTitle: z.string().min(1).nullable(),
});

export const studyGraphSourceContextSchema = z.object({
  enabledQuestionCount: z.number().int().min(0),
  detectedQuestionCount: z.number().int().min(0),
  overrideEnabledCount: z.number().int().min(0),
  overrideDisabledCount: z.number().int().min(0),
  referencedApprovedNoteQuestionCount: z.number().int().min(0).default(0),
  missingReferencedDetailQuestionCount: z.number().int().min(0).default(0),
  importedHintQuestionCount: z.number().int().min(0).default(0),
  missingImportedHintQuestionCount: z.number().int().min(0).default(0),
  questions: z.array(studyGraphSourceContextQuestionSchema),
});

export const studyGraphBranchSuggestionSchema = z.object({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  fromNodeKey: z.string().min(1),
  fromNodeTitle: z.string().min(1),
  toNodeId: z.string().min(1),
  toNodeKey: z.string().min(1),
  toNodeTitle: z.string().min(1),
  matchKeywords: z.array(z.string().min(1)).min(1),
  sampleAnswer: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(["optional_followup_cluster", "prompt_keyword"]),
  recommended: z.boolean(),
  recommendedReason: z.string().min(1).nullable(),
});

export const studyGraphRouteReviewRouteSchema = z.object({
  ruleId: z.string().min(1),
  toNodeId: z.string().min(1),
  toNodeKey: z.string().min(1),
  toNodeTitle: z.string().min(1),
  conditionType: z.string().min(1),
  factKey: z.string().min(1).nullable(),
  comparisonValue: z.unknown().nullable(),
  priority: z.number().int().min(0),
  rationale: z.string().nullable(),
  dryRunnable: z.boolean(),
  dryRunReason: z.string().min(1),
});

export const studyGraphRouteReviewGroupSchema = z.object({
  fromNodeId: z.string().min(1),
  fromNodeKey: z.string().min(1),
  fromNodeTitle: z.string().min(1),
  conditionalRoutes: z.array(studyGraphRouteReviewRouteSchema),
  fallbackRoute: studyGraphRouteReviewRouteSchema.nullable(),
  hasFallback: z.boolean(),
  dryRunnableConditionalCount: z.number().int().min(0),
  warning: z.string().min(1).nullable(),
});

export const studyGraphGuideCleanupNodeSchema = z.object({
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  moduleTitle: z.string().min(1).nullable(),
  reason: z.string().min(1),
  sourceLine: z.number().int().positive().nullable(),
  retainedSourceContextHint: z.string().min(1).nullable().default(null),
});

export const studyGraphGuideCleanupSchema = z.object({
  scriptedResponseNodeCount: z.number().int().min(0),
  scriptedResponseNodes: z.array(studyGraphGuideCleanupNodeSchema),
});

export const studyGraphSessionSummarySchema = z.object({
  totalSessionCount: z.number().int().min(0),
  activeSessionCount: z.number().int().min(0),
  pendingSessionCount: z.number().int().min(0),
  completedSessionCount: z.number().int().min(0),
  abandonedSessionCount: z.number().int().min(0),
  openSessionCount: z.number().int().min(0),
});

export const applyStudyGuideCleanupSchema = z.object({
  confirm: z.literal(true),
});

export const retainStudyGuideSourceNotesSchema = z.object({
  confirm: z.literal(true),
});

export const abandonStudyOpenSessionsSchema = z.object({
  confirm: z.literal(true),
});

export const abandonStudyOpenSessionsResponseSchema = z.object({
  studyId: z.string().min(1),
  abandonedCount: z.number().int().min(0),
  activeSessionCount: z.number().int().min(0),
  pendingSessionCount: z.number().int().min(0),
  remainingOpenSessionCount: z.number().int().min(0),
});

export const studyGuideCleanupBridgeSchema = z.object({
  fromNodeId: z.string().min(1).nullable(),
  fromNodeKey: z.string().min(1).nullable(),
  toNodeId: z.string().min(1).nullable(),
  toNodeKey: z.string().min(1).nullable(),
});

export const studyGuideCleanupApplyResponseSchema = z.object({
  studyId: z.string().min(1),
  deletedNodeCount: z.number().int().min(0),
  deletedActionCount: z.number().int().min(0),
  deletedBranchRuleCount: z.number().int().min(0),
  deletedActionRuleCount: z.number().int().min(0),
  createdBranchRuleCount: z.number().int().min(0),
  createdActionRuleCount: z.number().int().min(0),
  movedNodeCount: z.number().int().min(0),
  sourceContextHintUpdatedNodeCount: z.number().int().min(0),
  sourceContextReferenceUpdatedNodeCount: z.number().int().min(0).default(0),
  retainedSourceContextHintCount: z.number().int().min(0),
  remainingScriptedResponseNodeCount: z.number().int().min(0),
  bridges: z.array(studyGuideCleanupBridgeSchema),
});

export const studyGuideSourceNoteRetentionResponseSchema = z.object({
  studyId: z.string().min(1),
  sourceContextHintUpdatedNodeCount: z.number().int().min(0),
  sourceContextReferenceUpdatedNodeCount: z.number().int().min(0).default(0),
  retainedSourceContextHintCount: z.number().int().min(0),
  remainingScriptedResponseNodeCount: z.number().int().min(0),
  updatedNodes: z.array(
    z.object({
      nodeId: z.string().min(1),
      nodeKey: z.string().min(1),
      title: z.string().min(1),
      sourceContextHint: z.string().min(1),
      sourceContextReferences: z.array(groundedReferenceSchema).default([]),
    }),
  ),
});

export const studyGraphResponseSchema = z.object({
  study: studySummarySchema,
  modules: z.array(studyGraphModuleSchema),
  nodes: z.array(studyGraphNodeSchema),
  edges: z.array(studyGraphEdgeSchema),
  assets: z.array(studyGraphAssetSchema),
  actions: z.array(studyGraphActionSchema),
  assetStageRules: z.array(studyGraphStageRuleSchema),
  adaptiveFlow: studyGraphAdaptiveFlowSchema,
  sourceContext: studyGraphSourceContextSchema,
  branchSuggestions: z.array(studyGraphBranchSuggestionSchema),
  routeReview: z.array(studyGraphRouteReviewGroupSchema),
  guideCleanup: studyGraphGuideCleanupSchema,
  sessionSummary: studyGraphSessionSummarySchema,
  recentSessions: z.array(researcherSessionSummarySchema),
});

export const studySettingsResponseSchema = z.object({
  studyId: z.string().min(1),
  studyName: z.string().min(1),
  customGptProjectId: z.string().min(1).nullable(),
  timeboxStrategy: timeboxStrategySchema,
  targetDurationSeconds: z.number().int().positive(),
  closingReserveSeconds: z.number().int().min(0),
  maxAttemptsPerQuestion: z.number().int().min(1).max(5),
  maxOffTopicRedirects: z.number().int().min(0).max(5),
  realtimeVoiceEnabled: z.boolean(),
  realtimeVoiceRequiredForFielding: z.boolean(),
  fieldingReadiness: z.object({
    status: z.enum(["ready", "needs_setup"]),
    questionCount: z.number().int().min(0),
    interviewQuestionCount: z.number().int().min(0),
    sourceContextQuestionCount: z.number().int().min(0),
    assetCount: z.number().int().min(0),
    timeboxStrategy: timeboxStrategySchema,
    estimatedGuideSeconds: z.number().int().min(0),
    availableInterviewSeconds: z.number().int().min(0),
    estimatedQuestionCapacity: z.number().int().min(0),
    estimatedOverageSeconds: z.number().int().min(0),
    recommendedTargetDurationSeconds: z.number().int().min(0),
    timeboxWillSkipQuestions: z.boolean(),
    guardrails: z.object({
      maxAttemptsPerQuestion: z.number().int().min(1).max(5),
      maxOffTopicRedirects: z.number().int().min(0).max(5),
      noFixationReady: z.boolean(),
      offSurveyReturnReady: z.boolean(),
    }),
    adaptiveRouting: z.object({
      status: z.enum(["incomplete", "sequential_only", "adaptive"]),
      totalRuleCount: z.number().int().min(0),
      sequentialRuleCount: z.number().int().min(0),
      conditionalRuleCount: z.number().int().min(0),
      conditionalSourceCount: z.number().int().min(0),
      conditionalSourceWithoutFallbackCount: z.number().int().min(0),
      hasConditionalRouting: z.boolean(),
      isSequentialOnly: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    customGpt: z.object({
      apiKeyConfigured: z.boolean(),
      projectConfigured: z.boolean(),
      enabled: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    sourceContext: z.object({
      questionCount: z.number().int().min(0),
      approvedNoteQuestionCount: z.number().int().min(0),
      missingApprovedNoteQuestionCount: z.number().int().min(0),
      approvedNotesCoverAll: z.boolean(),
      fieldingReady: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    voice: z.object({
      openAiConfigured: z.boolean(),
      recordedAvailable: z.boolean(),
      realtimeEnabledForStudy: z.boolean(),
      realtimeAvailable: z.boolean(),
      realtimeRequiredForFielding: z.boolean(),
      fieldingReady: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    warnings: z.array(z.string().min(1)),
  }),
});

export const studyCustomGptVerificationResponseSchema = z.object({
  studyId: z.string().min(1),
  studyName: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  verificationMode: z.enum(["source_context_question", "general_project"]),
  sourceContextQuestionId: z.string().min(1).nullable(),
  sourceContextQuestionTitle: z.string().min(1).nullable(),
  sourceContextQuestionPrompt: z.string().min(1).nullable(),
  status: integrationVerificationStatusSchema,
  checked: z.boolean(),
  responseReceived: z.boolean(),
  referenceCount: z.number().int().min(0),
  latencyMs: z.number().int().min(0).nullable(),
  reason: z.string().min(1).nullable(),
  answerPreview: z.string().min(1).nullable(),
});

export const updateStudyQuestionGroundingSchema = z.object({
  requiresGroundedStudyContext: z.boolean(),
  sourceContextHint: z.string().trim().min(1).nullable().optional(),
  sourceContextReferences: z.array(groundedReferenceSchema).optional(),
});

export const studyQuestionGroundingResponseSchema = z.object({
  studyId: z.string().min(1),
  nodeId: z.string().min(1),
  requiresGroundedStudyContext: z.boolean(),
  sourceContextDetected: z.boolean(),
  sourceContextOverride: z.boolean().nullable(),
  sourceContextHint: z.string().min(1).nullable(),
  sourceContextReferences: z.array(groundedReferenceSchema).default([]),
});

export const updateStudySourceContextNotesSchema = z.object({
  notes: z
    .array(
      z.object({
        nodeId: z.string().trim().min(1),
        sourceContextHint: z.string().trim().min(1),
        sourceContextReferences: z
          .array(groundedReferenceSchema)
          .optional()
          .default([]),
      }),
    )
    .min(1)
    .max(250),
});

export const updateStudySourceContextNotesResponseSchema = z.object({
  studyId: z.string().min(1),
  appliedCount: z.number().int().min(0),
  questions: z.array(studyQuestionGroundingResponseSchema),
});

export const studyQuestionGroundingPreviewResponseSchema = z.object({
  studyId: z.string().min(1),
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  questionTitle: z.string().min(1),
  questionPrompt: z.string().min(1),
  generatedAt: z.string().datetime(),
  projectId: z.string().min(1).nullable(),
  source: z.enum(["customgpt", "imported_guide", "none"]).default("none"),
  status: integrationVerificationStatusSchema,
  checked: z.boolean(),
  assetTitle: z.string().min(1).nullable(),
  answer: z.string().min(1).nullable(),
  references: z.array(groundedReferenceSchema),
  referenceCount: z.number().int().min(0),
  reason: z.string().min(1).nullable(),
});

export const studySourceContextPreviewResponseSchema = z.object({
  studyId: z.string().min(1),
  generatedAt: z.string().datetime(),
  status: integrationVerificationStatusSchema,
  previewCount: z.number().int().min(0),
  passedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  previews: z.array(studyQuestionGroundingPreviewResponseSchema),
});

export const addStudyCustomGptSitemapSourceSchema = z.object({
  sitemapPath: z.string().trim().url(),
});

export const addStudyCustomGptAssetSourceSchema = z.object({
  assetId: z.string().trim().min(1),
});

export const studyCustomGptSourceSummarySchema = z.object({
  sourceId: z.string().min(1),
  type: z.string().min(1),
  path: z.string().min(1).nullable(),
  createdAt: z.string().min(1).nullable(),
  updatedAt: z.string().min(1).nullable(),
  pageCount: z.number().int().min(0),
  indexedPageCount: z.number().int().min(0),
  queuedPageCount: z.number().int().min(0),
  failedPageCount: z.number().int().min(0),
  limitedPageCount: z.number().int().min(0),
});

export const studyCustomGptSourcesResponseSchema = z.object({
  studyId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  enabled: z.boolean(),
  reason: z.string().min(1).nullable(),
  added: z.boolean().default(false),
  sources: z.array(studyCustomGptSourceSummarySchema),
});

export const createStudyBranchRuleSchema = z.object({
  fromNodeId: z.string().trim().min(1),
  toNodeId: z.string().trim().min(1),
  matchKeywords: z.array(z.string().trim().min(1)).min(1).max(12),
  factKey: z.string().trim().min(1).optional(),
  rationale: z.string().trim().min(1).optional(),
});

export const createStudyBranchRulesSchema = z.object({
  rules: z.array(createStudyBranchRuleSchema).min(1).max(50),
});

export const studyBranchRuleMutationResponseSchema = z.object({
  studyId: z.string().min(1),
  rule: studyGraphEdgeSchema,
});

export const studyBranchRuleBatchMutationResponseSchema = z.object({
  studyId: z.string().min(1),
  rules: z.array(studyGraphEdgeSchema),
  createdCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
});

export const studyRecommendedBranchRouteDryRunSchema = z.object({
  suggestionId: z.string().min(1),
  fromNodeTitle: z.string().min(1),
  toNodeTitle: z.string().min(1),
  sampleAnswer: z.string().min(1),
  status: z.enum(["pass", "fail"]),
  detail: z.string().min(1),
});

export const studyRecommendedBranchRulesApplyResponseSchema = z.object({
  studyId: z.string().min(1),
  suggestionCount: z.number().int().min(0),
  recommendedCount: z.number().int().min(0),
  rules: z.array(studyGraphEdgeSchema),
  createdCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  dryRunCount: z.number().int().min(0),
  passedDryRunCount: z.number().int().min(0),
  failedDryRunCount: z.number().int().min(0),
  dryRuns: z.array(studyRecommendedBranchRouteDryRunSchema),
});

export const simulateStudyBranchRouteSchema = z.object({
  fromNodeId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(5000),
});

export const studyBranchRouteNodeRefSchema = z.object({
  nodeId: z.string().min(1),
  nodeKey: z.string().min(1),
  title: z.string().min(1),
});

export const studyBranchRouteEvaluationSchema = z.object({
  rule: studyGraphEdgeSchema,
  targetNode: studyBranchRouteNodeRefSchema,
  matched: z.boolean(),
  reason: z.string().min(1),
});

export const studyBranchRouteSimulationResponseSchema = z.object({
  studyId: z.string().min(1),
  fromNode: studyBranchRouteNodeRefSchema,
  answer: z.string().min(1),
  selectedRule: studyGraphEdgeSchema.nullable(),
  selectedTargetNode: studyBranchRouteNodeRefSchema.nullable(),
  selectedReason: z.string().min(1),
  matchedCondition: z.boolean(),
  evaluatedRules: z.array(studyBranchRouteEvaluationSchema),
  fallbackRule: studyGraphEdgeSchema.nullable(),
});

export const createStudyAssetSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    assetType: studyAssetTypeSchema.optional(),
    storageKey: z.string().trim().min(1).optional(),
    fileName: z.string().trim().min(1).optional(),
    fileBase64: z.string().min(1).optional(),
    mimeType: z.string().trim().min(1).optional(),
    displayMode: assetDisplayModeSchema.default("INLINE_PANE"),
    stageNodeId: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.storageKey || value.fileBase64, {
    message: "Provide an uploaded file or a URL/path for the asset.",
    path: ["fileBase64"],
  });

export const studyAssetMutationResponseSchema = z.object({
  studyId: z.string().min(1),
  asset: studyGraphAssetSchema,
  action: studyGraphActionSchema,
  stageRule: studyGraphStageRuleSchema,
});

export const updateStudyAssetDisplayModeSchema = z.object({
  displayMode: assetDisplayModeSchema,
});

export const studyAssetDisplayModeResponseSchema = z.object({
  studyId: z.string().min(1),
  assetId: z.string().min(1),
  displayMode: assetDisplayModeSchema,
  updatedStageRuleCount: z.number().int().min(0),
  updatedActiveSessionAssetCount: z.number().int().min(0),
  stageRules: z.array(studyGraphStageRuleSchema),
});

export const studyLaunchCheckItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["pass", "warning", "fail"]),
  detail: z.string().min(1),
  action: z.string().min(1).nullable(),
  actionHref: z.string().min(1).nullable().default(null),
});

export const studyLaunchRecommendedActionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  severity: z.enum(["blocker", "warning"]),
  sourceStatus: z.enum(["warning", "fail"]),
  order: z.number().int().positive(),
  category: z.enum([
    "guide",
    "routing",
    "source_context",
    "asset",
    "voice",
    "testing",
    "settings",
  ]),
  action: z.string().min(1),
  actionLabel: z.string().min(1).nullable().default(null),
  actionHref: z.string().min(1).nullable().default(null),
});

export const studyLaunchCheckResponseSchema = z.object({
  studyId: z.string().min(1),
  studyName: z.string().min(1),
  generatedAt: z.string().datetime(),
  status: z.enum(["ready", "needs_setup"]),
  blockingItemCount: z.number().int().min(0),
  warningItemCount: z.number().int().min(0),
  recommendedActions: z.array(studyLaunchRecommendedActionSchema),
  items: z.array(studyLaunchCheckItemSchema),
});

export const studyLaunchSmokeTestResponseSchema = z.object({
  studyId: z.string().min(1),
  studyName: z.string().min(1),
  generatedAt: z.string().datetime(),
  status: z.enum(["passed", "failed"]),
  temporarySessionId: z.string().min(1).nullable(),
  cleanedUp: z.boolean(),
  checks: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      status: z.enum(["pass", "warning", "fail"]),
      detail: z.string().min(1),
    }),
  ),
  firstQuestion: z
    .object({
      nodeKey: z.string().min(1),
      title: z.string().min(1),
    })
    .nullable(),
  currentAsset: z
    .object({
      key: z.string().min(1),
      title: z.string().min(1),
      assetType: studyAssetTypeSchema,
      displayMode: assetDisplayModeSchema.nullable(),
    })
    .nullable(),
  capabilities: z.object({
    recordedVoiceEnabled: z.boolean(),
    realtimeVoiceEnabled: z.boolean(),
    customGptLikelyAvailable: z.boolean(),
  }),
});

export const updateStudySettingsSchema = z.object({
  customGptProjectId: z.string().trim().min(1).nullable().optional(),
  timeboxStrategy: timeboxStrategySchema.optional(),
  targetDurationSeconds: z.number().int().positive().optional(),
  closingReserveSeconds: z.number().int().min(0).optional(),
  maxAttemptsPerQuestion: z.number().int().min(1).max(5).optional(),
  maxOffTopicRedirects: z.number().int().min(0).max(5).optional(),
  realtimeVoiceEnabled: z.boolean().optional(),
  realtimeVoiceRequiredForFielding: z.boolean().optional(),
});

export const surveyImportQuestionSchema = z.object({
  key: z.string().min(1),
  moduleKey: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  mustAsk: z.boolean(),
  condition: z
    .object({
      source: z.string().min(1),
      sourceQuestionKey: z.string().min(1).nullable(),
      matchKeywords: z.array(z.string().min(1)).min(1),
    })
    .nullable(),
  factKeys: z.array(z.string().min(1)),
  estimatedSeconds: z.number().int().positive(),
  requiresGroundedStudyContext: z.boolean().default(false),
  sourceContextHint: z.string().min(1).nullable().default(null),
  sourceLine: z.number().int().positive().nullable(),
});

export const surveyImportModuleSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  position: z.number().int().positive(),
});

export const surveyImportAssetSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  assetType: studyAssetTypeSchema,
  storageKey: z.string().min(1),
  mimeType: z.string().min(1).nullable(),
  fileName: z.string().min(1).nullable(),
  fileBase64: z.string().min(1).nullable(),
  displayMode: assetDisplayModeSchema,
});

export const surveyImportPreviewSchema = z.object({
  sourceName: z.string().min(1),
  studyName: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1).nullable(),
  targetDurationSeconds: z.number().int().positive(),
  closingReserveSeconds: z.number().int().min(0),
  maxAttemptsPerQuestion: z.number().int().min(1).max(5),
  maxOffTopicRedirects: z.number().int().min(0).max(5),
  customGptProjectId: z.string().min(1).nullable(),
  asset: surveyImportAssetSchema.nullable(),
  modules: z.array(surveyImportModuleSchema).min(1),
  questions: z.array(surveyImportQuestionSchema).min(1),
  warnings: z.array(z.string().min(1)),
});

export const previewSurveyImportRequestSchema = z
  .object({
    sourceText: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    fileBase64: z.string().min(1).optional(),
    studyName: z.string().min(1).optional(),
    targetDurationMinutes: z.number().positive().max(240).optional(),
    customGptProjectId: z.string().trim().min(1).nullable().optional(),
    assetTitle: z.string().trim().min(1).optional(),
    assetDescription: z.string().trim().min(1).optional(),
    assetStorageKey: z.string().trim().min(1).optional(),
    assetFileName: z.string().trim().min(1).optional(),
    assetFileBase64: z.string().min(1).optional(),
    assetMimeType: z.string().trim().min(1).optional(),
    assetType: studyAssetTypeSchema.optional(),
    assetDisplayMode: assetDisplayModeSchema.optional(),
  })
  .refine((value) => value.sourceText || value.fileBase64, {
    message: "Provide sourceText or fileBase64.",
    path: ["sourceText"],
  });

export const publishSurveyImportRequestSchema = z.object({
  preview: surveyImportPreviewSchema,
});

export const publishSurveyImportResponseSchema = z.object({
  study: studySummarySchema,
});

export const startTestSessionRequestSchema = z.object({
  startNodeId: z.string().trim().min(1).optional(),
});

export const transcriptTurnGroundingSchema = z.object({
  kind: z.enum(["clinical_study_context", "clarification_answer"]),
  answer: z.string().min(1),
  references: z.array(groundedReferenceSchema),
  contextQuestion: z.string().min(1).nullable().default(null),
  assetTitle: z.string().min(1).nullable().default(null),
  generatedAt: z.string().datetime().nullable().default(null),
});

export const transcriptTurnSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "interviewer", "participant"]),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  nodeKey: z.string().nullable(),
  grounding: transcriptTurnGroundingSchema.nullable().default(null),
});

export const respondentSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  studyId: z.string().min(1),
  studyName: z.string().min(1),
  status: z.enum(["active", "completed", "stopped"]),
  capabilities: z.object({
    customGptGrounding: z.object({
      enabled: z.boolean(),
      configured: z.boolean(),
      projectConfigured: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    recordedVoice: z.object({
      enabled: z.boolean(),
      reason: z.string().min(1).nullable(),
    }),
    realtimeVoice: z.object({
      enabled: z.boolean(),
      model: z.string().min(1).nullable(),
      reason: z.string().min(1).nullable(),
    }),
  }),
  timing: z.object({
    startedAt: z.string().datetime().nullable(),
    targetDurationSeconds: z.number().int().positive(),
    elapsedSeconds: z.number().int().min(0),
    remainingSeconds: z.number().int().min(0),
    isOverTime: z.boolean(),
  }),
  transcript: z.array(transcriptTurnSchema),
  currentQuestion: z
    .object({
      nodeId: z.string().min(1),
      nodeKey: z.string().min(1),
      title: z.string().min(1),
      prompt: z.string().min(1),
      attemptCount: z.number().int().min(0).default(0),
      maxAttempts: z.number().int().min(1).default(2),
    })
    .nullable(),
  currentAction: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      actionType: studyActionTypeSchema,
    })
    .nullable(),
  currentAsset: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      title: z.string().min(1),
      description: z.string().nullable(),
      assetType: studyAssetTypeSchema,
      storageKey: z.string().min(1),
      mimeType: z.string().nullable(),
      displayMode: assetDisplayModeSchema.nullable(),
      shownAt: z.string().datetime().nullable(),
      reaction: assetReactionSummarySchema.nullable().default(null),
    })
    .nullable(),
  thankYouMessage: z.string().nullable(),
});

export const respondentAnswerIntentSchema = z
  .enum(["answer", "skip"])
  .default("answer");

export const submitRespondentAnswerSchema = z.object({
  content: z.string().min(1),
  intent: respondentAnswerIntentSchema,
});

export const submitAssetReactionSchema = z.object({
  kind: assetReactionKindSchema,
  status: assetReactionStatusSchema.default("COMPLETED"),
});

export const assetReactionResponseSchema = z.object({
  reaction: assetReactionSummarySchema,
  session: respondentSessionResponseSchema,
});

export const submitRespondentRealtimeAnswerSchema = z.object({
  content: z.string().min(1),
  sourceEventType: z
    .enum([
      "conversation.item.input_audio_transcription.completed",
      "manual_realtime_transcript",
    ])
    .default("conversation.item.input_audio_transcription.completed"),
  transcriptItemId: z.string().min(1).nullable().optional(),
  realtimeSessionExpiresAt: z.string().datetime().nullable().optional(),
  transport: z
    .literal("openai_realtime_webrtc")
    .default("openai_realtime_webrtc"),
});

export const voiceAnswerVoiceSchema = z.enum([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

export const submitRespondentVoiceAnswerSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z
    .string()
    .min(1)
    .refine((value) => value.toLowerCase().startsWith("audio/"), {
      message: "mimeType must be an audio MIME type.",
    }),
  voice: voiceAnswerVoiceSchema.default("nova"),
});

export const submitRespondentAnswerResponseSchema = z.object({
  analysis: analysisResultSchema,
  decision: z.object({
    action: z.string().min(1),
    selectedNodeId: z.string().nullable(),
    selectedNodeKey: z.string().nullable(),
    rationale: z.string().min(1),
    source: z.string().min(1),
  }),
  session: respondentSessionResponseSchema,
});

export const submitRespondentVoiceAnswerResponseSchema = z.object({
  transcript: z.string().min(1),
  spokenText: z.string().min(1).nullable(),
  audio: z
    .object({
      mimeType: z.literal("audio/mpeg"),
      base64: z.string().min(1),
    })
    .nullable(),
  answer: submitRespondentAnswerResponseSchema,
});

export const realtimeVoiceSessionResponseSchema = z.object({
  enabled: z.boolean(),
  model: z.string().min(1).nullable(),
  clientSecret: z.string().min(1).nullable(),
  expiresAt: z.string().datetime().nullable(),
  instructions: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
});

export const turnAuditDecisionOutputSummarySchema = z.object({
  action: interviewDecisionActionSchema.optional(),
  selectedNodeId: z.string().min(1).nullable().optional(),
  selectedNodeKey: z.string().min(1).nullable().optional(),
  source: z.string().min(1).optional(),
});

export const turnAuditItemSchema = z.object({
  turnId: z.string().min(1),
  nodeKey: z.string().nullable(),
  question: z
    .object({
      turnId: z.string().min(1),
      content: z.string().min(1),
      createdAt: z.string().datetime(),
      payload: z.unknown().nullable().default(null),
      grounding: z
        .object({
          kind: z.literal("clinical_study_context"),
          answer: z.string().min(1),
          references: z.array(groundedReferenceSchema),
          contextQuestion: z.string().min(1).nullable().default(null),
          assetTitle: z.string().min(1).nullable().default(null),
          generatedAt: z.string().datetime().nullable().default(null),
        })
        .nullable(),
    })
    .nullable(),
  response: z.object({
    turnId: z.string().min(1),
    content: z.string().min(1),
    createdAt: z.string().datetime(),
    payload: z.unknown().nullable(),
  }),
  asset: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      title: z.string().min(1),
      assetType: studyAssetTypeSchema,
      displayMode: assetDisplayModeSchema.nullable(),
      shownAt: z.string().datetime().nullable(),
      reaction: assetReactionSummarySchema.nullable().default(null),
    })
    .nullable(),
  analysis: z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    status: z.string().min(1),
    output: z.unknown(),
    groundedResponse: z.string().min(1).nullable(),
    groundedReferences: z.array(groundedReferenceSchema),
  }),
  decision: z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    status: z.string().min(1),
    action: interviewDecisionActionSchema.nullable(),
    selectedNodeId: z.string().min(1).nullable(),
    selectedNodeKey: z.string().min(1).nullable(),
    selectedNodeTitle: z.string().min(1).nullable(),
    source: z.string().min(1).nullable(),
    rationale: z.string().nullable(),
    output: z.unknown(),
  }),
});

export const sessionAuditGuardrailsSchema = z.object({
  timing: z.object({
    startedAt: z.string().datetime().nullable(),
    targetDurationSeconds: z.number().int().positive(),
    elapsedSeconds: z.number().int().min(0),
    remainingSeconds: z.number().int().min(0),
    isOverTime: z.boolean(),
  }),
  attempts: z.object({
    maxAttemptsPerQuestion: z.number().int().min(1).max(5),
    attemptedQuestionCount: z.number().int().min(0),
    highestAttemptCount: z.number().int().min(0),
    counts: z.array(
      z.object({
        nodeId: z.string().min(1),
        nodeKey: z.string().min(1).nullable(),
        title: z.string().min(1).nullable(),
        attemptCount: z.number().int().min(0),
      }),
    ),
  }),
  offSurvey: z.object({
    redirectCount: z.number().int().min(0),
    maxRedirects: z.number().int().min(0),
    remainingRedirects: z.number().int().min(0),
    isAtLimit: z.boolean(),
  }),
});

export const sessionAuditResponseSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    studyId: z.string().min(1),
    studyName: z.string().min(1),
    status: z.string().min(1),
    respondentLabel: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    currentNodeKey: z.string().nullable(),
  }),
  transcript: z.array(transcriptTurnSchema),
  currentQuestion: z
    .object({
      turnId: z.string().min(1),
      nodeKey: z.string().nullable(),
      content: z.string().min(1),
      createdAt: z.string().datetime(),
      payload: z.unknown().nullable().default(null),
      grounding: transcriptTurnGroundingSchema.nullable().default(null),
    })
    .nullable(),
  sessionAssets: z.array(
    z.object({
      id: z.string().min(1),
      assetKey: z.string().min(1),
      title: z.string().min(1),
      assetType: studyAssetTypeSchema,
      displayMode: assetDisplayModeSchema.nullable(),
      shownAt: z.string().datetime().nullable(),
      sourceActionKey: z.string().nullable(),
      reaction: assetReactionSummarySchema.nullable().default(null),
    }),
  ),
  guardrails: sessionAuditGuardrailsSchema,
  turnAudit: z.array(turnAuditItemSchema),
});

export const mvpCustomGptSurveyStartRequestSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  surveySlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .default("brukinsa"),
  surveyIntentSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  studyName: z.string().trim().min(1).max(160).optional(),
  targetDurationSeconds: z.number().int().min(60).max(3600).default(600),
  guide: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
});

const mvpSurveyIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]+$/);

export const mvpGuideQuestionDefinitionSchema = z.object({
  id: mvpSurveyIdSchema,
  module: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  canonicalQuestion: z.string().trim().min(1),
  sourceContextRequirement: z.string().trim().min(1).nullable(),
  routeKeywords: z.array(z.string().trim().min(1)).default([]),
  completionSignals: z.array(z.string().trim().min(1)).default([]),
  adaptiveProbes: z.array(z.string().trim().min(1)).default([]),
  analyzableOutputs: z.array(z.string().trim().min(1)).default([]),
  close: z.boolean().optional(),
});

export const mvpSurveyIntentDefinitionSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/),
  label: z.string().trim().min(1),
  primaryIntent: z.string().trim().min(1),
  requiredCoverage: z.array(z.string().trim().min(1)).default([]),
  steeringRule: z.string().trim().min(1),
  questionOrder: z.array(mvpSurveyIdSchema).min(1),
  allowedQuestionIds: z.array(mvpSurveyIdSchema).optional(),
  blockedQuestionIds: z.array(mvpSurveyIdSchema).optional(),
  offLaneSourceRule: z.string().trim().min(1).optional(),
});

export const mvpSurveyDefinitionContractSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/),
  defaultStudyName: z.string().trim().min(1),
  sourceBrand: z.string().trim().min(1),
  guide: z.array(mvpGuideQuestionDefinitionSchema).min(1),
  intents: z.array(mvpSurveyIntentDefinitionSchema).default([]),
});

export type MvpSurveyIntentDefinition = z.infer<
  typeof mvpSurveyIntentDefinitionSchema
>;

export const mvpCustomGptSurveyTurnRequestSchema = z.object({
  sessionId: z.string().min(1),
  surveySlug: z.enum(["brukinsa", "padcev", "data", "nubeqa"]).optional(),
  content: z.string().trim().min(1).max(4000),
});

export const mvpCustomGptSurveyVoiceTurnRequestSchema =
  submitRespondentVoiceAnswerSchema.extend({
    sessionId: z.string().min(1),
    surveySlug: z.enum(["brukinsa", "padcev", "data", "nubeqa"]).optional(),
  });

export const mvpCustomGptSurveyVoiceTranscribeRequestSchema =
  submitRespondentVoiceAnswerSchema
    .pick({
      audioBase64: true,
      mimeType: true,
    })
    .extend({
      sessionId: z.string().min(1).optional(),
    });

export const mvpCustomGptSurveyMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["interviewer", "participant"]),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  references: z.array(groundedReferenceSchema).default([]),
});

export const mvpCustomGptSurveyResponseSchema = z.object({
  sessionId: z.string().min(1),
  surveySlug: z.enum(["brukinsa", "padcev", "data", "nubeqa"]),
  sourceBrand: z.string().min(1),
  studyName: z.string().min(1),
  status: z.enum(["active", "completed", "needs_setup"]),
  projectId: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  elapsedSeconds: z.number().int().min(0),
  remainingSeconds: z.number().int().min(0),
  targetDurationSeconds: z.number().int().min(60),
  turnCount: z.number().int().min(0),
  askedQuestions: z.array(z.string().min(1)),
  currentQuestion: z.string().min(1).nullable(),
  nextAction: z.enum(["ask", "answer_then_ask", "wrap_up", "setup_required"]),
  customGptEnabled: z.boolean(),
  reason: z.string().min(1).nullable(),
  messages: z.array(mvpCustomGptSurveyMessageSchema),
});

const mvpSurveyAuditSessionSummarySchema = z.object({
  id: z.string().min(1),
  studyName: z.string().min(1),
  studySlug: z.string().min(1),
  status: z.string().min(1),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  surveySlug: z.string().min(1).nullable(),
  sourceBrand: z.string().min(1).nullable(),
  surveyIntentLabel: z.string().min(1).nullable(),
  currentQuestionId: z.string().min(1).nullable(),
  currentQuestion: z.string().min(1).nullable(),
  completedReason: z.string().min(1).nullable(),
  turnCount: z.number().int().min(0),
  decisionCount: z.number().int().min(0),
});

export const mvpSurveyAuditListResponseSchema = z.object({
  dbConfigured: z.boolean(),
  generatedAt: z.string().datetime(),
  sessions: z.array(mvpSurveyAuditSessionSummarySchema),
});

export const mvpSurveyAuditTurnSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().min(1),
  role: z.string().min(1),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  payload: z.unknown().nullable(),
});

export const mvpSurveyAuditDecisionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.string().min(1),
  rationale: z.string().nullable(),
  createdAt: z.string().datetime(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
});

export const mvpSurveyAuditDetailResponseSchema = z.object({
  dbConfigured: z.boolean(),
  generatedAt: z.string().datetime(),
  session: mvpSurveyAuditSessionSummarySchema,
  turns: z.array(mvpSurveyAuditTurnSchema),
  decisions: z.array(mvpSurveyAuditDecisionSchema),
});

export const mvpCustomGptSurveyVoiceTurnResponseSchema = z.object({
  transcript: z.string().min(1),
  spokenText: z.string().min(1).nullable(),
  audio: z
    .object({
      mimeType: z.literal("audio/mpeg"),
      base64: z.string().min(1),
    })
    .nullable(),
  survey: mvpCustomGptSurveyResponseSchema,
});

export const mvpCustomGptSurveyVoiceTranscribeResponseSchema = z.object({
  transcript: z.string().min(1),
});

export const mvpCustomGptSurveySpeechRequestSchema = z.object({
  sessionId: z.string().min(1),
  voice: voiceAnswerVoiceSchema.default("nova"),
});

export const mvpCustomGptSurveySpeechResponseSchema = z.object({
  spokenText: z.string().min(1).nullable(),
  audio: z
    .object({
      mimeType: z.literal("audio/mpeg"),
      base64: z.string().min(1),
    })
    .nullable(),
});

export const mvpCustomGptSourcePreviewRequestSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(240).optional(),
  assets: groundedReferenceSchema.shape.assets.optional(),
});

export const mvpCustomGptSourcePreviewImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().min(1).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  source: z.enum(["open_graph", "twitter", "html_image", "source_library"]),
});

export const mvpCustomGptSourcePreviewDocumentSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  description: z.string().min(1).nullable(),
  isPdf: z.boolean(),
  source: z.enum(["pdf_link", "html_link", "source_library"]),
});

export const mvpCustomGptSourcePreviewResponseSchema = z.object({
  sourceUrl: z.string().url(),
  title: z.string().min(1).nullable(),
  images: z.array(mvpCustomGptSourcePreviewImageSchema).max(6),
  documents: z.array(mvpCustomGptSourcePreviewDocumentSchema).max(8),
  reason: z.string().min(1).nullable(),
});

export const sourceDocumentTypeSchema = z.enum([
  "URL",
  "PDF",
  "TEXT",
  "MANUAL_NOTE",
]);

export const sourceDocumentStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
]);

export const sourceAssetKindSchema = z.enum([
  "CHART",
  "TABLE",
  "PDF",
  "IMAGE",
  "VIDEO",
  "LINK",
  "OTHER",
]);

const sourceAssetKindInputSchema = z.union([
  sourceAssetKindSchema,
  z.string().trim().min(1).max(80),
]);

export const sourceLibrarySurveySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/);

export const sourceLibraryAssetInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1000).optional(),
  assetKind: sourceAssetKindInputSchema.default("LINK"),
  url: z.string().trim().url(),
  tags: z.array(z.string().trim().min(1).max(80)).default([]),
  priority: z.number().int().min(0).max(100).default(0),
});

const sourceLibraryDocumentInputBaseSchema = z.object({
  surveySlug: sourceLibrarySurveySlugSchema,
  sourceBrand: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1000).optional(),
  sourceType: sourceDocumentTypeSchema,
  url: z.string().trim().url().optional(),
  content: z.string().trim().min(1).max(60000).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).default([]),
  priority: z.number().int().min(0).max(100).default(0),
  status: sourceDocumentStatusSchema.default("DRAFT"),
  assets: z.array(sourceLibraryAssetInputSchema).max(24).default([]),
});

function sourceLibraryDocumentHasSource(input: {
  url?: string;
  content?: string;
}) {
  return Boolean(input.url || input.content);
}

export const createSourceLibraryDocumentSchema =
  sourceLibraryDocumentInputBaseSchema.refine(sourceLibraryDocumentHasSource, {
    message: "Provide either a source URL or pasted source content.",
    path: ["url"],
  });

export const sourceLibraryDocumentSchema = z.object({
  id: z.string().min(1),
  surveySlug: z.string().min(1),
  sourceBrand: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  sourceType: sourceDocumentTypeSchema,
  url: z.string().url().nullable(),
  contentPreview: z.string().nullable(),
  tags: z.array(z.string()),
  priority: z.number().int(),
  status: sourceDocumentStatusSchema,
  chunkCount: z.number().int().min(0),
  assetCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const sourceLibraryListResponseSchema = z.object({
  dbConfigured: z.boolean(),
  generatedAt: z.string().datetime(),
  documents: z.array(sourceLibraryDocumentSchema),
});

export const sourceLibraryMutationResponseSchema = z.object({
  document: sourceLibraryDocumentSchema,
});

const sourceLibraryBulkDocumentSchema = sourceLibraryDocumentInputBaseSchema
  .omit({
    surveySlug: true,
    sourceBrand: true,
  })
  .extend({
    surveySlug: sourceLibrarySurveySlugSchema.optional(),
    sourceBrand: z.string().trim().min(1).max(80).optional(),
  })
  .refine(sourceLibraryDocumentHasSource, {
    message: "Provide either a source URL or pasted source content.",
    path: ["url"],
  });

export const sourceLibraryBulkImportSchema = z.object({
  surveySlug: sourceLibrarySurveySlugSchema,
  sourceBrand: z.string().trim().min(1).max(80),
  replaceExisting: z.boolean().default(false),
  documents: z.array(sourceLibraryBulkDocumentSchema).min(1).max(200),
});

export const sourceLibraryBulkImportResponseSchema = z.object({
  dbConfigured: z.boolean(),
  generatedAt: z.string().datetime(),
  importedCount: z.number().int().min(0),
  documents: z.array(sourceLibraryDocumentSchema),
});

export type InterviewTurn = z.infer<typeof interviewTurnSchema>;
export type ResearchGoal = z.infer<typeof researchGoalSchema>;
export type QuestionCandidate = z.infer<typeof questionCandidateSchema>;
export type SelectorInput = z.infer<typeof selectorInputSchema>;
export type SelectionDecision = z.infer<typeof selectionDecisionSchema>;
export type PhrasingInput = z.infer<typeof phrasingInputSchema>;
export type PhrasingResult = z.infer<typeof phrasingResultSchema>;
export type ControlledRagCompositionInput = z.infer<
  typeof controlledRagCompositionInputSchema
>;
export type ControlledRagCompositionResult = z.infer<
  typeof controlledRagCompositionResultSchema
>;
export type MvpTurnRouteKind = z.infer<typeof mvpTurnRouteKindSchema>;
export type MvpDisplayTopic = z.infer<typeof mvpDisplayTopicSchema>;
export type MvpTurnRouteCandidate = z.infer<typeof mvpTurnRouteCandidateSchema>;
export type MvpTurnRouteAnalysisInput = z.infer<
  typeof mvpTurnRouteAnalysisInputSchema
>;
export type MvpTurnRouteAnalysisResult = z.infer<
  typeof mvpTurnRouteAnalysisResultSchema
>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type IntegrationReadinessResponse = z.infer<
  typeof integrationReadinessResponseSchema
>;
export type IntegrationSetupAction = z.infer<
  typeof integrationSetupActionSchema
>;
export type IntegrationVerificationResponse = z.infer<
  typeof integrationVerificationResponseSchema
>;
export type LocalEnvironmentConfigResponse = z.infer<
  typeof localEnvironmentConfigResponseSchema
>;
export type UpdateLocalEnvironmentConfig = z.infer<
  typeof updateLocalEnvironmentConfigSchema
>;
export type StudyAssetType = z.infer<typeof studyAssetTypeSchema>;
export type StudyActionType = z.infer<typeof studyActionTypeSchema>;
export type ActionRuleType = z.infer<typeof actionRuleTypeSchema>;
export type AssetDisplayMode = z.infer<typeof assetDisplayModeSchema>;
export type TimeboxStrategy = z.infer<typeof timeboxStrategySchema>;
export type AssetStageTriggerType = z.infer<typeof assetStageTriggerTypeSchema>;
export type CandidateActionReasonCode = z.infer<
  typeof candidateActionReasonCodeSchema
>;
export type AssetReactionKind = z.infer<typeof assetReactionKindSchema>;
export type AssetReactionStatus = z.infer<typeof assetReactionStatusSchema>;
export type FactValue = z.infer<typeof factValueSchema>;
export type ContradictionFlag = z.infer<typeof contradictionFlagSchema>;
export type SurveyTurnIntent = z.infer<typeof surveyTurnIntentSchema>;
export type ParticipantTurnInput = z.input<typeof participantTurnInputSchema>;
export type ParsedParticipantTurnInput = z.infer<
  typeof participantTurnInputSchema
>;
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type GroundedReference = z.infer<typeof groundedReferenceSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type DecisionCandidate = z.infer<typeof decisionCandidateSchema>;
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export type DecisionResult = z.infer<typeof decisionResultSchema>;
export type InterviewDecisionAction = z.infer<
  typeof interviewDecisionActionSchema
>;
export type SessionStateJson = z.infer<typeof sessionStateJsonSchema>;
export type OpenAIDebugTrace = z.infer<typeof openAIDebugTraceSchema>;
export type StudyAsset = z.infer<typeof studyAssetSchema>;
export type StudyAction = z.infer<typeof studyActionSchema>;
export type ActionRule = z.infer<typeof actionRuleSchema>;
export type AssetStageRule = z.infer<typeof assetStageRuleSchema>;
export type SessionAsset = z.infer<typeof sessionAssetSchema>;
export type CandidateAction = z.infer<typeof candidateActionSchema>;
export type AssetReaction = z.infer<typeof assetReactionSchema>;
export type AssetReactionSummary = z.infer<typeof assetReactionSummarySchema>;
export type StudySummary = z.infer<typeof studySummarySchema>;
export type ResearcherSessionSummary = z.infer<
  typeof researcherSessionSummarySchema
>;
export type StudyGraphResponse = z.infer<typeof studyGraphResponseSchema>;
export type StudyGraphSourceContext = z.infer<
  typeof studyGraphSourceContextSchema
>;
export type StudyGraphBranchSuggestion = z.infer<
  typeof studyGraphBranchSuggestionSchema
>;
export type ApplyStudyGuideCleanup = z.infer<
  typeof applyStudyGuideCleanupSchema
>;
export type RetainStudyGuideSourceNotes = z.infer<
  typeof retainStudyGuideSourceNotesSchema
>;
export type StudyGuideCleanupApplyResponse = z.infer<
  typeof studyGuideCleanupApplyResponseSchema
>;
export type StudyGuideSourceNoteRetentionResponse = z.infer<
  typeof studyGuideSourceNoteRetentionResponseSchema
>;
export type AbandonStudyOpenSessions = z.infer<
  typeof abandonStudyOpenSessionsSchema
>;
export type AbandonStudyOpenSessionsResponse = z.infer<
  typeof abandonStudyOpenSessionsResponseSchema
>;
export type StudySettingsResponse = z.infer<typeof studySettingsResponseSchema>;
export type StudyCustomGptVerificationResponse = z.infer<
  typeof studyCustomGptVerificationResponseSchema
>;
export type UpdateStudyQuestionGrounding = z.infer<
  typeof updateStudyQuestionGroundingSchema
>;
export type StudyQuestionGroundingResponse = z.infer<
  typeof studyQuestionGroundingResponseSchema
>;
export type UpdateStudySourceContextNotes = z.infer<
  typeof updateStudySourceContextNotesSchema
>;
export type UpdateStudySourceContextNotesResponse = z.infer<
  typeof updateStudySourceContextNotesResponseSchema
>;
export type StudyQuestionGroundingPreviewResponse = z.infer<
  typeof studyQuestionGroundingPreviewResponseSchema
>;
export type StudySourceContextPreviewResponse = z.infer<
  typeof studySourceContextPreviewResponseSchema
>;
export type AddStudyCustomGptSitemapSource = z.infer<
  typeof addStudyCustomGptSitemapSourceSchema
>;
export type AddStudyCustomGptAssetSource = z.infer<
  typeof addStudyCustomGptAssetSourceSchema
>;
export type StudyCustomGptSourceSummary = z.infer<
  typeof studyCustomGptSourceSummarySchema
>;
export type StudyCustomGptSourcesResponse = z.infer<
  typeof studyCustomGptSourcesResponseSchema
>;
export type CreateStudyBranchRule = z.infer<typeof createStudyBranchRuleSchema>;
export type CreateStudyBranchRules = z.infer<
  typeof createStudyBranchRulesSchema
>;
export type StudyBranchRuleMutationResponse = z.infer<
  typeof studyBranchRuleMutationResponseSchema
>;
export type StudyBranchRuleBatchMutationResponse = z.infer<
  typeof studyBranchRuleBatchMutationResponseSchema
>;
export type StudyRecommendedBranchRouteDryRun = z.infer<
  typeof studyRecommendedBranchRouteDryRunSchema
>;
export type StudyRecommendedBranchRulesApplyResponse = z.infer<
  typeof studyRecommendedBranchRulesApplyResponseSchema
>;
export type SimulateStudyBranchRoute = z.infer<
  typeof simulateStudyBranchRouteSchema
>;
export type StudyBranchRouteSimulationResponse = z.infer<
  typeof studyBranchRouteSimulationResponseSchema
>;
export type CreateStudyAsset = z.infer<typeof createStudyAssetSchema>;
export type StudyAssetMutationResponse = z.infer<
  typeof studyAssetMutationResponseSchema
>;
export type UpdateStudyAssetDisplayMode = z.infer<
  typeof updateStudyAssetDisplayModeSchema
>;
export type StudyAssetDisplayModeResponse = z.infer<
  typeof studyAssetDisplayModeResponseSchema
>;
export type StudyLaunchCheckItem = z.infer<typeof studyLaunchCheckItemSchema>;
export type StudyLaunchRecommendedAction = z.infer<
  typeof studyLaunchRecommendedActionSchema
>;
export type StudyLaunchCheckResponse = z.infer<
  typeof studyLaunchCheckResponseSchema
>;
export type StudyLaunchSmokeTestResponse = z.infer<
  typeof studyLaunchSmokeTestResponseSchema
>;
export type UpdateStudySettings = z.infer<typeof updateStudySettingsSchema>;
export type SurveyImportQuestion = z.infer<typeof surveyImportQuestionSchema>;
export type SurveyImportModule = z.infer<typeof surveyImportModuleSchema>;
export type SurveyImportAsset = z.infer<typeof surveyImportAssetSchema>;
export type SurveyImportPreview = z.infer<typeof surveyImportPreviewSchema>;
export type PreviewSurveyImportRequest = z.infer<
  typeof previewSurveyImportRequestSchema
>;
export type PublishSurveyImportRequest = z.infer<
  typeof publishSurveyImportRequestSchema
>;
export type PublishSurveyImportResponse = z.infer<
  typeof publishSurveyImportResponseSchema
>;
export type StartTestSessionRequest = z.infer<
  typeof startTestSessionRequestSchema
>;
export type TranscriptTurnGrounding = z.infer<
  typeof transcriptTurnGroundingSchema
>;
export type RespondentSessionResponse = z.infer<
  typeof respondentSessionResponseSchema
>;
export type SubmitRespondentAnswer = z.infer<
  typeof submitRespondentAnswerSchema
>;
export type SubmitAssetReaction = z.infer<typeof submitAssetReactionSchema>;
export type AssetReactionResponse = z.infer<typeof assetReactionResponseSchema>;
export type SubmitRespondentRealtimeAnswer = z.infer<
  typeof submitRespondentRealtimeAnswerSchema
>;
export type SubmitRespondentAnswerResponse = z.infer<
  typeof submitRespondentAnswerResponseSchema
>;
export type VoiceAnswerVoice = z.infer<typeof voiceAnswerVoiceSchema>;
export type SubmitRespondentVoiceAnswer = z.infer<
  typeof submitRespondentVoiceAnswerSchema
>;
export type SubmitRespondentVoiceAnswerResponse = z.infer<
  typeof submitRespondentVoiceAnswerResponseSchema
>;
export type RealtimeVoiceSessionResponse = z.infer<
  typeof realtimeVoiceSessionResponseSchema
>;
export type SessionAuditResponse = z.infer<typeof sessionAuditResponseSchema>;
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;
export type MvpCustomGptSurveyStartRequest = z.input<
  typeof mvpCustomGptSurveyStartRequestSchema
>;
export type MvpCustomGptSurveyTurnRequest = z.infer<
  typeof mvpCustomGptSurveyTurnRequestSchema
>;
export type MvpCustomGptSurveyVoiceTurnRequest = z.infer<
  typeof mvpCustomGptSurveyVoiceTurnRequestSchema
>;
export type MvpCustomGptSurveyVoiceTranscribeRequest = z.infer<
  typeof mvpCustomGptSurveyVoiceTranscribeRequestSchema
>;
export type MvpCustomGptSurveyMessage = z.infer<
  typeof mvpCustomGptSurveyMessageSchema
>;
export type MvpCustomGptSurveyResponse = z.infer<
  typeof mvpCustomGptSurveyResponseSchema
>;
export type MvpSurveyAuditListResponse = z.infer<
  typeof mvpSurveyAuditListResponseSchema
>;
export type MvpSurveyAuditDetailResponse = z.infer<
  typeof mvpSurveyAuditDetailResponseSchema
>;
export type MvpCustomGptSurveyVoiceTurnResponse = z.infer<
  typeof mvpCustomGptSurveyVoiceTurnResponseSchema
>;
export type MvpCustomGptSurveyVoiceTranscribeResponse = z.infer<
  typeof mvpCustomGptSurveyVoiceTranscribeResponseSchema
>;
export type MvpCustomGptSurveySpeechRequest = z.infer<
  typeof mvpCustomGptSurveySpeechRequestSchema
>;
export type MvpCustomGptSurveySpeechResponse = z.infer<
  typeof mvpCustomGptSurveySpeechResponseSchema
>;
export type MvpCustomGptSourcePreviewRequest = z.infer<
  typeof mvpCustomGptSourcePreviewRequestSchema
>;
export type MvpCustomGptSourcePreviewImage = z.infer<
  typeof mvpCustomGptSourcePreviewImageSchema
>;
export type MvpCustomGptSourcePreviewDocument = z.infer<
  typeof mvpCustomGptSourcePreviewDocumentSchema
>;
export type MvpCustomGptSourcePreviewResponse = z.infer<
  typeof mvpCustomGptSourcePreviewResponseSchema
>;
export type SourceDocumentType = z.infer<typeof sourceDocumentTypeSchema>;
export type SourceDocumentStatus = z.infer<typeof sourceDocumentStatusSchema>;
export type SourceAssetKind = z.infer<typeof sourceAssetKindSchema>;
export type SourceLibraryAssetInput = z.infer<
  typeof sourceLibraryAssetInputSchema
>;
export type CreateSourceLibraryDocument = z.infer<
  typeof createSourceLibraryDocumentSchema
>;
export type SourceLibraryDocument = z.infer<typeof sourceLibraryDocumentSchema>;
export type SourceLibraryListResponse = z.infer<
  typeof sourceLibraryListResponseSchema
>;
export type SourceLibraryMutationResponse = z.infer<
  typeof sourceLibraryMutationResponseSchema
>;
export type SourceLibraryBulkImport = z.infer<
  typeof sourceLibraryBulkImportSchema
>;
export type SourceLibraryBulkImportResponse = z.infer<
  typeof sourceLibraryBulkImportResponseSchema
>;
