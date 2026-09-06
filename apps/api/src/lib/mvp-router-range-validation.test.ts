import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { classifyMvpTurnRouteHybrid, sanitizeMvpRouteFailure } from "./mvp-openai-turn-router";
import { ParticipantEvidenceRangeError } from "../../../../packages/engine/src/evidence-ranges";
import { env } from "../env";

const originalProvider = env.MVP_TURN_ROUTER_PROVIDER;
afterEach(() => { env.MVP_TURN_ROUTER_PROVIDER = originalProvider; });
describe("semantic validation after indexed quote reconstruction", () => {
  it("retains only the allowlisted range diagnostic through serialization", () => {
    const safe = sanitizeMvpRouteFailure(new ParticipantEvidenceRangeError());
    expect(safe.code).toBe("invalid_evidence_range");
    expect(sanitizeMvpRouteFailure(safe)).toEqual(safe);
    expect(safe).not.toHaveProperty("message");
  });
  it("does not let a valid token span turn a pure information request into research answer credit", async () => {
    env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid";
    const range = { startToken: 0, endToken: 3 };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { schemaVersion: 6, sourceRequest: { kind: "explanation_request", participantEvidenceRange: range, resolvedQuestion: "Explain DDI." }, understandingUpdate: null, answerStatus: "answered", answerEvidenceRanges: [range], asksSourceQuestion: true, kind: "source_question", topic: null, needsSource: true, isOutOfScope: false, isUnanticipated: false, suggestedQuestionIds: [], sourceDirective: null, rationale: "Mistaken research credit for an exact question span." } });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const routed = await classifyMvpTurnRouteHybrid({ surveySlug: "nubeqa", sourceBrand: "NUBEQA", currentQuestionId: "factors", currentQuestion: "What factors matter most?", participantContent: "Can you explain DDI", sourceConversationActive: true, candidateQuestions: [{ id: "fit", question: "What about patient fit?", objective: "Patient fit", module: "Research", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }] });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(routed).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: true, failureDiagnosis: { code: "invalid_question_credit" } });
  });
});
