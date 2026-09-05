import { describe, expect, it } from "vitest";
import { moderatorEvidencePacketSchema } from "@interview/schemas";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

const source = (id: string) => CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === id)!;

describe("core PFS, interaction, and safety source coverage", () => {
  it("keeps the SEQUOIA randomized population and comparator attached to its PI PFS results", () => {
    const { text } = source("brukinsa-cll-sequoia");
    expect(source("brukinsa-cll-sequoia").url).toBe("https://brukinsahcp.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=32");
    expect(text).toContain("previously untreated CLL/SLL without del(17p)");
    expect(text).toContain("BRUKINSA (N=241) versus bendamustine plus rituximab (N=238)");
    expect(text).toContain("hazard ratio of 0.42 (95% CI 0.28-0.63; p<0.0001)");
    expect(text).toContain("not estimable with BRUKINSA versus 33.7 months");
    expect(text).toContain("separate del(17p) cohort was single-arm");
    expect(text).not.toMatch(/6.year|overall survival.*0\.42/i);
  });

  it("keeps ALPINE's relapsed/refractory head-to-head PI analysis separate from later follow-up", () => {
    const { text } = source("brukinsa-cll-alpine");
    expect(source("brukinsa-cll-alpine").url).toBe("https://brukinsahcp.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=35");
    expect(text).toContain("relapsed or refractory CLL/SLL");
    expect(text).toContain("BRUKINSA (N=327) versus ibrutinib (N=325)");
    expect(text).toContain("hazard ratio of 0.65 (95% CI 0.49-0.86; two-sided p=0.0024)");
    expect(text).toContain("not estimable with BRUKINSA versus 35 months");
    expect(text).toContain("distinct from later follow-up");
  });

  it("attributes EV-302 PFS to the combination and correct chemotherapy comparator", () => {
    const { text } = source("padcev-ev302");
    expect(source("padcev-ev302").url).toBe("https://astellas.us/docs/PADCEV_label.pdf#page=42");
    expect(text).toContain("previously untreated locally advanced or metastatic urothelial cancer");
    expect(text).toContain("PADCEV plus intravenous pembrolizumab (N=442)");
    expect(text).toContain("gemcitabine plus cisplatin or carboplatin (N=444)");
    expect(text).toContain("12.5 versus 6.3 months; hazard ratio 0.45 (95% CI 0.38-0.54; p<0.0001)");
    expect(text).toContain("not PADCEV monotherapy results");
  });

  it("preserves PADCEV interaction class, exposure direction, and monitoring boundary in reusable evidence", () => {
    const retained = moderatorEvidencePacketSchema.parse({ sources: [source("padcev-ddi-profile")] }).sources[0];
    expect(retained.text).toContain("dual P-gp and strong CYP3A4 inhibitors may increase exposure to unconjugated monomethyl auristatin E (MMAE)");
    expect(retained.text).toContain("potentially increasing PADCEV toxicity incidence or severity");
    expect(retained.text).toContain("close monitoring for toxicity signs");
    expect(retained.text).toContain("does not identify a specific interaction-attributable adverse reaction or monitoring schedule");
    expect(retained.text).not.toMatch(/\d+(?:\.\d+)?\s*(?:mg|%)/i);
    expect(retained.assets).toEqual([expect.objectContaining({ assetKind: "LINK", url: "https://astellas.us/docs/PADCEV_label.pdf#page=28" })]);
  });

  it("provides actual general monitoring content distinct from interaction-only source text", () => {
    expect(source("brukinsa-safety-management").text).toContain("monitoring complete blood counts");
    expect(source("brukinsa-safety-management").text).toContain("bilirubin and transaminases before and during treatment");
    expect(source("padcev-safety-management").text).toContain("blood-glucose monitoring in patients with or at risk for diabetes or hyperglycemia");
    expect(source("padcev-safety-management").text).toContain("new or worsening peripheral neuropathy");
    expect(source("nubeqa-safety-dosing").text).toContain("hypertension, diabetes, and dyslipidemia");
    expect(source("nubeqa-safety-dosing").text).toContain("discontinue NUBEQA for Grade 3-4 ischemic heart disease");
    expect(source("nubeqa-safety-dosing").text).toContain("consider discontinuation if a seizure develops");
    expect(source("nubeqa-safety-dosing").text).not.toContain("CYP3A4");
    expect(source("nubeqa-ddi-profile").text).toContain("CYP3A4");
  });

  it("keeps NUBEQA's toxicity interruption option and recovery condition", () => {
    const { text } = source("nubeqa-safety-dosing");
    expect(text).toContain("withhold treatment or reduce to 300 mg twice daily until symptoms improve");
    expect(text).toContain("600 mg twice daily may resume when the reaction returns to baseline");
    expect(text).toContain("eGFR 15-29 mL/min/1.73 m2, without hemodialysis");
    expect(text).toContain("Child-Pugh B");
    expect(text).not.toMatch(/monitor.*(?:weekly|monthly|every \d+ days)/i);
  });
});
