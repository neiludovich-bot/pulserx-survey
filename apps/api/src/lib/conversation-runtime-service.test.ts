import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyConversationState } from "@interview/engine";
import { runConversationRuntime } from "./conversation-runtime-service";
import { researchPlanForGuide } from "./mvp-research-objectives";
const mocks = vi.hoisted(() => ({ turn: vi.fn(), present: vi.fn(), retrieve: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ conversationTurn: mocks.turn, presentConversationEvidence: mocks.present }) }));
vi.mock("./controlled-rag-service", () => ({ retrieveWebsiteCandidates: mocks.retrieve }));
const observation = { answerStatus: "not_answered", answerEvidence: [], request: { text: "What is the result?", evidence: "What is the result?" }, priorities: [], familiarity: null, familiarityEvidence: null, outOfScope: false };
const guide = { id: "fit", canonicalQuestion: "Which patients fit?", module: "fit", objective: "fit", sourceContextRequirement: null, routeKeywords: [], completionSignals: [], adaptiveProbes: [], analyzableOutputs: [] };
beforeEach(() => { vi.resetAllMocks(); });
describe("new shared dispatch", () => {
  it("uses concise objective context instead of inherited presentation instructions", async () => {
    const next = { ...guide, sourceContextRequirement: "Before asking, catalogue every study endpoint." };
    const state = emptyConversationState(); state.research = researchPlanForGuide([next]);
    mocks.retrieve.mockResolvedValue([{ id: "a", surveySlug: "nubeqa", title: "Study", url: "https://example.test/study", description: "", text: "A supported fact.", tags: [], assets: [] }]);
    mocks.present.mockResolvedValue({ traces: [{}], answer: { selections: [{ sourceId: "a", supportExcerpt: "A supported fact.", assetIds: [], evidenceRole: "direct", contribution: "answer" }], paragraphs: [{ text: "A supported fact.", sourceIds: ["a"] }], unavailableReason: null } });
    const result = await runConversationRuntime({ brand: "nubeqa", surveySlug: "nubeqa", state, question: null, history: [], message: "continue", resume: true, stop: false, selectGuide: () => next });
    expect(result.content).toContain("A supported fact.");
    const query = mocks.present.mock.calls[0][0].query;
    expect(query).toContain("60-90 word evidence summary");
    expect(query).not.toContain("Before asking, catalogue");
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("asks for a missing reason once, then moves on with the objective explicitly deferred", async () => {
    const state = emptyConversationState(); state.research = researchPlanForGuide([guide]);
    mocks.retrieve.mockResolvedValue([]);
    mocks.turn.mockResolvedValueOnce({ observation: { ...observation, request: null, answerStatus: "answered", answerEvidence: ["It seems useful"], researchSignals: [{ objectiveId: "fit", criterionId: "perspective", evidence: "It seems useful" }] }, trace: {}, answer: null });
    const input = { brand: "nubeqa", surveySlug: "nubeqa" as const, state, question: guide, history: [], message: "It seems useful", resume: false, stop: false, selectGuide: () => null };
    const first = await runConversationRuntime(input);
    expect(first.action).toBe("objective_follow_up");
    expect(first.content).toBe("What about that leads you to that view?");
    expect(first.state.research?.objectives[0].status).toBe("partial");
    mocks.turn.mockResolvedValueOnce({ observation: { ...observation, request: null, answerStatus: "not_answered", answerEvidence: [], researchSignals: [] }, trace: {}, answer: null });
    const second = await runConversationRuntime({ ...input, state: first.state, question: first.question, message: "I'm not sure" });
    expect(second.completed).toBe(false);
    expect(second.action).toBe("final_questions");
    expect(second.state.research?.objectives[0].status).toBe("deferred");
    expect(mocks.turn).toHaveBeenCalledTimes(2);
  });

  it("preserves volunteered research credit while answering a mixed medical question", async () => {
    const state = emptyConversationState(); state.research = researchPlanForGuide([guide]);
    mocks.retrieve.mockResolvedValue([{ id: "a", surveySlug: "nubeqa", title: "Study", url: "https://example.test/study", description: "", text: "A supported fact.", tags: [], assets: [] }]);
    mocks.turn.mockResolvedValueOnce({ observation: { ...observation, answerStatus: "answered", answerEvidence: ["It fits older patients", "because our clinic can monitor them"], researchSignals: [
      { objectiveId: "fit", criterionId: "perspective", evidence: "It fits older patients" },
      { objectiveId: "fit", criterionId: "reason", evidence: "because our clinic can monitor them" },
    ] }, trace: {}, answer: { selections: [{ sourceId: "a", supportExcerpt: "A supported fact.", assetIds: [], evidenceRole: "direct", contribution: "answer" }], paragraphs: [{ text: "A supported fact.", sourceIds: ["a"] }], unavailableReason: null } });
    const result = await runConversationRuntime({ brand: "nubeqa", surveySlug: "nubeqa", state, question: guide, history: [], message: "It fits older patients because our clinic can monitor them. What is the result?", resume: false, stop: false, selectGuide: () => null });
    expect(result.action).toBe("answer_request");
    expect(result.state.research?.objectives[0].status).toBe("covered");
    expect(mocks.turn).toHaveBeenCalledOnce();
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("presents both %s priorities without treating the selected topic as participant speech", async brand => {
    mocks.retrieve.mockResolvedValue([{ id: "a", surveySlug: brand, title: "Study", url: "https://example.test/study", description: "", text: "A supported result.", tags: [], assets: [] }]);
    mocks.present.mockResolvedValue({ traces: [{ presentation: true }], answer: { selections: [{ sourceId: "a", supportExcerpt: "A supported result.", assetIds: [], evidenceRole: "direct", contribution: "answer" }], paragraphs: [{ text: "A supported result.", sourceIds: ["a"] }], unavailableReason: null } });
    mocks.turn.mockResolvedValueOnce({ observation: { ...observation, request: null, answerStatus: "answered", answerEvidence: ["Efficacy and dosing"], reactionEvidence: [], priorities: [{ label: "Efficacy", query: "Efficacy", evidence: "Efficacy" }, { label: "Dosing", query: "Dosing", evidence: "dosing" }] }, trace: {}, answer: null });
    const input = { brand, surveySlug: brand, question: { ...guide, canonicalQuestion: "What are your top priorities?" }, history: [], message: "Efficacy and dosing", resume: false, stop: false, selectGuide: () => guide };
    const first = await runConversationRuntime(input);
    expect(first.content).toContain("stands out to you about Efficacy");
    expect(mocks.turn).toHaveBeenCalledOnce();
    expect(mocks.present).toHaveBeenLastCalledWith(expect.objectContaining({ query: `${brand}: Efficacy`, sourceTopicContext: null }));
    mocks.turn.mockResolvedValueOnce({ observation: { ...observation, request: null, answerStatus: "answered", answerEvidence: ["Useful"], reactionEvidence: ["Useful"] }, trace: {}, answer: null });
    const second = await runConversationRuntime({ ...input, state: first.state, question: first.question, message: "Useful" });
    expect(second.content).toContain("Turning to Dosing:");
    expect(mocks.turn).toHaveBeenCalledTimes(2);
    expect(mocks.present).toHaveBeenLastCalledWith(expect.objectContaining({ query: `${brand}: Dosing`, sourceTopicContext: null }));
    expect(second.state.topics.map(topic => topic.status)).toEqual(["discussed", "presented"]);
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("answers %s follow-ups in one call and preserves a parked question through resume", async brand => {
    mocks.retrieve.mockResolvedValue([{ id: "a", surveySlug: brand, title: "Study", url: "https://example.test/study", description: "Study", text: "The result was reported.", tags: [], assets: [] }]);
    mocks.turn.mockResolvedValue({ observation, trace: {}, answer: { selections: [{ sourceId: "a", supportExcerpt: "The result was reported.", assetIds: [], evidenceRole: "direct", contribution: "answer" }], paragraphs: [{ text: "The result was reported.", sourceIds: ["a"] }], unavailableReason: null } });
    const first = await runConversationRuntime({ brand, surveySlug: brand, question: guide, history: [], message: "What is the result?", resume: false, stop: false, selectGuide: () => guide });
    expect(mocks.turn).toHaveBeenCalledOnce();
    expect(first.state.parkedGuideId).toBe("fit");
    expect(first.content).toContain("The result was reported. [1]");
    expect(first.references[0].assets.every(asset => asset.assetKind === "LINK")).toBe(true);
    mocks.turn.mockClear(); mocks.retrieve.mockClear();
    const resumed = await runConversationRuntime({ brand, surveySlug: brand, state: structuredClone(first.state), question: first.question, history: [], message: "continue", resume: true, stop: false, selectGuide: () => guide });
    expect(mocks.turn).not.toHaveBeenCalled(); expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(resumed.content).toContain("Which patients fit?");
    expect(resumed.content).not.toContain("The result was reported.");
    expect(resumed.state.discussion).toBeNull();
  });
  it("fails without cascading providers or consuming research state", async () => {
    mocks.retrieve.mockResolvedValue([]); mocks.turn.mockRejectedValue(new Error("invalid evidence"));
    const state = emptyConversationState(); state.parkedGuideId = "fit";
    const result = await runConversationRuntime({ brand: "nubeqa", surveySlug: "nubeqa", state, question: guide, history: [], message: "Question", resume: false, stop: false, selectGuide: () => guide });
    expect(mocks.turn).toHaveBeenCalledOnce(); expect(result.state).toEqual(state); expect(result.observation).toBeNull();
    expect(result.references).toEqual([]); expect(result.action).toBe("unavailable");
  });
});
