import { describe, expect, it, vi } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  moderatorStateSchema,
  moderatorPlanModelResultSchema,
  moderatorPhrasingResultSchema,
  moderatorEvidenceSelectionResultSchema,
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
const modelPlan = {
  ...modelPlanBase,
  priorityMentions: initialPriorities.map((priority) => ({
    ...priority,
    kind: "initial_priority" as const,
    existingPriorityId: null,
    additionEvidence: null,
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

describe("moderator planning contract", () => {
  it("preserves all separately extracted participant priorities", () => {
    expect(validateModeratorPlan(input, plan).newPriorities).toHaveLength(2);
    expect(normalizeModeratorPlanModelResult(input, modelPlan).newPriorities).toEqual(plan.newPriorities);
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
    }).action).toBe("answer_source");
    expect(() => validateModeratorPlan(mixed, {
      ...plan, newPriorities: [], reactionStatus: "answered", reactionEvidence: ["I would use it"], action: "resume_guide",
    })).toThrow("source-answer action");
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
});

describe("moderator evidence ID validation", () => {
  const evidenceInput: ModeratorEvidenceSelectionInput = {
    surveySlug: "nubeqa", query: "What interaction guidance is available?", candidates: [
      { id: "ddi", title: "Interactions", url: "https://example.com/ddi", description: "", text: "Interaction information", tags: [], assets: [] },
      { id: "pfs", title: "PFS", url: "https://example.com/pfs", description: "", text: "PFS information", tags: [], assets: [{ id: "chart", title: "PFS chart", url: "https://example.com/chart", description: "", assetKind: "CHART", tags: [] }] },
    ],
  };

  it("accepts relevant text without an unrelated visual and an unsupported empty selection", () => {
    expect(validateModeratorEvidenceSelection(evidenceInput, { selections: [{ sourceId: "ddi", supportExcerpt: "Interaction information", assetIds: [] }], rationale: "The interaction page addresses the query." }).selections).toHaveLength(1);
    expect(validateModeratorEvidenceSelection(evidenceInput, { selections: [], rationale: "The requested specific drug is not covered." }).selections).toEqual([]);
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
  it("uses separate strict schemas, models, and trace metadata for planning and wording", async () => {
    const parse = vi.fn()
      .mockResolvedValueOnce({ output_parsed: modelPlan, model: "decision-model", status: "completed" })
      .mockResolvedValueOnce({ output_parsed: { text: "How does the PFS information affect your assessment, if at all?" }, model: "phrase-model", status: "completed" });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "analysis-model", decisionModel: "decision-model", phrasingModel: "phrase-model" }, undefined, { parse });
    const planned = await gateway.planModeratorTurn(input);
    const phrased = await gateway.phraseModeratorTurn({ brand: "NUBEQA", action: "reaction", priorityLabel: "PFS", participantMessage: "PFS and DDI", previousPriorityLabel: null });
    expect(planned.trace.callType).toBe("moderator_plan");
    expect(phrased.trace.callType).toBe("moderator_phrasing");
    expect(parse.mock.calls[0][0]).toMatchObject({ model: "decision-model", text: { format: { type: "json_schema", name: "moderator_plan_result_v2", strict: true } } });
    expect(parse.mock.calls[1][0]).toMatchObject({ model: "phrase-model", text: { format: { name: "moderator_phrasing_result_v1", strict: true } } });
  });

  it("rejects a refusal or missing parsed output rather than advancing", async () => {
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse: vi.fn().mockResolvedValue({ status: "completed" }) });
    await expect(gateway.planModeratorTurn(input)).rejects.toThrow("no parsed output");
  });

  it.each([
    ["moderator_plan_v2", moderatorPlanModelResultSchema],
    ["moderator_phrasing", moderatorPhrasingResultSchema],
    ["moderator_evidence", moderatorEvidenceSelectionResultSchema],
  ] as const)("serializes %s through the installed OpenAI strict-schema helper", (name, schema) => {
    const format = zodTextFormat(schema, name);
    const json = JSON.parse(JSON.stringify(format));
    expect(json).toMatchObject({ type: "json_schema", name, strict: true, schema: { type: "object", additionalProperties: false } });
    expect([...json.schema.required].sort()).toEqual(Object.keys(json.schema.properties).sort());
  });
});
