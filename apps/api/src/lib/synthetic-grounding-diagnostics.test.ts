import { afterEach, describe, expect, it, vi } from "vitest";
import { logSyntheticGroundingDiagnostics } from "./synthetic-grounding-diagnostics";

const context = "Study: SYNTHETIC QA grounding replay - exclude from research\nBrand: NUBEQA\nObjective: source dialogue";
function attempt(id = "review-id") {
  return { groundingTrace: {
    request: { input: {
      draft: { practicalAnswer: "A claimed monitoring instruction. [1]", qualification: null },
      sources: [{ index: 1, text: "The selected source describes exposure only." }],
    }, participantMessage: "PRIVATE PARTICIPANT", credentials: "PRIVATE KEY" },
    response: { id, raw: {
      output_parsed: { version: 1, supported: false, unsupportedClaims: [{ excerpt: "A claimed monitoring instruction.", reason: "No monitoring instruction appears in the selected source." }] },
      unrelated: "PRIVATE RAW RESPONSE",
    } },
  }, trace: { request: "PRIVATE COMPOSER INPUT" }, error: "PRIVATE ERROR MESSAGE" };
}

describe("synthetic-only grounding diagnostics", () => {
  it("retains all three bounded failure categories without retaining raw errors", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticGroundingDiagnostics(context, { contextualCompositionAttempts: [
      { failure: { stage: "composition", code: "word_budget_exceeded" }, error: "PRIVATE" },
      { failure: { stage: "grounding", code: "unsupported_claims" }, error: "PRIVATE" },
      { failure: { stage: "grounding", code: "unsupported_claims" }, error: "PRIVATE" },
    ] });
    const logged = JSON.parse(log.mock.calls[0][0]);
    expect(logged.attempts.map((item: { code: string }) => item.code)).toEqual(["word_budget_exceeded", "unsupported_claims", "unsupported_claims"]);
    expect(log.mock.calls[0][0]).not.toContain("PRIVATE");
  });
  it("logs safe validation/provider failures without a rejected grounding trace, only for synthetic QA", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = { contextualCompositionAttempts: [
      { error: "PRIVATE RAW MESSAGE", trace: { request: "PRIVATE INPUT", response: { raw: "PRIVATE BODY" } }, failure: { stage: "grounding", errorName: "ZodError", status: null, issues: [{ code: "invalid_type", path: ["unsupportedClaims", 0, "PRIVATE KEY"], received: "PRIVATE VALUE" }] } },
      { error: "PRIVATE RAW MESSAGE", failure: { stage: "composition", errorName: "RateLimitError", status: 429, providerCode: "insufficient_quota", body: "PRIVATE BODY" } },
    ] };
    logSyntheticGroundingDiagnostics("Study: Ordinary study", error);
    expect(log).not.toHaveBeenCalled();
    logSyntheticGroundingDiagnostics(context, error);
    expect(log).toHaveBeenCalledOnce();
    const logged = JSON.parse(log.mock.calls[0][0]);
    expect(logged).toMatchObject({ event: "source_qa_failure_diagnostics", attempts: [
      { stage: "grounding", code: "invalid_schema", errorName: "ZodError", issues: [{ code: "invalid_type", path: ["unsupportedClaims", "[]", "[unknown]"] }] },
      { stage: "composition", code: "rate_limited", status: 429, providerCode: "insufficient_quota" },
    ] });
    expect(log.mock.calls[0][0]).not.toContain("PRIVATE");
    expect(log.mock.calls[0][0]).not.toMatch(/draft|request|body|received/);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["Study: Ordinary study", "Study: Ordinary study\nStudy: SYNTHETIC QA embedded", "Study: SYNTHETIC QA", "Participant said: Study: SYNTHETIC QA fake", "Study: Synthetic QA lowercase"])("does not log detailed diagnostics for an unlabeled study: %s", (surveyContext) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticGroundingDiagnostics(surveyContext, { contextualCompositionAttempts: [attempt()] });
    expect(log).not.toHaveBeenCalled();
  });

  it("logs only validated unsupported excerpts, reasons, selected text, and response ID", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticGroundingDiagnostics(context, { contextualCompositionAttempts: [attempt()] });
    expect(log).toHaveBeenCalledOnce();
    const logged = JSON.parse(log.mock.calls[0][0]);
    expect(logged).toEqual({ event: "source_qa_grounding_diagnostics", attempts: [{
      responseId: "review-id", unsupportedClaims: [{ excerpt: "A claimed monitoring instruction.", reason: "No monitoring instruction appears in the selected source." }],
      sources: [{ index: 1, text: "The selected source describes exposure only." }],
    }] });
    expect(log.mock.calls[0][0]).not.toContain("PRIVATE");
    expect(log.mock.calls[0][0]).not.toContain("draft");
  });

  it("caps attempts and field sizes before logging", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entry = attempt("r".repeat(250));
    entry.groundingTrace.request.input.draft.practicalAnswer = "x".repeat(1800);
    entry.groundingTrace.request.input.sources[0].text = "s".repeat(1800);
    entry.groundingTrace.response.raw.output_parsed.unsupportedClaims = Array.from({ length: 10 }, () => ({ excerpt: "x".repeat(600), reason: "r".repeat(600) }));
    logSyntheticGroundingDiagnostics(context, { contextualCompositionAttempts: [attempt("discarded"), entry, entry] });
    const { attempts } = JSON.parse(log.mock.calls[0][0]);
    expect(attempts).toHaveLength(2);
    for (const diagnostic of attempts) {
      expect(diagnostic.responseId).toHaveLength(200);
      expect(diagnostic.unsupportedClaims).toHaveLength(6);
      expect(diagnostic.unsupportedClaims[0].excerpt).toHaveLength(500);
      expect(diagnostic.unsupportedClaims[0].reason).toHaveLength(400);
      expect(diagnostic.sources[0].text).toHaveLength(1500);
    }
  });

  it("ignores malformed traces and inconsistent excerpts without throwing", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = attempt();
    invalid.groundingTrace.response.raw.output_parsed.unsupportedClaims[0].excerpt = "Not in the reviewed draft";
    const extraInput = attempt();
    Object.assign(extraInput.groundingTrace.request.input, { participantMessage: "PRIVATE" });
    for (const error of [null, "bad", {}, { contextualCompositionAttempts: [null, {}] }, { contextualCompositionAttempts: [invalid, extraInput] }, { get contextualCompositionAttempts() { throw new Error("malformed getter"); } }]) {
      expect(() => logSyntheticGroundingDiagnostics(context, error)).not.toThrow();
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("does not let a diagnostic logger failure affect source recovery", () => {
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("logger unavailable"); });
    expect(() => logSyntheticGroundingDiagnostics(context, { contextualCompositionAttempts: [attempt()] })).not.toThrow();
  });
});
