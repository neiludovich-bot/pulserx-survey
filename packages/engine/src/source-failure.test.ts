import { describe, expect, it, vi } from "vitest";
import { sanitizeSourceFailure } from "./source-failure";
import { OpenAIResponsesGateway } from "./openai-workflows";

describe("sanitized source failure metadata", () => {
  it.each(["rate_limit_exceeded", "insufficient_quota", "billing_hard_limit_reached"])("preserves the whitelisted provider category %s without provider content", (code) => {
    const failure = sanitizeSourceFailure({ name: "RateLimitError", status: 429, code, message: "PRIVATE MESSAGE", body: "PRIVATE BODY", request: "PRIVATE KEY" }, "grounding");
    expect(failure).toMatchObject({ stage: "grounding", code: "rate_limited", errorName: "RateLimitError", status: 429, providerCode: code, issues: [] });
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
  });

  it("retains only whitelisted schema issue codes and field paths, never dynamic keys or values", () => {
    const failure = sanitizeSourceFailure({ name: "ZodError", message: "PRIVATE", issues: Array.from({ length: 12 }, () => ({ code: "invalid_type", path: ["unsupportedClaims", 42, "PRIVATE PROPERTY", "reason"], received: "PRIVATE VALUE", message: "PRIVATE MESSAGE" })) }, "grounding");
    expect(failure.code).toBe("invalid_schema");
    expect(failure.issues).toHaveLength(8);
    expect(failure.issues[0]).toEqual({ code: "invalid_type", path: ["unsupportedClaims", "[]", "[unknown]", "reason"] });
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
    expect(sanitizeSourceFailure({ name: "PRIVATE NAME", code: "PRIVATE CODE", issues: [{ code: "PRIVATE CODE", path: ["PRIVATE PATH"] }] }, "composition")).toMatchObject({ errorName: "Error", providerCode: null, issues: [{ code: "invalid_schema", path: ["[unknown]"] }] });
  });

  it("retains reviewer and subsequent composer provider failures before error messages are flattened", async () => {
    const rateLimit = () => Object.assign(new Error("PRIVATE API BODY"), { name: "RateLimitError", status: 429, code: "rate_limit_exceeded", body: "PRIVATE REQUEST" });
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { practicalAnswer: "Selected safety context. [1]", qualification: null, usedSourceIndexes: [1] } })
      .mockRejectedValueOnce(rateLimit()).mockRejectedValueOnce(rateLimit());
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const error = await gateway.composeControlledRagAnswer({ surveySlug: "nubeqa", participantMessage: "What does that mean?", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      sources: [{ index: 1, title: "Source", url: null, description: null, text: "Selected safety context.", evidenceRole: "contextual" }] } as Parameters<typeof gateway.composeControlledRagAnswer>[0]).catch((value) => value);
    expect(error.contextualCompositionAttempts).toHaveLength(2);
    const safe = error.contextualCompositionAttempts.map(({ error: code, failure }: { error: string; failure: unknown }) => ({ code, failure }));
    expect(safe).toMatchObject([{ code: "rate_limited", failure: { stage: "grounding", status: 429, providerCode: "rate_limit_exceeded" } }, { code: "rate_limited", failure: { stage: "composition", status: 429, providerCode: "rate_limit_exceeded" } }]);
    expect(JSON.stringify(safe)).not.toContain("PRIVATE");
  });
});
