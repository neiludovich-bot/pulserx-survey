import { describe, expect, it } from "vitest";
import { NUBEQA_HCP_MVP_GUIDE } from "./mvp-nubeqa-guide";
import { BRUKINSA_HCP_MVP_GUIDE } from "./mvp-brukinsa-guide";
import { PADCEV_HCP_MVP_GUIDE } from "./mvp-padcev-guide";
import { objectiveOrientedGuide, researchPlanForGuide } from "./mvp-research-objectives";
describe("research objectives at setup", () => {
  it.each([["NUBEQA", NUBEQA_HCP_MVP_GUIDE], ["BRUKINSA", BRUKINSA_HCP_MVP_GUIDE], ["PADCEV", PADCEV_HCP_MVP_GUIDE]] as const)("defines %s objectives and a neutral consent preamble", (brand, guide) => {
    const adapted = objectiveOrientedGuide([...guide], brand);
    expect(adapted[0].canonicalQuestion).toContain("with room to explore what interests you");
    expect(adapted[0].canonicalQuestion).toContain("Is it okay to begin?");
    expect(guide[0].canonicalQuestion).not.toContain("with room to explore");
    const plan = researchPlanForGuide(adapted);
    expect(plan.objectives).toHaveLength(guide.length - 1);
    expect(plan.objectives.every(item => item.status === "uncovered" && item.evidence.length === 0)).toBe(true);
    expect(plan.objectives.find(item => item.id === "familiarity")?.criteria).toHaveLength(1);
    expect(plan.objectives.find(item => item.id === "patient_fit")?.criteria.map(item => item.id)).toEqual(["perspective", "reason"]);
  });
});
