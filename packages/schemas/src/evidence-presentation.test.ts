import { describe, expect, it } from "vitest";
import { moderatorEvidenceSelectionInputSchema } from "./moderator";

describe("presentation narrowing input", () => {
  const base = { surveySlug: "nubeqa", query: "Even more simply please.", candidates: [] };
  const presentationContext = { version: 1, kind: "simplify_previous_answer", participantRequest: base.query, lastSourceAnswer: "A previous explanation. [1]" };
  it("keeps the new presentation context optional for ordinary evidence selection", () => {
    expect(moderatorEvidenceSelectionInputSchema.parse(base).presentationContext).toBeUndefined();
    expect(moderatorEvidenceSelectionInputSchema.parse({ ...base, presentationContext }).presentationContext).toEqual(presentationContext);
    expect(moderatorEvidenceSelectionInputSchema.parse({ ...base, presentationContext: { ...presentationContext, lastSourceAnswer: null } }).presentationContext?.lastSourceAnswer).toBeNull();
  });
  it("rejects untyped or unbounded presentation context", () => {
    for (const context of ["simplify", { ...presentationContext, kind: "answer_new_question" }, { ...presentationContext, lastSourceAnswer: "x".repeat(12001) }, { ...presentationContext, evidence: "a generated fact" }]) {
      expect(moderatorEvidenceSelectionInputSchema.safeParse({ ...base, presentationContext: context }).success).toBe(false);
    }
  });
});
