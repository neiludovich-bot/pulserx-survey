import { describe, expect, it } from "vitest";
import { sourceTurnOutcome } from "./source-turn-outcome";

describe("source outcome audit", () => {
  it("retains failures after composition when the reviewer has no trace, then a provider failure without any trace", () => {
    const outcome = sourceTurnOutcome("composition_failure", { contextualCompositionAttempts: [
      { trace: { response: { id: "composition-id", model: "source-model" } }, error: "PRIVATE", failure: { stage: "grounding", errorName: "ZodError", status: null, issues: [{ code: "invalid_type", path: ["supported"], received: "PRIVATE" }] } },
      { error: "PRIVATE", failure: { stage: "composition", errorName: "RateLimitError", status: 429, providerCode: "insufficient_quota" } },
    ] });
    expect(outcome.attempts).toEqual([
      { stage: "composition", code: "composed", responseId: "composition-id", model: "source-model" },
      { stage: "grounding", code: "invalid_schema", responseId: null, model: null },
      { stage: "composition", code: "rate_limited", responseId: null, model: null },
    ]);
    expect(JSON.stringify(outcome)).not.toContain("PRIVATE");
  });
  it("retains review failure stage and IDs without storing rejected drafts", () => {
    const result = sourceTurnOutcome("composition_failure", {
      contextualCompositionAttempts: [{
        trace: { request: { model: "source-model", participantMessage: "private" }, response: { id: "compose-id", output: "rejected medical claim" } },
        groundingTrace: { request: { model: "source-model" }, response: { id: "review-id", output: "private claim" } },
        error: "Contextual composition contains unsupported claims.",
      }],
    });
    expect(result.status).toBe("grounding_rejected");
    expect(result.attempts).toEqual([
      { stage: "composition", code: "composed", responseId: "compose-id", model: "source-model" },
      { stage: "grounding", code: "unsupported_claims", responseId: "review-id", model: "source-model" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|rejected medical/);
  });

  it("separates provider failure from unsupported evidence", () => {
    const result = sourceTurnOutcome("composition_failure", { status: 429, message: "secret request payload" });
    expect(result.status).toBe("composition_failure");
    expect(result.attempts[0].code).toBe("rate_limited");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps successful repair status and both bounded attempts", () => {
    const result = sourceTurnOutcome("success", { contextualCompositionAttempts: [
      { error: "Contextual composition requires individual citations matching its supplied and used source indexes." },
      { trace: { response: { id: "repaired" } }, error: null },
    ] });
    expect(result.status).toBe("success");
    expect(result.attempts.map((attempt) => attempt.code)).toEqual(["citation_mismatch", "supported"]);
  });
});
