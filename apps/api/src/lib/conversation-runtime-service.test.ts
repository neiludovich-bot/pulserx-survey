import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyConversationState } from "@interview/engine";
import { runConversationRuntime } from "./conversation-runtime-service";
const mocks = vi.hoisted(() => ({ turn: vi.fn(), retrieve: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ conversationTurn: mocks.turn }) }));
vi.mock("./controlled-rag-service", () => ({ retrieveWebsiteCandidates: mocks.retrieve }));
const observation = { answerStatus: "not_answered", answerEvidence: [], request: { text: "What is the result?", evidence: "What is the result?" }, priorities: [], familiarity: null, familiarityEvidence: null, outOfScope: false };
const guide = { id: "fit", canonicalQuestion: "Which patients fit?", module: "fit", objective: "fit", sourceContextRequirement: null, routeKeywords: [], completionSignals: [], adaptiveProbes: [], analyzableOutputs: [] };
beforeEach(() => { vi.resetAllMocks(); });
describe("new shared dispatch", () => {
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
