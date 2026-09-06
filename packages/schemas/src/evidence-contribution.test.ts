import { describe, expect, it } from "vitest";
import { moderatorEvidenceSelectionResultSchema, moderatorEvidenceSelectionModelResultSchema, moderatorContextualEvidenceSelectionModelResultSchema } from "./moderator";

describe("evidence contribution schema", () => {
  const selection = { sourceId: "source", supportExcerpt: "Exact source text.", assetIds: [], evidenceRole: "direct" };
  const value = { selections: [selection], rationale: "Fixture." };
  it("accepts historical internal selections while requiring explicit contribution on both model outputs", () => {
    expect(moderatorEvidenceSelectionResultSchema.parse(value)).toEqual(value);
    expect(moderatorEvidenceSelectionModelResultSchema.safeParse(value).success).toBe(false);
    expect(moderatorEvidenceSelectionModelResultSchema.safeParse({ ...value, selections: [{ ...selection, contribution: "answer" }] }).success).toBe(true);
    expect(moderatorContextualEvidenceSelectionModelResultSchema.safeParse({ ...value, selections: [{ ...selection, evidenceRole: "contextual" }] }).success).toBe(false);
    expect(moderatorContextualEvidenceSelectionModelResultSchema.safeParse({ ...value, selections: [{ ...selection, evidenceRole: "contextual", contribution: "requested_context" }] }).success).toBe(true);
  });
});
