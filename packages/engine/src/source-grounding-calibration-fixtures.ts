import { sourceGroundingReviewInputSchema } from "@interview/schemas";

// Paired replay cases derived from synthetic QA ac5fa67 diagnostics (2026-09-05).
// Expected verdicts distinguish semantic support from wording similarity.
const nubeqaSafety = "General safety guidance includes monitoring ischemic heart disease symptoms and managing cardiovascular risk factors, including hypertension, diabetes, and dyslipidemia; discontinue NUBEQA for Grade 3-4 ischemic heart disease. These are general NUBEQA warnings, not evidence that a particular interacting medicine causes ischemic heart disease or seizure.";
const nubeqaInteraction = "Combined P-gp and strong CYP3A4 inhibitors increase darolutamide exposure; the label calls for more frequent monitoring for NUBEQA adverse reactions and dosage modification as needed.";
const brukinsaInteraction = "Moderate or strong CYP3A inhibitors increase zanubrutinib exposure (Cmax and AUC), which may increase BRUKINSA toxicity risk; the label calls for reducing the BRUKINSA dose during coadministration. Table 17 provides these interaction effects and management instructions, without incidence rates for individual adverse reactions attributable to these combinations.";
const brukinsaSafety = "Practical guidance includes checking for bleeding or infection symptoms and monitoring complete blood counts during treatment. These are general treatment precautions; they do not establish which individual adverse reactions result from a specific drug interaction.";
const padcevChecklist = "Source notes: Checklist is a guide to help HCPs identify or monitor any potential adverse reactions that may occur during PADCEV treatment prior to each infusion and follow-up. It prompts review of signs and questions for skin reactions; hyperglycemia; pneumonitis/ILD; peripheral neuropathy; ocular disorders; infusion site extravasation; GI symptoms including nausea, vomiting, diarrhea, constipation, abdominal pain; and follow-up actions. Use as an HCP monitoring workflow supplement; PI remains controlling label source.";

function fixture(id: string, text: string, sources: string[], unsupported: { excerpt: string; reason: string } | null) {
  return {
    id,
    input: sourceGroundingReviewInputSchema.parse({ draft: { practicalAnswer: text, qualification: null }, sources: sources.map((source, index) => ({ index: index + 1, text: source })) }),
    expected: { version: 1 as const, supported: unsupported === null, unsupportedClaims: unsupported ? [unsupported] : [] },
  };
}

export const sourceGroundingCalibrationFixtures = [
  fixture("faithful_watch_monitor_paraphrase", "General NUBEQA safety guidance includes watching for ischemic heart disease symptoms. [1]", [nubeqaSafety], null),
  fixture("invented_weekly_frequency", "General NUBEQA safety guidance calls for weekly checks for ischemic heart disease symptoms. [1]", [nubeqaSafety], { excerpt: "weekly checks", reason: "The source gives no weekly frequency." }),
  fixture("attributed_checklist_without_boilerplate", "As general PADCEV monitoring workflow guidance, the checklist prompts review before each infusion and follow-up for skin reactions, hyperglycemia, pneumonitis or ILD, and peripheral neuropathy. [1]", [padcevChecklist], null),
  fixture("checklist_falsely_called_label", "The PADCEV prescribing information requires reviewing skin reactions before each infusion and follow-up. [1]", [padcevChecklist], { excerpt: "The PADCEV prescribing information requires", reason: "This is a checklist prompt, not evidence of a prescribing-information requirement." }),
  fixture("independent_general_safety_context", "The label calls for reducing BRUKINSA dose with moderate or strong CYP3A inhibitors. [1] Separately, general safety guidance includes checking for bleeding or infection symptoms and monitoring blood counts during treatment. [2]", [brukinsaInteraction, brukinsaSafety], null),
  fixture("invented_interaction_specific_event", "Moderate or strong CYP3A inhibitors increase the risk of bleeding from BRUKINSA. [1] [2]", [brukinsaInteraction, brukinsaSafety], { excerpt: "increase the risk of bleeding", reason: "The interaction source supports toxicity risk generally, not this specific adverse event." }),
  fixture("coadministration_condition_preserved", "If NUBEQA is used with combined P-gp and strong CYP3A4 inhibitors, the label calls for checking more often for NUBEQA adverse reactions. [1]", [nubeqaInteraction], null),
  fixture("coadministration_condition_lost", "The label calls for checking more often for adverse reactions in all NUBEQA patients. [1]", [nubeqaInteraction], { excerpt: "in all NUBEQA patients", reason: "The source limits the instruction to coadministration with combined P-gp and strong CYP3A4 inhibitors." }),
  fixture("unsupported_absence_of_checklist", "The label does not name a special interaction-specific toxicity checklist. [1]", [nubeqaInteraction], { excerpt: "does not name a special interaction-specific toxicity checklist", reason: "Omission from this excerpt does not establish absence from the label." }),
  fixture("unwarranted_monitoring_sequence", "After dose reduction for a CYP3A inhibitor, monitoring then follows general BRUKINSA safety guidance. [1] [2]", [brukinsaInteraction, brukinsaSafety], { excerpt: "monitoring then follows general BRUKINSA safety guidance", reason: "The sources do not define this interaction-specific monitoring sequence." }),
  fixture("explicitly_supported_scoped_absence", "Table 17 gives interaction effects and management instructions without incidence rates for individual adverse reactions attributable to these combinations. [1]", [brukinsaInteraction], null),
];
