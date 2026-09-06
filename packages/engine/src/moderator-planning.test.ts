import { describe, expect, it, vi } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  moderatorStateSchema,
  moderatorPlanModelResultSchema,
  moderatorPlanTokenModelResultSchema,
  moderatorPhrasingResultSchema,
  moderatorEvidenceSelectionResultSchema,
  moderatorEvidenceSelectionModelResultSchema,
  moderatorContextualEvidenceSelectionModelResultSchema,
  moderatorEvidenceSelectionInputSchema,
  moderatorEvidencePacketSchema,
  type ModeratorEvidencePacket,
  type ModeratorPlanInput,
  type ModeratorPlanResult,
  type ModeratorEvidenceSelectionInput,
} from "../../schemas/src/moderator";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { normalizeModeratorPlanModelResult, validateModeratorPlan, validateModeratorEvidenceSelection, validateModeratorPhrasing } from "./moderator-planning";
import { OpenAIResponsesGateway } from "./openai-workflows";

const input: ModeratorPlanInput = {
  brand: "NUBEQA",
  currentQuestion: "What factors matter most?",
  participantMessage: "PFS and DDI",
  recentTurns: [],
  state: { version: 1, priorities: [], activePriorityId: null },
  isPriorityQuestion: true,
  asksSourceQuestion: false,
  answerStatus: "answered",
  isResumeCue: false,
};
const plan: ModeratorPlanResult = {
  sourceRequest: null,
  newPriorities: [
    { label: "PFS", participantEvidence: "PFS", sourceQuestion: "What PFS results are reported for NUBEQA?" },
    { label: "Drug interactions", participantEvidence: "DDI", sourceQuestion: "What drug interactions are reported for NUBEQA?" },
  ],
  reactionStatus: "not_answered",
  reactionEvidence: [],
  action: "present_priority",
  selectedPriorityId: null,
  rationale: "Retain both stated priorities, then present the first.",
};
const { newPriorities: initialPriorities, ...modelPlanBase } = plan;
const request = (participantEvidence: string) => ({ kind: "question" as const, participantEvidence, resolvedQuestion: participantEvidence });
const modelPlan = {
  ...modelPlanBase,
  priorityMentions: initialPriorities.map((priority) => ({
    ...priority,
    kind: "initial_priority" as const,
    existingPriorityId: null,
    additionEvidence: null,
  })),
};
const { reactionEvidence: _legacyReactionEvidence, ...indexedPlanBase } = modelPlanBase;
const indexedModelPlan = {
  ...indexedPlanBase, schemaVersion: 4, reactionEvidenceRanges: [],
  priorityMentions: modelPlan.priorityMentions.map(({ participantEvidence: _evidence, additionEvidence: _addition, ...mention }, index) => ({
    ...mention, participantEvidenceRange: { startToken: index * 2, endToken: index * 2 }, additionEvidenceRange: null,
  })),
};
const presentedInput: ModeratorPlanInput = {
  ...input,
  currentQuestion: "How does this information affect your view?",
  participantMessage: "I would use it",
  isPriorityQuestion: false,
  state: {
    version: 1,
    activePriorityId: "pfs",
    priorities: [{
      id: "pfs", label: "PFS", participantEvidence: "PFS", status: "presented", probeCount: 0,
      sourceQuestion: "What PFS results are reported?", reactionEvidence: [], referenceIds: ["source-1"],
    }],
  },
};

const evidencePacket: ModeratorEvidencePacket = {
  sources: [{
    id: "source-1", surveySlug: "nubeqa", title: "Selected evidence", url: "https://example.com/source",
    description: "Exact evidence retained for clarification", text: "The previously selected source excerpt.", tags: ["selected"],
    assets: [{ title: "Selected visual", url: "https://example.com/visual", description: null, assetKind: "TABLE", tags: ["selected"], priority: 1 }],
  }],
};

describe("moderator evidence packet persistence contract", () => {
  it("retains an exact typed packet while accepting older priority state without one", () => {
    const state = structuredClone(presentedInput.state);
    expect(moderatorStateSchema.parse(state).priorities[0].evidencePacket).toBeUndefined();
    state.priorities[0].evidencePacket = evidencePacket;
    expect(moderatorStateSchema.parse(state).priorities[0].evidencePacket).toEqual(evidencePacket);
    expect(moderatorEvidencePacketSchema.parse({ sources: [{ ...evidencePacket.sources[0], url: "", assets: [] }] }).sources[0].url).toBe("");
  });

  it("rejects unknown fields, duplicate sources, mixed brands, and oversized retained evidence", () => {
    const source = evidencePacket.sources[0];
    for (const invalid of [
      { ...evidencePacket, untypedFacts: ["invented"] },
      { sources: [{ ...source, untypedFacts: ["invented"] }] },
      { sources: [source, source] },
      { sources: [source, { ...source, id: "other", surveySlug: "padcev" }] },
      { sources: [{ ...source, text: "x".repeat(12001) }] },
      { sources: [{ ...source, assets: Array.from({ length: 7 }, () => source.assets[0]) }] },
      { sources: [{ ...source, assets: [{ ...source.assets[0], unsupportedFact: "invented" }] }] },
      { sources: Array.from({ length: 4 }, (_, index) => ({ ...source, id: String(index) })) },
    ]) expect(moderatorEvidencePacketSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("moderator planning contract", () => {
  it("uses the moderator's paired request and reaction when upstream quoted the whole mixed turn", () => {
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const message = `${reaction} ${question}`;
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: message, answerStatus: "not_answered", asksSourceQuestion: true, sourceRequest: request(message) }, {
      ...modelPlanBase, sourceRequest: request(question), priorityMentions: [], action: "answer_source", reactionStatus: "answered", reactionEvidence: [reaction],
    });
    expect(normalized).toMatchObject({ sourceRequest: request(question), reactionStatus: "answered", reactionEvidence: [reaction] });
  });

  it.each([null, request("An invented participant question")])("retains upstream request provenance when the moderator request is absent or invalid", (modelRequest) => {
    const question = "Can you explain that more simply?";
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: question, answerStatus: "not_answered", asksSourceQuestion: true, sourceRequest: request(question) }, {
      ...modelPlanBase, sourceRequest: modelRequest, priorityMentions: [], action: "answer_source", reactionStatus: "answered", reactionEvidence: [question],
    });
    expect(normalized).toMatchObject({ sourceRequest: request(question), action: "answer_source", reactionStatus: "not_answered", reactionEvidence: [] });
  });

  it("retains an independently stated reaction when the upstream guide interpretation says not answered", () => {
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: `${reaction} ${question}`, answerStatus: "not_answered", asksSourceQuestion: true, sourceRequest: request(question) }, {
      ...modelPlanBase, sourceRequest: request(question), priorityMentions: [], action: "answer_source", reactionStatus: "answered", reactionEvidence: [reaction],
    });
    expect(normalized).toMatchObject({ action: "answer_source", reactionStatus: "answered", reactionEvidence: [reaction] });
  });

  it.each(["Can you explain that more simply?", "explain that more simply"])("does not credit request text as a reaction even when both interpreters claim answered (%s)", (excerpt) => {
    const question = "Can you explain that more simply?";
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: question, answerStatus: "answered", asksSourceQuestion: true, sourceRequest: request(question) }, {
      ...modelPlanBase, sourceRequest: request(question), priorityMentions: [], action: "answer_source", reactionStatus: "answered", reactionEvidence: [excerpt],
    });
    expect(normalized).toMatchObject({ action: "answer_source", reactionStatus: "not_answered", reactionEvidence: [] });
  });

  it.each(["NUBEQA", "BRUKINSA", "PADCEV"])("does not turn a %s declarative reaction into a source detour without request evidence", (brand) => {
    const participantMessage = "The efficacy results would be one part of my assessment; I would also weigh interaction concerns.";
    const state = structuredClone(presentedInput.state);
    state.priorities.push({ ...state.priorities[0], id: "ddi", label: "DDI", status: "pending", participantEvidence: "DDI" });
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, brand, participantMessage, sourceRequest: null, state }, {
      ...modelPlanBase, priorityMentions: [], action: "answer_source", selectedPriorityId: "pfs",
      sourceRequest: null, reactionStatus: "answered", reactionEvidence: [participantMessage],
    });
    expect(normalized).toMatchObject({ sourceRequest: null, action: "present_priority", selectedPriorityId: "ddi", reactionStatus: "answered", reactionEvidence: [participantMessage] });
  });

  it("rejects invented request excerpts while retaining strict nullable model provenance", () => {
    expect(moderatorPlanModelResultSchema.safeParse({ ...modelPlan, sourceRequest: undefined }).success).toBe(false);
    expect(() => normalizeModeratorPlanModelResult(presentedInput, { ...modelPlan, sourceRequest: request("Tell me about interactions") })).toThrow("exact excerpt");
    // Old persisted application plans remain valid without the newly required model field.
    expect(validateModeratorPlan(input, { ...plan, sourceRequest: undefined }).sourceRequest).toBeUndefined();
  });

  it("preserves all separately extracted participant priorities", () => {
    expect(validateModeratorPlan(input, plan).newPriorities).toHaveLength(2);
    expect(normalizeModeratorPlanModelResult(input, modelPlan).newPriorities).toEqual(plan.newPriorities);
  });

  it("retains initial priorities and their source queries when the model mistakenly credits a reaction", () => {
    const normalized = normalizeModeratorPlanModelResult(input, {
      ...modelPlan,
      reactionStatus: "answered",
      reactionEvidence: ["PFS and DDI"],
    });
    expect(normalized.newPriorities).toEqual(plan.newPriorities);
    expect(normalized.newPriorities.map((priority) => priority.sourceQuestion)).toEqual([
      "What PFS results are reported for NUBEQA?",
      "What drug interactions are reported for NUBEQA?",
    ]);
    expect(normalized).toMatchObject({ reactionStatus: "not_answered", reactionEvidence: [], action: "present_priority" });
  });

  it("forces navigation to have no reaction credit or new priorities despite model mistakes", () => {
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: "continue", isResumeCue: true, asksSourceQuestion: true }, {
      ...modelPlanBase, action: "answer_source", reactionStatus: "answered", reactionEvidence: ["continue"],
      priorityMentions: [{ ...modelPlan.priorityMentions[0], participantEvidence: "continue" }],
    });
    expect(normalized).toMatchObject({ newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], action: "probe_reaction", selectedPriorityId: "pfs" });
  });

  it.each([true, false])("does not reopen a rephrased DDI priority after a substantive PADCEV reaction (matched=%s)", (matched) => {
    const reaction = "I would review concomitant medicines before choosing it, so that interaction profile would affect my decision.";
    const ddiInput = structuredClone(presentedInput);
    ddiInput.brand = "PADCEV";
    ddiInput.participantMessage = reaction;
    ddiInput.state.priorities[0].label = "DDI";
    const normalized = normalizeModeratorPlanModelResult(ddiInput, {
      ...modelPlanBase,
      reactionStatus: "answered",
      reactionEvidence: [reaction],
      priorityMentions: [{
        label: "concomitant medicines and interactions",
        participantEvidence: reaction,
        sourceQuestion: "What interaction information is available for PADCEV?",
        kind: matched ? "reaction_detail" : "additional_priority",
        existingPriorityId: matched ? "pfs" : null,
        additionEvidence: matched ? null : reaction,
      }],
    });
    expect(normalized.newPriorities).toEqual([]);
    expect(normalized.reactionStatus).toBe("answered");
    expect(normalized.reactionEvidence).toEqual([reaction]);
    expect(normalized.action).toBe("resume_guide");
  });

  it("retains a genuinely additional distinct priority alongside the reaction", () => {
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: "I would use it. Cost also matters to me." }, {
      ...modelPlanBase,
      reactionStatus: "answered", reactionEvidence: ["I would use it"],
      priorityMentions: [{ label: "Cost", participantEvidence: "Cost", sourceQuestion: "What cost information is available?", kind: "additional_priority", existingPriorityId: null, additionEvidence: "Cost also matters to me" }],
    });
    expect(normalized.newPriorities.map((priority) => priority.label)).toEqual(["Cost"]);
    expect(normalized.action).toBe("present_priority");
    expect(normalized.reactionStatus).toBe("answered");
  });

  it("maps synonymous existing-priority mentions to their ID instead of adding them again", () => {
    const normalized = normalizeModeratorPlanModelResult({ ...presentedInput, participantMessage: "I also prioritize time without progression." }, {
      ...modelPlanBase, reactionStatus: "answered", reactionEvidence: ["I also prioritize time without progression"],
      priorityMentions: [{ label: "Time without progression", participantEvidence: "time without progression", sourceQuestion: "What progression evidence is available?", kind: "existing_priority", existingPriorityId: "pfs", additionEvidence: null }],
    });
    expect(normalized.newPriorities).toEqual([]);
    expect(normalized.action).toBe("resume_guide");
  });

  it("rejects fabricated evidence even when the output is structurally valid", () => {
    expect(() => validateModeratorPlan(input, {
      ...plan,
      newPriorities: [{ ...plan.newPriorities[0], participantEvidence: "overall survival" }],
    })).toThrow("exact excerpts");
  });

  it("credits a concise substantive reaction and leaves phrasing to a separate call", () => {
    expect(validateModeratorPlan(presentedInput, {
      ...plan, newPriorities: [], reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "resume_guide",
    }).reactionStatus).toBe("answered");
  });

  it("rejects another reaction probe after a substantive answer", () => {
    expect(() => validateModeratorPlan(presentedInput, {
      ...plan, newPriorities: [], reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "probe_reaction", selectedPriorityId: "pfs",
    })).toThrow("reaction probe");
  });

  it("preserves reaction credit independently from a source detour", () => {
    const mixed = { ...presentedInput, participantMessage: "I would use it. What about interactions?", asksSourceQuestion: true };
    expect(validateModeratorPlan(mixed, {
      ...plan, newPriorities: [], reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "answer_source", selectedPriorityId: "pfs",
      sourceRequest: request("What about interactions?"),
    }).action).toBe("answer_source");
    expect(() => validateModeratorPlan(mixed, {
      ...plan, newPriorities: [], reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "resume_guide",
    })).toThrow("source-answer action");
  });

  it.each([
    { asksSourceQuestion: true, modelAction: "probe_reaction" as const },
    { asksSourceQuestion: false, modelAction: "answer_source" as const },
  ])("preserves the exact mixed reaction plus trailing source question without a question mark: $modelAction", ({ asksSourceQuestion, modelAction }) => {
    const reaction = "It's something that I need to track but not terribly concerning.";
    const participantMessage = `${reaction}  So someone on those medications are at risk for what adverse reactions`;
    const mixedInput = structuredClone(presentedInput);
    mixedInput.participantMessage = participantMessage;
    mixedInput.asksSourceQuestion = asksSourceQuestion;
    mixedInput.answerStatus = "answered";
    mixedInput.state.priorities[0].label = "DDI";
    mixedInput.state.priorities[0].sourceQuestion = "What drug-drug interactions are described for NUBEQA?";
    mixedInput.recentTurns = [{ role: "interviewer", content: "The cited interaction information was presented. How does the DDI information affect your assessment?" }];
    const normalized = normalizeModeratorPlanModelResult(mixedInput, {
      ...modelPlanBase, priorityMentions: [], action: modelAction, selectedPriorityId: mixedInput.state.activePriorityId,
      sourceRequest: request("So someone on those medications are at risk for what adverse reactions"),
      reactionStatus: "answered", reactionEvidence: [reaction],
    });
    expect(normalized).toMatchObject({
      newPriorities: [], action: "answer_source", selectedPriorityId: mixedInput.state.activePriorityId,
      reactionStatus: "answered", reactionEvidence: [reaction],
    });
    expect(normalized.reactionEvidence.join(" ")).not.toContain("adverse reactions");
  });

  it("allows the planner to recognize a clarification missed by the upstream router", () => {
    const clarification = { ...presentedInput, participantMessage: "Can you explain that more simply?", asksSourceQuestion: false, answerStatus: "not_answered" as const };
    const result = normalizeModeratorPlanModelResult(clarification, {
      ...modelPlanBase, priorityMentions: [], action: "answer_source", selectedPriorityId: "pfs",
      sourceRequest: request(clarification.participantMessage),
    });
    expect(result.action).toBe("answer_source");
    expect(result.reactionStatus).toBe("not_answered");
    expect(result.reactionEvidence).toEqual([]);
  });

  it.each([true, false])("cannot complete an active reaction from a source-only clarification (router source=%s)", (asksSourceQuestion) => {
    const participantMessage = "Can you explain that more simply?";
    const normalized = normalizeModeratorPlanModelResult({
      ...presentedInput, participantMessage, asksSourceQuestion, answerStatus: "not_answered",
    }, {
      ...modelPlanBase, priorityMentions: [], action: "answer_source", selectedPriorityId: "pfs",
      sourceRequest: request(participantMessage),
      reactionStatus: "answered", reactionEvidence: [participantMessage],
    });
    expect(normalized).toMatchObject({ action: "answer_source", selectedPriorityId: "pfs", reactionStatus: "not_answered", reactionEvidence: [] });
  });

  it.each(["partial", "answered"] as const)("preserves %s reaction credit in a mixed answer and source question", (answerStatus) => {
    const reaction = "That would affect my treatment choice";
    const normalized = normalizeModeratorPlanModelResult({
      ...presentedInput, participantMessage: `${reaction}. Can you explain the interaction detail?`, asksSourceQuestion: true, answerStatus,
    }, {
      ...modelPlanBase, priorityMentions: [], action: "answer_source", selectedPriorityId: "pfs",
      sourceRequest: request("Can you explain the interaction detail?"),
      reactionStatus: answerStatus, reactionEvidence: [reaction],
    });
    expect(normalized).toMatchObject({ action: "answer_source", reactionStatus: answerStatus, reactionEvidence: [reaction] });
  });

  it.each(["pfs", "invented", null])("keeps a validated reaction when resume_guide has stale selected ID %s", (selectedPriorityId) => {
    const normalized = normalizeModeratorPlanModelResult(presentedInput, {
      ...modelPlanBase, priorityMentions: [], action: "resume_guide", selectedPriorityId,
      reactionStatus: "answered", reactionEvidence: ["I would use it"],
    });
    expect(normalized).toMatchObject({ reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "resume_guide", selectedPriorityId: null });
  });

  it("advances to a valid pending priority despite a malformed selection after a reaction", () => {
    const pendingInput = structuredClone(presentedInput);
    pendingInput.state.priorities.push({ ...pendingInput.state.priorities[0], id: "ddi", label: "DDI", status: "pending" });
    const normalized = normalizeModeratorPlanModelResult(pendingInput, {
      ...modelPlanBase, priorityMentions: [], action: "probe_reaction", selectedPriorityId: "invented",
      reactionStatus: "answered", reactionEvidence: ["I would use it"],
    });
    expect(normalized).toMatchObject({ reactionStatus: "answered", action: "present_priority", selectedPriorityId: "ddi" });
  });

  it("discards invalid mention metadata independently from valid reaction evidence", () => {
    const normalized = normalizeModeratorPlanModelResult(presentedInput, {
      ...modelPlanBase, reactionStatus: "answered", reactionEvidence: ["I would use it"],
      priorityMentions: [
        { ...modelPlan.priorityMentions[0], participantEvidence: "I would use it", kind: "reaction_detail", existingPriorityId: "invented" },
        { ...modelPlan.priorityMentions[0], participantEvidence: "not in the message" },
      ],
    });
    expect(normalized).toMatchObject({ newPriorities: [], reactionStatus: "answered", action: "resume_guide" });
    expect(() => normalizeModeratorPlanModelResult(presentedInput, {
      ...modelPlanBase, priorityMentions: [], reactionStatus: "answered", reactionEvidence: ["Invented participant reaction"],
    })).toThrow("exact excerpts");
  });

  it("does not credit a navigation cue as a reaction", () => {
    expect(() => validateModeratorPlan({ ...presentedInput, participantMessage: "continue", isResumeCue: true }, {
      ...plan, newPriorities: [], action: "resume_guide", reactionStatus: "answered", reactionEvidence: ["continue"],
    })).toThrow("navigation cue");
  });

  it("allows navigation after a detour to resume an unanswered reaction without another probe", () => {
    const resumed = structuredClone(presentedInput);
    resumed.participantMessage = "continue";
    resumed.isResumeCue = true;
    resumed.state.priorities[0].probeCount = 2;
    expect(validateModeratorPlan(resumed, {
      ...plan, newPriorities: [], action: "probe_reaction", selectedPriorityId: "pfs",
    }).action).toBe("probe_reaction");
  });

  it("cannot invent selected priority IDs or re-present completed priorities", () => {
    expect(() => validateModeratorPlan(input, { ...plan, selectedPriorityId: "invented" })).toThrow("unknown priority");
    const reacted = structuredClone(presentedInput);
    reacted.state.priorities[0].status = "reacted";
    expect(() => validateModeratorPlan(reacted, { ...plan, newPriorities: [], selectedPriorityId: "pfs" })).toThrow("pending");
  });

  it("limits partial-reaction followups to the application probe budget", () => {
    const partial = structuredClone(presentedInput);
    partial.participantMessage = "CYP3A4 inducers";
    const probe = { ...plan, newPriorities: [], reactionStatus: "partial", reactionEvidence: ["CYP3A4 inducers"], action: "probe_reaction", selectedPriorityId: "pfs" };
    expect(validateModeratorPlan(partial, probe).action).toBe("probe_reaction");
    partial.state.priorities[0].probeCount = 2;
    expect(() => validateModeratorPlan(partial, probe)).toThrow("probe budget");
  });

  it("validates persistent priority IDs and defaults prior state probe counts", () => {
    const state = structuredClone(presentedInput.state);
    const { probeCount: _, ...legacyPriority } = state.priorities[0];
    expect(moderatorStateSchema.parse({ ...state, priorities: [legacyPriority] }).priorities[0].probeCount).toBe(0);
    expect(moderatorStateSchema.safeParse({ ...state, activePriorityId: "missing" }).success).toBe(false);
    expect(moderatorStateSchema.safeParse({ ...state, priorities: [...state.priorities, ...state.priorities] }).success).toBe(false);
  });

  it("requires one neutral reaction question or a question-free transition", () => {
    const phraseInput = { brand: "NUBEQA", action: "reaction" as const, priorityLabel: "DDI", participantMessage: "DDI", previousPriorityLabel: "PFS" };
    expect(validateModeratorPhrasing(phraseInput, { text: "How does the DDI information fit into your assessment?" }).text).toContain("?");
    expect(() => validateModeratorPhrasing(phraseInput, { text: "What do you think? Would you use it?" })).toThrow("exactly one");
    expect(validateModeratorPhrasing({ ...phraseInput, action: "transition" }, { text: "Let's look at the interaction information you mentioned." }).text).not.toContain("?");
    expect(() => validateModeratorPhrasing(phraseInput, { text: "What comes to mind about this?" })).toThrow("explicitly name");
    expect(validateModeratorPhrasing({ ...phraseInput, priorityLabel: "Drug interactions" }, { text: "How does the drug interaction information fit into your assessment?" }).text).toContain("drug interaction");
  });

  it.each([
    "How does the DDI information affect your assessment?\n\nNext let's look at DDI.",
    "How does the DDI information affect your assessment? Next let's look at DDI.",
    "On DDI:\nHow does this information affect your assessment?",
  ])("rejects extra transition text or paragraphs in reaction wording: %s", (text) => {
    expect(() => validateModeratorPhrasing({ brand: "NUBEQA", action: "reaction", priorityLabel: "DDI", participantMessage: "DDI", previousPriorityLabel: null }, { text })).toThrow("single question paragraph");
  });
});

describe("moderator evidence ID validation", () => {
  const evidenceInput: ModeratorEvidenceSelectionInput = {
    surveySlug: "nubeqa", query: "What interaction guidance is available?", candidates: [
      { id: "ddi", title: "Interactions", url: "https://example.com/ddi", description: "", text: "Interaction information", tags: [], assets: [] },
      { id: "pfs", title: "PFS", url: "https://example.com/pfs", description: "", text: "PFS information", tags: [], assets: [{ id: "chart", title: "PFS chart", url: "https://example.com/chart", description: "", assetKind: "CHART", tags: [] }] },
    ],
  };

  it("keeps dependent-source context typed and backward compatible without replacing the query", async () => {
    expect(moderatorEvidenceSelectionInputSchema.parse(evidenceInput)).toMatchObject({ sourceTopicContext: null, priorSourceIds: [] });
    const contextualInput = { ...evidenceInput, query: "Someone on those medications is at risk for what adverse reactions", sourceTopicContext: "The preceding discussion concerned drug interactions.", priorSourceIds: ["ddi"] };
    expect(moderatorEvidenceSelectionInputSchema.safeParse({ ...contextualInput, sourceTopicContext: { loose: "context" } }).success).toBe(false);
    const parse = vi.fn().mockResolvedValue({ output_parsed: { selections: [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] }], rationale: "Retain the referenced interaction context without inferring general adverse-event causality." } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    await gateway.selectModeratorEvidence(contextualInput);
    const requestInput = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    expect(requestInput).toMatchObject({ query: contextualInput.query, sourceTopicContext: contextualInput.sourceTopicContext, priorSourceIds: ["ddi"] });
  });

  it("accepts relevant text without an unrelated visual and an unsupported empty selection", () => {
    expect(validateModeratorEvidenceSelection(evidenceInput, { selections: [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] }], rationale: "The interaction page addresses the query." }).selections).toHaveLength(1);
    expect(validateModeratorEvidenceSelection(evidenceInput, { selections: [], rationale: "The requested specific drug is not covered." }).selections).toEqual([]);
  });

  it("defaults legacy evidence to direct and preserves contextual roles only for valid excerpts", () => {
    const selection = { sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] };
    expect(moderatorEvidenceSelectionResultSchema.parse({ selections: [selection], rationale: "legacy" }).selections[0].evidenceRole).toBe("direct");
    expect(() => validateModeratorEvidenceSelection({ ...evidenceInput, evidenceFocus: "contextual" }, { selections: [selection], rationale: "direct is insufficient" })).toThrow("cannot select direct");
    const contextualInput = { ...evidenceInput, evidenceFocus: "contextual" as const, candidates: [{ ...evidenceInput.candidates[0], text: "A named warning with supporting details." }] };
    const result = validateModeratorEvidenceSelection(contextualInput, { selections: [{ ...selection, supportExcerpt: "A named warning with supporting details.", evidenceRole: "contextual" }], rationale: "Distinct safety detail" });
    expect(result.selections[0].evidenceRole).toBe("contextual");
    expect(() => validateModeratorEvidenceSelection(contextualInput, { selections: [{ ...selection, supportExcerpt: "Invented warning", evidenceRole: "contextual" }], rationale: "invalid" })).toThrow("exact supporting excerpt");
  });

  it("requires model evidence roles without serializing a default into strict output", async () => {
    const output = { selections: [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [], evidenceRole: "direct" }], rationale: "Direct support" };
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    expect((await gateway.selectModeratorEvidence(evidenceInput)).result).toEqual(output);
    const format = parse.mock.calls[0][0].text.format;
    expect(format.name).toBe("moderator_evidence_selection_result_v3");
    const selectionSchema = format.schema.properties.selections.items;
    expect(selectionSchema.required).toContain("evidenceRole");
    expect(selectionSchema.properties.evidenceRole).not.toHaveProperty("default");
    expect(moderatorEvidenceSelectionModelResultSchema.safeParse({ ...output, selections: [{ ...output.selections[0], evidenceRole: undefined }] }).success).toBe(false);
    const packet = { sources: [{ ...evidencePacket.sources[0], evidenceRole: "contextual" }] };
    expect(moderatorEvidencePacketSchema.parse(packet).sources[0].evidenceRole).toBe("contextual");
  });

  it("constrains contextual generation to the contextual role without relabeling direct output", async () => {
    const output = { selections: [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [], evidenceRole: "contextual" }], rationale: "Selected supporting excerpt" };
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    await gateway.selectModeratorEvidence({ ...evidenceInput, evidenceFocus: "contextual" });
    const format = parse.mock.calls[0][0].text.format;
    expect(format.name).toBe("moderator_contextual_evidence_selection_result_v1");
    expect(format.schema.properties.selections.items.properties.evidenceRole.enum).toEqual(["contextual"]);
    expect(moderatorContextualEvidenceSelectionModelResultSchema.parse({ selections: [], rationale: "No relevant contextual facts" }).selections).toEqual([]);
    expect(moderatorContextualEvidenceSelectionModelResultSchema.safeParse({ ...output, selections: [{ ...output.selections[0], evidenceRole: "direct" }] }).success).toBe(false);
    parse.mockResolvedValue({ output_parsed: { ...output, selections: [{ ...output.selections[0], evidenceRole: "direct" }] } });
    await expect(gateway.selectModeratorEvidence({ ...evidenceInput, evidenceFocus: "contextual" })).rejects.toThrow("cannot select direct");
  });

  it("rejects unknown sources, repeated sources, and assets attached to a different source", () => {
    for (const selections of [
      [{ sourceId: "missing", supportExcerpt: "Interaction information", assetIds: [] }],
      [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] }, { sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] }],
      [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: ["chart"] }],
      [{ sourceId: "ddi", supportExcerpt: "Invented interaction fact", assetIds: [] }],
    ]) {
      expect(() => validateModeratorEvidenceSelection(evidenceInput, { selections, rationale: "test" })).toThrow();
    }
  });
});

describe("moderator structured gateway", () => {
  it("omits retained evidence from model planning context without mutating canonical state", async () => {
    const withEvidence = structuredClone(presentedInput);
    withEvidence.state.priorities[0].evidencePacket = evidencePacket;
    withEvidence.state.sourceDiscussion = { query: "What interactions are documented?", evidencePacket };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { ...indexedModelPlan, priorityMentions: [], reactionStatus: "answered", reactionEvidenceRanges: [{ startToken: 0, endToken: 3 }], action: "resume_guide" } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const planned = await gateway.planModeratorTurn(withEvidence);
    const requestInput = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    expect(requestInput.state.priorities[0]).not.toHaveProperty("evidencePacket");
    expect(requestInput.state.sourceDiscussion).toEqual({ query: "What interactions are documented?" });
    expect(withEvidence.state.sourceDiscussion.evidencePacket).toEqual(evidencePacket);
    expect(withEvidence.state.priorities[0].evidencePacket).toEqual(evidencePacket);
    expect(planned.result.reactionStatus).toBe("answered");
  });
  it("uses separate strict schemas, models, and trace metadata for planning and wording", async () => {
    const parse = vi.fn()
      .mockResolvedValueOnce({ output_parsed: indexedModelPlan, model: "decision-model", status: "completed" })
      .mockResolvedValueOnce({ output_parsed: { text: "How does the PFS information affect your assessment, if at all?" }, model: "phrase-model", status: "completed" });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "analysis-model", decisionModel: "decision-model", phrasingModel: "phrase-model" }, undefined, { parse });
    const planned = await gateway.planModeratorTurn(input);
    const phrased = await gateway.phraseModeratorTurn({ brand: "NUBEQA", action: "reaction", priorityLabel: "PFS", participantMessage: "PFS and DDI", previousPriorityLabel: null });
    expect(planned.trace.callType).toBe("moderator_plan");
    expect(phrased.trace.callType).toBe("moderator_phrasing");
    expect(parse.mock.calls[0][0]).toMatchObject({ model: "decision-model", text: { format: { type: "json_schema", name: "moderator_plan_result_v4", strict: true } } });
    expect(parse.mock.calls[1][0]).toMatchObject({ model: "phrase-model", text: { format: { name: "moderator_phrasing_result_v1", strict: true } } });
  });

  it("rejects a refusal or missing parsed output rather than advancing", async () => {
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse: vi.fn().mockResolvedValue({ status: "completed" }) });
    await expect(gateway.planModeratorTurn(input)).rejects.toThrow("no parsed output");
  });

  it("returns a valid model plan even when auxiliary debug-file storage fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("EACCES: permission denied saving debug trace"));
    const parse = vi.fn().mockResolvedValue({ output_parsed: indexedModelPlan, model: "decision-model", status: "completed" });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, { save }, { parse });
    const result = await gateway.planModeratorTurn(input);
    expect(result.result.newPriorities.map((priority) => priority.label)).toEqual(["PFS", "Drug interactions"]);
    expect(result.trace.callType).toBe("moderator_plan");
    expect(result.debugPath).toBeUndefined();
    expect(result.debugError).toContain("EACCES");
  });

  it.each([
    ["moderator_plan_v2", moderatorPlanModelResultSchema],
    ["moderator_plan_v4", moderatorPlanTokenModelResultSchema],
    ["moderator_phrasing", moderatorPhrasingResultSchema],
    ["moderator_evidence", moderatorEvidenceSelectionModelResultSchema],
    ["moderator_contextual_evidence", moderatorContextualEvidenceSelectionModelResultSchema],
  ] as const)("serializes %s through the installed OpenAI strict-schema helper", (name, schema) => {
    const format = zodTextFormat(schema, name);
    const json = JSON.parse(JSON.stringify(format));
    expect(json).toMatchObject({ type: "json_schema", name, strict: true, schema: { type: "object", additionalProperties: false } });
    expect([...json.schema.required].sort()).toEqual(Object.keys(json.schema.properties).sort());
  });
});
