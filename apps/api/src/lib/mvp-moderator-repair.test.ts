import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown, source: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
vi.mock("./source-answer-service", () => ({ askSourceProviderForSurveyInterviewerTurn: mocks.source }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { moderatorPlanRepairContextSchema } from "../../../../packages/schemas/src/moderator";
import { runModeratorTurn } from "./mvp-moderator-service";

beforeEach(() => {
  mocks.source.mockReset();
  mocks.source.mockResolvedValue({ enabled: true, answer: "A supported answer.", references: [{ citationId: "source", title: "Source", url: "https://example.test/source", description: null, assets: [] }] });
});

describe("typed moderator repair through the live gateway boundary", () => {
  it.each([true, false])("repairs a paraphrased request with unchanged state and preserves only separate reaction credit (mixed=%s)", async (mixed) => {
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const participantMessage = mixed ? `${reaction} ${question}` : question;
    const candidate = { priorityMentions: [], reactionStatus: "answered", reactionEvidence: [mixed ? reaction : question], sourceRequest: { kind: "question", participantEvidence: "What adverse reactions might those medications cause?", resolvedQuestion: "What adverse reactions are described?" }, action: "answer_source", selectedPriorityId: "ddi", rationale: "Answer the followup separately from the reaction." };
    const corrected = { ...candidate, sourceRequest: { ...candidate.sourceRequest, participantEvidence: question } };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: candidate }).mockResolvedValueOnce({ output_parsed: corrected });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const state = { version: 1 as const, activePriorityId: "ddi", priorities: [{ id: "ddi", label: "DDI", participantEvidence: "DDI", status: "presented" as const, probeCount: 0, sourceQuestion: "What interactions are described?", reactionEvidence: [], referenceIds: ["source"] }], sourceDiscussion: { query: "What drug-drug interactions are noted?", status: "open" as const, returnTarget: { kind: "priority" as const, id: "ddi" }, navigationHintShown: true } };
    const before = structuredClone(state);
    const result = await runModeratorTurn({ brand: "NUBEQA", surveySlug: "nubeqa", state, currentQuestion: "What is your initial reaction to DDI?", participantMessage, recentTurns: [], isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: mixed ? "answered" : "not_answered", isResumeCue: false, surveyContext: "Synthetic regression" });
    expect(parse).toHaveBeenCalledTimes(2);
    const firstInput = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    const secondInput = JSON.parse(parse.mock.calls[1][0].input[0].content[0].text);
    expect(firstInput.repairContext).toBeUndefined();
    const { repairContext, ...originalInput } = secondInput;
    expect(originalInput).toEqual(firstInput);
    expect(repairContext).toEqual({ version: 1, candidate, feedback: "invalid_request_excerpt" });
    expect(parse.mock.calls[1][0].instructions).toContain("exact unchanged contiguous clause copied from the CURRENT participantMessage");
    expect(state).toEqual(before);
    expect(result?.decision).toMatchObject({ plannerAttempts: 2, plannerRecovered: true, action: "answer_source", plannerFailures: [{ code: "invalid_request_excerpt" }] });
    expect(result?.state.priorities[0]).toMatchObject({ status: mixed ? "reacted" : "presented", reactionEvidence: mixed ? [reaction] : [], probeCount: 0 });
    expect(mocks.source).toHaveBeenCalledTimes(1);
  });

  it("rejects untyped repair feedback or an invalid rejected candidate", () => {
    expect(moderatorPlanRepairContextSchema.safeParse({ version: 1, candidate: {}, feedback: "invent a reaction" }).success).toBe(false);
    expect(moderatorPlanRepairContextSchema.safeParse({ version: 1, candidate: {}, feedback: "invalid_request_excerpt", message: "untyped instructions" }).success).toBe(false);
  });
});
