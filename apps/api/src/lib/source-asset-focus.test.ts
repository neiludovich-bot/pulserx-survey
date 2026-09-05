import type { GroundedReference } from "@interview/schemas";
import { describe, expect, it } from "vitest";
import { focusSourceReferenceAssets } from "./source-asset-focus";

const references: GroundedReference[] = [{
  citationId: "source:1", title: "Safety, Dosing, and DDI", url: "https://example.com/safety",
  description: "Safety information", assets: [
    { title: "ARANOTE adverse reaction chart", url: "https://example.com/aranote.svg", description: "Includes broad source tags", assetKind: "CHART", tags: ["ddi", "dosing", "safety"], priority: 100 },
    { title: "Drug interactions", url: "https://example.com/interactions.svg", description: "Interaction diagram", assetKind: "CHART", tags: ["ddi"], priority: 50 },
    { title: "ARASENS adverse reaction chart", url: "https://example.com/arasens.svg", description: null, assetKind: "CHART", tags: ["safety"], priority: 90 },
  ],
}];

describe("source asset focus", () => {
  it.each(["what DDI's are noted", "What drug interactions are noted?", "DDIs"])("matches the asset's topic rather than broad inherited tags: %s", (query) => {
    const result = focusSourceReferenceAssets(references, query);
    expect(result[0].assets.map((asset) => asset.title)).toEqual(["Drug interactions"]);
    expect(result[0].citationId).toBe("source:1");
  });

  it("keeps the ARANOTE reaction chart for the UTI question", () => {
    const result = focusSourceReferenceAssets(references, "tell me about the higher UTI instances");
    expect(result[0].assets.map((asset) => asset.title)).toEqual(["ARANOTE adverse reaction chart"]);
  });

  it("keeps the actual source link when there is no relevant figure", () => {
    const result = focusSourceReferenceAssets([{ ...references[0], assets: [references[0].assets[0]] }], "what DDIs are noted");
    expect(result[0].assets).toEqual([expect.objectContaining({ assetKind: "LINK", url: references[0].url })]);
  });

  it("preserves broad and mixed-topic asset selections", () => {
    expect(focusSourceReferenceAssets(references, "Show me the safety data")).toBe(references);
    expect(focusSourceReferenceAssets(references, "Explain UTI and DDI")).toBe(references);
  });
});
