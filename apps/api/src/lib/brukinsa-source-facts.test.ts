import { describe, expect, it } from "vitest";
import { moderatorEvidencePacketSchema } from "@interview/schemas";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

describe("BRUKINSA approved interaction evidence coverage", () => {
  const source = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "brukinsa-ddi-profile")!;

  it("supplies opposing inhibitor and inducer effects in factual text without depending on indexing tags", () => {
    const textOnly = { ...source, tags: [], description: "" };
    expect(textOnly.text).toMatch(/CYP3A inhibitors increase zanubrutinib exposure/);
    expect(textOnly.text).toMatch(/may increase BRUKINSA toxicity risk/);
    expect(textOnly.text).toMatch(/reducing the BRUKINSA dose during coadministration/);
    expect(textOnly.text).toMatch(/CYP3A inducers lower zanubrutinib exposure/);
    expect(textOnly.text).toMatch(/potentially reducing BRUKINSA efficacy/);
    expect(textOnly.text).toMatch(/avoiding strong and moderate CYP3A inducers/);
    expect(textOnly.text).toMatch(/If a moderate inducer cannot be avoided/);
    expect(textOnly.text).toMatch(/consult section 2\.3/);
  });

  it("keeps general warning topics out of interaction-attributable claims and omits dose or incidence numbers", () => {
    expect(source.text).toContain("without incidence rates for individual adverse reactions attributable to these combinations");
    expect(source.text).not.toMatch(/\d+(?:\.\d+)?\s*(?:mg|%)/i);
    expect(source.text).not.toMatch(/hemorrhage|cytopenia|arrhythmia|hepatotoxicity/i);
    expect(CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "brukinsa-safety-management")?.text).toContain("hemorrhage");
  });

  it("retains an official source-owned prescribing-information link in the reusable evidence packet", () => {
    const packet = moderatorEvidencePacketSchema.parse({ sources: [source] });
    const retained = packet.sources[0];
    expect(retained.url).toBe("https://brukinsa.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=23");
    expect(retained.assets).toHaveLength(1);
    expect(retained.assets[0]).toMatchObject({ assetKind: "LINK", url: retained.url });
    expect(retained.description).toContain("section 7.1, Table 17");
  });
});
