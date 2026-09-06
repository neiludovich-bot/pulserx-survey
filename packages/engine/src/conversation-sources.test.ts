import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
import { coalesceConversationSources } from "./conversation-sources";
import type { WebsiteAnswerModelResult } from "@interview/schemas";
const fixture = (): WebsiteAnswerModelResult => ({ version: 1, rationale: "Two passages on one page", unavailableReason: null, paragraphs: [{ text: "Two supported facts.", sourceIds: ["page"] }], selections: [
  { sourceId: "page", supportSpanRange: { startSpan: 0, endSpan: 1 }, assetIds: [], evidenceRole: "direct", contribution: "answer" },
  { sourceId: "page", supportSpanRange: { startSpan: 3, endSpan: 4 }, assetIds: [], evidenceRole: "direct", contribution: "answer" },
] });
describe("same-page source passages", () => {
  it("uses one citation for same-role passages without changing answer text", () => {
    const input=fixture(); const result=coalesceConversationSources(input);
    expect(result.selections).toHaveLength(1); expect(result.selections[0].supportSpanRange).toEqual({ startSpan: 0, endSpan: 4 });
    expect(result.paragraphs).toEqual(input.paragraphs); expect(input.selections).toHaveLength(2);
  });
  it("rejects conflicting roles instead of relabeling evidence", () => {
    const input=fixture(); input.selections[1].evidenceRole="contextual";
    expect(() => coalesceConversationSources(input)).toThrow("Conflicting roles");
  });
});
