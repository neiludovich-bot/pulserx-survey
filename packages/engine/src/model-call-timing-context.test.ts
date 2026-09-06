import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { getModelCallTimingContext, withModelCallTimingContext } from "./model-call-timing-context";
import { OpenAIResponsesGateway } from "./openai-workflows";

const groupA = "00000000-0000-4000-8000-000000000001";
const groupB = "00000000-0000-4000-8000-000000000002";
const plan = { version: 1, interpretedQuestion: "Synthetic question", usesSourceContext: false, retrievalQueries: ["synthetic query"], answerApproach: "direct", contextBoundary: null, rationale: "Synthetic test" };
const input = { surveySlug: "nubeqa" as const, participantMessage: "PRIVATE message", sourceTopicContext: null, recentTurns: [] };

describe("request-isolated timing context", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps interleaved successes and failures in their own opaque groups", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    let releaseA!: () => void;
    let releaseB!: () => void;
    const waitA = new Promise<void>((resolve) => { releaseA = resolve; });
    const waitB = new Promise<void>((resolve) => { releaseB = resolve; });
    const failure = new Error("PRIVATE provider error");
    const parse = vi.fn().mockImplementation(async () => {
      if (getModelCallTimingContext()?.callGroupId === groupA) { await waitA; return { output_parsed: plan }; }
      await waitB; throw failure;
    });
    const gateway = new OpenAIResponsesGateway("PRIVATE key", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const first = withModelCallTimingContext({ callGroupId: groupA }, () => gateway.planSourceQuestion(input));
    const second = withModelCallTimingContext({ callGroupId: groupB }, () => gateway.planSourceQuestion(input));
    const settled = Promise.allSettled([first, second]);
    releaseB(); await second.catch(() => {}); releaseA();
    const results = await settled;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toEqual({ status: "rejected", reason: failure });
    expect(log.mock.calls.map(([entry]) => { const value = JSON.parse(entry as string); return [value.callGroupId, value.status]; })).toEqual([[groupB, "failure"], [groupA, "success"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
    expect(getModelCallTimingContext()).toBeNull();
    expect(parse.mock.calls.every(([request]) => !JSON.stringify(request).includes(groupA) && !JSON.stringify(request).includes(groupB))).toBe(true);
  });
  it("restores outer context after nested asynchronous work and errors", async () => {
    await withModelCallTimingContext({ callGroupId: groupA }, async () => {
      expect(getModelCallTimingContext()?.callGroupId).toBe(groupA);
      await expect(withModelCallTimingContext({ callGroupId: groupB }, async () => { await Promise.resolve(); throw new Error("test"); })).rejects.toThrow("test");
      expect(getModelCallTimingContext()?.callGroupId).toBe(groupA);
    });
    expect(getModelCallTimingContext()).toBeNull();
  });
  it("does not accept free-text identities as timing groups", () => {
    expect(withModelCallTimingContext({ callGroupId: "PRIVATE participant identity" }, () => getModelCallTimingContext())).toBeNull();
  });
});
