import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { moderatorPlanTokenModelResultSchema, type ModeratorPlanInput } from "@interview/schemas";
import { normalizeModeratorPlanTokenResult } from "./moderator-evidence-ranges";
import { participantTokensForModel, tokenizeParticipantMessage } from "./evidence-ranges";
import { OpenAIResponsesGateway } from "./openai-workflows";

function range(message: string, excerpt: string) {
  const start = message.indexOf(excerpt);
  const tokens = tokenizeParticipantMessage(message);
  return { startToken: tokens.find((token) => token.start === start)!.index, endToken: tokens.find((token) => token.end === start + excerpt.length)!.index };
}
const base: ModeratorPlanInput = {
  brand: "NUBEQA", currentQuestion: "Your first impression?", participantMessage: "", recentTurns: [], isPriorityQuestion: false,
  asksSourceQuestion: false, sourceRequest: null, answerStatus: "not_answered", isResumeCue: false,
  state: { version: 1, activePriorityId: "ddi", priorities: [{ id: "ddi", label: "DDI", participantEvidence: "DDI", sourceQuestion: "What interactions are described?", status: "presented", reactionEvidence: [], referenceIds: ["source"], probeCount: 0 }] },
};
const wireBase = { schemaVersion: 5, reactionTargetPriorityId: "ddi", sourceRequest: null, reactionStatus: "not_answered", reactionEvidenceRanges: [], priorityMentions: [], action: "answer_source", selectedPriorityId: "ddi", rationale: "Handle the participant's request and preserve separate reaction evidence." };

describe("moderator indexed participant evidence", () => {
  it.each(["pfs", "ddi"])("attributes a mixed DDI detour reaction independently of the parked %s priority", (activePriorityId) => {
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const message = `${reaction} ${question}`;
    const state = { ...base.state, activePriorityId, priorities: [
      { ...base.state.priorities[0], id: "pfs", label: "PFS", participantEvidence: "PFS", sourceQuestion: "What PFS results are reported?", status: activePriorityId === "pfs" ? "presented" as const : "reacted" as const },
      { ...base.state.priorities[0], status: activePriorityId === "ddi" ? "presented" as const : "pending" as const },
    ], sourceDiscussion: { query: "What drug interactions are described?", returnTarget: { kind: "priority" as const, id: activePriorityId } } };
    const result = normalizeModeratorPlanTokenResult({ ...base, state, participantMessage: message }, {
      ...wireBase, reactionTargetPriorityId: "ddi", reactionStatus: "answered", reactionEvidenceRanges: [range(message, reaction)],
      sourceRequest: { kind: "question", participantEvidenceRange: range(message, question), resolvedQuestion: question },
    });
    expect(result).toMatchObject({ action: "answer_source", sourceRequest: { participantEvidence: question },
      reactionStatus: activePriorityId === "ddi" ? "answered" : "not_answered",
      reactionTargetPriorityId: activePriorityId === "ddi" ? "ddi" : null,
      reactionEvidence: activePriorityId === "ddi" ? [reaction] : [] });
  });

  it("requires target attribution on new wire output while unknown or null targets cannot earn reaction credit", () => {
    const message = "That would affect my decision.";
    const candidate = { ...wireBase, sourceRequest: null, reactionStatus: "answered", reactionEvidenceRanges: [range(message, message)] };
    expect(moderatorPlanTokenModelResultSchema.safeParse({ ...candidate, reactionTargetPriorityId: undefined }).success).toBe(false);
    for (const reactionTargetPriorityId of [null, "unknown"]) {
      expect(normalizeModeratorPlanTokenResult({ ...base, participantMessage: message }, { ...candidate, reactionTargetPriorityId }))
        .toMatchObject({ reactionStatus: "not_answered", reactionEvidence: [], reactionTargetPriorityId: null, action: "probe_reaction" });
    }
  });

  it.each(["NUBEQA", "BRUKINSA", "PADCEV"])("reconstructs the exact mixed %s reaction and request, preserving typography and spacing", (brand) => {
    const reaction = "It's something that I need to track but not terribly concerning.";
    const request = "So someone on those medications are at risk for what adverse reactions";
    const message = `${reaction}  ${request}`;
    const result = normalizeModeratorPlanTokenResult({ ...base, brand, participantMessage: message }, {
      ...wireBase, reactionStatus: "answered", reactionEvidenceRanges: [range(message, reaction)],
      sourceRequest: { kind: "question", participantEvidenceRange: range(message, request), resolvedQuestion: "What adverse reactions are described for the medicines being discussed?" },
    });
    expect(result.reactionStatus).toBe("answered");
    expect(result.reactionEvidence).toEqual([reaction]);
    expect(result.sourceRequest?.participantEvidence).toBe(request);
    expect(result.action).toBe("answer_source");
    expect(result.newPriorities).toEqual([]);
    expect(result).not.toHaveProperty("schemaVersion");
  });

  it("does not credit a pure question even if a model assigns the same token range as reaction evidence", () => {
    const message = "Can you explain that more simply?";
    const evidenceRange = range(message, message);
    const result = normalizeModeratorPlanTokenResult({ ...base, participantMessage: message, answerStatus: "answered" }, {
      ...wireBase, reactionStatus: "answered", reactionEvidenceRanges: [evidenceRange],
      sourceRequest: { kind: "clarification_request", participantEvidenceRange: evidenceRange, resolvedQuestion: "Explain the latest interaction information more simply." },
    });
    expect(result.reactionStatus).toBe("not_answered");
    expect(result.reactionEvidence).toEqual([]);
    expect(result.sourceRequest?.participantEvidence).toBe(message);
  });

  it("reconstructs all initial priorities and explicit addition evidence without generated quotes", () => {
    const input = { ...base, participantMessage: "PFS  and\tDDI", isPriorityQuestion: true, state: { version: 1 as const, priorities: [], activePriorityId: null } };
    const result = normalizeModeratorPlanTokenResult(input, { ...wireBase, action: "present_priority", selectedPriorityId: null, priorityMentions: ["PFS", "DDI"].map((label) => ({ label, participantEvidenceRange: range(input.participantMessage, label), additionEvidenceRange: null, sourceQuestion: `What information is described about ${label}?`, existingPriorityId: null, kind: "initial_priority" })) });
    expect(result.newPriorities.map((priority) => priority.participantEvidence)).toEqual(["PFS", "DDI"]);
    const additionalInput = { ...base, participantMessage: "Cost also matters to me." };
    const addition = normalizeModeratorPlanTokenResult(additionalInput, { ...wireBase, action: "probe_reaction", priorityMentions: [{ label: "Cost", participantEvidenceRange: { startToken: 0, endToken: 0 }, additionEvidenceRange: range(additionalInput.participantMessage, additionalInput.participantMessage), sourceQuestion: "What cost information is described?", existingPriorityId: null, kind: "additional_priority" }] });
    expect(addition.newPriorities[0].participantEvidence).toBe("Cost");
  });

  it.each([{ startToken: 0, endToken: 99 }, { startToken: 4, endToken: 1 }])("rejects invalid request range %j and exposes the actual indexed candidate for repair", (participantEvidenceRange) => {
    const input = { ...base, participantMessage: "Can you explain that more simply?" };
    const candidate = { ...wireBase, sourceRequest: { kind: "clarification_request", participantEvidenceRange, resolvedQuestion: "Explain the latest information." } };
    try { normalizeModeratorPlanTokenResult(input, candidate); throw new Error("Expected invalid range failure"); }
    catch (error) {
      expect(error).toMatchObject({ repairContext: { version: 1, feedback: "invalid_evidence_range", candidate } });
      expect(input.state.priorities[0].status).toBe("presented");
    }
  });

  it("sends indexed current-message tokens and preserves indexed repair context through the gateway", async () => {
    const message = "Can you  explain “that” more simply?";
    const input = { ...base, participantMessage: message };
    const bad = { ...wireBase, sourceRequest: { kind: "clarification_request", participantEvidenceRange: { startToken: 0, endToken: 99 }, resolvedQuestion: "Explain the latest information." } };
    const good = { ...bad, sourceRequest: { ...bad.sourceRequest, participantEvidenceRange: range(message, message) } };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: bad }).mockResolvedValueOnce({ output_parsed: good });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const error = await gateway.planModeratorTurn(input).catch((error) => error);
    const result = await gateway.planModeratorTurn({ ...input, repairContext: error.repairContext });
    expect(result.result.sourceRequest?.participantEvidence).toBe(message);
    const request = parse.mock.calls[1][0];
    const planningInput = JSON.parse(request.input[0].content[0].text);
    expect(planningInput.participantTokens).toEqual(participantTokensForModel(message));
    expect(planningInput.repairContext.candidate).toEqual(bad);
    expect(request.text.format.name).toBe("moderator_plan_result_v5");
    expect(request.text.format.schema.properties).toHaveProperty("reactionEvidenceRanges");
    expect(request.text.format.schema.properties).not.toHaveProperty("reactionEvidence");
    expect(moderatorPlanTokenModelResultSchema.safeParse({ ...good, reactionEvidence: [message] }).success).toBe(false);
  });

  it.each(["reaction", "priority", "addition"])("rejects invalid %s evidence before granting any canonical credit", (field) => {
    const input = { ...base, participantMessage: "Cost also matters to me." };
    const invalidRange = { startToken: 0, endToken: 99 };
    const mention = { label: "Cost", participantEvidenceRange: { startToken: 0, endToken: 0 }, additionEvidenceRange: { startToken: 0, endToken: 4 }, sourceQuestion: "What cost information is described?", existingPriorityId: null, kind: "additional_priority" };
    const candidate = { ...wireBase, action: "probe_reaction", reactionEvidenceRanges: field === "reaction" ? [invalidRange] : [], priorityMentions: field === "reaction" ? [] : [{ ...mention, ...(field === "priority" ? { participantEvidenceRange: invalidRange } : { additionEvidenceRange: invalidRange }) }] };
    expect(() => normalizeModeratorPlanTokenResult(input, candidate)).toThrow("valid bounded excerpts");
    expect(input.state.priorities[0].reactionEvidence).toEqual([]);
  });
});
