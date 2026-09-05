import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeSourceFailure } from "./source-failure";
import { OpenAIResponsesGateway } from "./openai-workflows";

describe("sanitized source failure metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["Rate limit reached on tokens per minute (TPM)", "tokens_per_minute"],
    ["Rate limit reached on tokens per day (TPD)", "tokens_per_day"],
    ["Rate limit reached on requests per minute (RPM)", "requests_per_minute"],
    ["Rate limit reached on requests per day (RPD)", "requests_per_day"],
    ["You exceeded your current quota", "quota_or_billing"],
    ["Unrecognized throttle", "unknown"],
  ])("classifies 429 limits without retaining the provider message: %s", (message, limitKind) => {
    const safe = sanitizeSourceFailure({ status: 429, code: null, message: `${message} PRIVATE ACCOUNT SECRET`, headers: { "retry-after": "2.5", authorization: "PRIVATE KEY" } }, "composition");
    expect(safe).toMatchObject({ providerCode: null, limitKind, retryAfter: 2.5 });
    expect(JSON.stringify(safe)).not.toContain("PRIVATE");
    expect(sanitizeSourceFailure(safe, "composition")).toEqual(safe);
  });

  it("accepts only known limit categories and bounded numeric retry delays", () => {
    expect(sanitizeSourceFailure({ status: 429, type: "tokens_per_day", code: null, headers: { get: () => "12" } }, "composition")).toMatchObject({ limitKind: "tokens_per_day", retryAfter: 12 });
    for (const value of ["PRIVATE", "Wed, 21 Oct 2026 07:28:00 GMT", "-3", "999999", Infinity]) {
      expect(sanitizeSourceFailure({ status: 429, limitKind: "PRIVATE", headers: { "retry-after": value } }, "composition")).toMatchObject({ limitKind: "unknown", retryAfter: null });
    }
  });

  it("logs a canonical limit category and retry delay when the provider code is null", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = Object.assign(new Error("Rate limit reached on tokens per minute (TPM): PRIVATE ORG SECRET"), { status: 429, code: null, headers: { "retry-after": "15" } });
    const gateway = new OpenAIResponsesGateway("PRIVATE KEY", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse: vi.fn().mockRejectedValue(error) });
    await expect(gateway.selectModeratorEvidence({ surveySlug: "nubeqa", query: "PRIVATE QUESTION", candidates: [], sourceTopicContext: null, priorSourceIds: [], evidenceFocus: "all" })).rejects.toBe(error);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "model_provider_failure", callType: "moderator_evidence", status: 429, providerCode: null, limitKind: "tokens_per_minute", retryAfter: 15 });
    expect(log.mock.calls[0][0]).not.toContain("PRIVATE");
  });

  it.each([{ status: 400, code: "PRIVATE CODE", providerCode: null }, { status: 429, code: "insufficient_quota", providerCode: "insufficient_quota" }])("logs only safe provider metadata before evidence-selection traces exist ($status)", async ({ status, code, providerCode }) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = Object.assign(new Error("PRIVATE MESSAGE"), { status, code, body: "PRIVATE BODY", request: "PRIVATE API KEY" });
    const gateway = new OpenAIResponsesGateway("PRIVATE KEY", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse: vi.fn().mockRejectedValue(error) });
    await expect(gateway.selectModeratorEvidence({ surveySlug: "nubeqa", query: "PRIVATE QUESTION", candidates: [], sourceTopicContext: null, priorSourceIds: [], evidenceFocus: "all" })).rejects.toBe(error);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "model_provider_failure", callType: "moderator_evidence", status, providerCode, ...(status === 429 ? { limitKind: "quota_or_billing" } : {}) });
    expect(log.mock.calls[0][0]).not.toContain("PRIVATE");
  });

  it("does not log missing structured output as a provider failure and preserves thrown errors if logging fails", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parse = vi.fn().mockResolvedValue({});
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const input = { surveySlug: "nubeqa" as const, query: "PRIVATE", candidates: [], sourceTopicContext: null, priorSourceIds: [], evidenceFocus: "all" as const };
    await expect(gateway.selectModeratorEvidence(input)).rejects.toThrow("returned no parsed output");
    expect(log).not.toHaveBeenCalled();
    const error = Object.assign(new Error("PRIVATE"), { status: 429, code: "rate_limit_exceeded" });
    parse.mockRejectedValueOnce(error);
    log.mockImplementation(() => { throw new Error("logger failure"); });
    await expect(gateway.selectModeratorEvidence(input)).rejects.toBe(error);
  });
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
