import { describe, expect, it } from "vitest";
import { sourceGroundingReviewInputSchema, sourceAnswerScopeSchema } from "./index";

describe("source answer scope contract", () => {
  const legacy = { draft: { practicalAnswer: "A supported fact. [1]", qualification: null }, sources: [{ index: 1, text: "A supported fact." }] };
  const scope = { version: 1, currentParticipantRequest: "PFS and DDI", resolvedSourceQuestion: "Explain PFS", sourceTopicContext: null, sourceQuestionPlan: null, presentationPlan: null };
  it("preserves old reviewers without scope and accepts bounded explicit intent separately from sources", () => {
    expect(sourceGroundingReviewInputSchema.parse(legacy)).toEqual(legacy);
    expect(sourceGroundingReviewInputSchema.parse({ ...legacy, answerScope: scope })).toEqual({ ...legacy, answerScope: scope });
  });
  it("rejects untyped scope fields and oversized request text", () => {
    expect(sourceAnswerScopeSchema.safeParse({ ...scope, sources: ["invented context fact"] }).success).toBe(false);
    expect(sourceAnswerScopeSchema.safeParse({ ...scope, currentParticipantRequest: "x".repeat(12001) }).success).toBe(false);
    expect(sourceAnswerScopeSchema.safeParse({ ...scope, sourceQuestionPlan: "broaden" }).success).toBe(false);
  });
});
