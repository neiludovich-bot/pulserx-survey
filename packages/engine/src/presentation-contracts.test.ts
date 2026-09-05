import { describe, expect, it, vi } from "vitest";
import {
  moderatorStateSchema, moderatorPhrasingInputSchema, participantUnderstandingSchema,
  participantUnderstandingUpdateSchema, presentationPlanSchema, sourceTurnOutcomeSchema,
  mvpTurnRouteAnalysisResultSchema, type MvpTurnRouteAnalysisInput, type PresentationPlan,
} from "@interview/schemas";
import { OpenAIResponsesGateway } from "./openai-workflows";

const understanding = { version: 1 as const, productFamiliarity: "low" as const, preferredDepth: "brief" as const, participantEvidence: ["Not very familiar with it."] };
const brief: PresentationPlan = { version: 1, purpose: "orientation", depth: "brief", maxFacts: 3, maxTopics: 1, askReadiness: true };
const routeInput: MvpTurnRouteAnalysisInput = {
  surveySlug: "nubeqa", sourceBrand: "NUBEQA", activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
  currentQuestionId: "familiarity", currentQuestion: "How familiar are you with it?", currentQuestionObjective: "Capture product familiarity.",
  currentQuestionKeywords: [], currentQuestionCompletionSignals: [], sourceConversationActive: false,
  participantMessage: "Not very familiar with it.", recentInterviewerContext: null,
  candidateQuestions: [{ id: "factors", question: "What factors matter most?", objective: "Capture priorities.", module: "Baseline", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }],
};
const routeResult = {
  schemaVersion: 4, answerStatus: "answered", asksSourceQuestion: false, answerEvidence: [routeInput.participantMessage],
  kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false,
  suggestedQuestionIds: ["factors"], sourceDirective: null, rationale: "The participant states low product familiarity.",
  understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: [routeInput.participantMessage] },
};
function gateway(parse: ReturnType<typeof vi.fn>) {
  return new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
}

describe("presentation and understanding contracts", () => {
  it("retains understanding and failed source-return state while accepting older ledgers", () => {
    const old = { version: 1, priorities: [], activePriorityId: null };
    expect(moderatorStateSchema.parse(old)).toEqual(old);
    const current = { ...old, understanding, sourceDiscussion: {
      query: "The previous interaction topic", pendingQuestion: "What specifically should be monitored?",
      status: "failed", returnTarget: { kind: "guide", id: "factors" }, navigationHintShown: true,
      failure: { stage: "grounding", message: "The answer could not be verified." },
    } };
    expect(moderatorStateSchema.parse(current)).toEqual(current);
    expect(participantUnderstandingSchema.parse({ ...understanding, preferredDepth: "detailed", depthPreferenceExplicit: true }).depthPreferenceExplicit).toBe(true);
    expect(() => participantUnderstandingSchema.parse({ ...understanding, clinicianExpertise: "low" })).toThrow();
  });

  it("bounds brief delivery and requires evidence for understanding changes", () => {
    expect(presentationPlanSchema.parse(brief)).toEqual(brief);
    expect(() => presentationPlanSchema.parse({ ...brief, maxTopics: 2 })).toThrow();
    expect(() => presentationPlanSchema.parse({ ...brief, maxFacts: 4 })).toThrow();
    expect(() => participantUnderstandingUpdateSchema.parse({ version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: [] })).toThrow();
    expect(() => participantUnderstandingUpdateSchema.parse({ version: 1, productFamiliarity: null, preferredDepth: null, participantEvidence: ["continue"] })).toThrow();
    expect(participantUnderstandingUpdateSchema.parse({ version: 1, productFamiliarity: null, preferredDepth: "detailed", participantEvidence: ["Show me the detailed trial data."] }).productFamiliarity).toBeNull();
  });

  it("captures exact familiarity evidence through a versioned route call without making it a source request", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: routeResult });
    const result = await gateway(parse).analyzeMvpTurnRoute(routeInput);
    expect(result.result.understandingUpdate).toEqual(routeResult.understandingUpdate);
    expect(result.result.asksSourceQuestion).toBe(false);
    expect(parse.mock.calls[0][0].text.format.name).toBe("mvp_turn_route_analysis_result_v4");
    expect(parse.mock.calls[0][0].text.format.schema.required).toContain("understandingUpdate");
    expect([...parse.mock.calls[0][0].text.format.schema.required].sort()).toEqual(Object.keys(parse.mock.calls[0][0].text.format.schema.properties).sort());
    expect(mvpTurnRouteAnalysisResultSchema.parse({ ...routeResult, schemaVersion: 3, understandingUpdate: undefined }).schemaVersion).toBe(3);
  });

  it("rejects an understanding update borrowing evidence not in the current participant turn", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { ...routeResult, understandingUpdate: { ...routeResult.understandingUpdate, participantEvidence: ["I have never prescribed it."] } } });
    await expect(gateway(parse).analyzeMvpTurnRoute(routeInput)).rejects.toThrow("exact current participant excerpts");
  });

  it("passes presentation constraints to composition without allowing it to select a research question", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { answerBody: "The selected source describes the product's role. [1]", usedSourceIndexes: [1] } });
    await gateway(parse).composeControlledRagAnswer({
      surveySlug: "nubeqa", participantMessage: "Give me a brief introduction.", presentationPlan: brief,
      resolvedSourceQuestion: "Basic product role", surveyContext: "", currentQuestion: null, selectedNextQuestion: null,
      selectedQuestionSourceContext: null, recentInterviewerContext: null, responseMode: "answer_only", clinicalEvidenceCard: null,
      sources: [{ index: 1, title: "Synthetic source", url: "https://example.test/source", description: null, tags: [], text: "The selected source describes the product's role." }],
    });
    const request = parse.mock.calls[0][0];
    expect(JSON.parse(request.input[0].content[0].text).presentationPlan).toEqual(brief);
    expect(request.instructions).toContain("one concept in two or three supported facts");
    expect(request.instructions).toContain("do not append your own readiness or research question");
  });

  it("phrases a specific information need with recent context and keeps legacy phrasing inputs valid", async () => {
    const base = { brand: "NUBEQA", action: "reaction" as const, priorityLabel: "PFS", participantMessage: "I don't know enough to judge.", previousPriorityLabel: null };
    expect(moderatorPhrasingInputSchema.parse(base)).toEqual(base);
    const rich = { ...base, understanding, presentationPlan: brief, selectedObjective: "Identify the information still needed before a reaction.", evidenceSummary: "One source-backed concept was introduced.", reactionEvidence: [base.participantMessage], recentQuestionTexts: ["How does the PFS evidence affect your assessment?"], probeIntent: "information_need" as const };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { text: "What would you need to understand about the PFS evidence first?" } });
    await gateway(parse).phraseModeratorTurn(rich);
    expect(JSON.parse(parse.mock.calls[0][0].input[0].content[0].text)).toEqual(rich);
  });

  it("keeps source outcomes typed and bounded without raw medical or participant content fields", () => {
    expect(sourceTurnOutcomeSchema.parse({ version: 1, status: "success" })).toEqual({ version: 1, status: "success", attempts: [] });
    const attempt = { stage: "grounding", code: "unsupported_claim", responseId: null, model: "test" };
    expect(sourceTurnOutcomeSchema.parse({ version: 1, status: "grounding_rejected", attempts: [attempt] }).attempts).toEqual([attempt]);
    expect(() => sourceTurnOutcomeSchema.parse({ version: 1, status: "grounding_rejected", attempts: Array(5).fill(attempt) })).toThrow();
    expect(() => sourceTurnOutcomeSchema.parse({ version: 1, status: "composition_failure", participantMessage: "raw transcript", attempts: [] })).toThrow();
  });
});
