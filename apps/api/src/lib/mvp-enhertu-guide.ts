import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";
import type { MvpSurveyIntent } from "./mvp-survey-definition";

const contextRule = "Keep the participant's selected cancer setting, HER2 status, treatment line, regimen, trial and analysis together. Clarify an ambiguous setting before presenting numeric results. Use only ENHERTU HCP website evidence and documents linked by that site. Describe what the evidence says, not personal treatment advice. Do not imply cross-trial superiority or transfer results between indications. Preserve accelerated-approval and analysis limitations where applicable.";
function question(id: string, module: string, objective: string, canonicalQuestion: string, sourceContextRequirement: string | null = null): MvpGuideQuestion {
  return { id, module, objective, canonicalQuestion, sourceContextRequirement, routeKeywords: [],
    completionSignals: [objective], adaptiveProbes: [], analyzableOutputs: [id], ...(id === "close" ? { close: true } : {}) };
}

export const ENHERTU_HCP_GUIDE: MvpGuideQuestion[] = [
  question("intro_consent", "Introduction", "Obtain agreement to participate.", "We're exploring your reaction to ENHERTU evidence and practical information, focusing on the cancer settings relevant to you. This is market research, not a test. Please omit patient-identifying information. Is it okay to begin?"),
  question("primary_disease_focus", "Familiarity and context", "Identify the clinician's chosen cancer setting, HER2 subgroup and treatment context before discussing evidence.", "Which ENHERTU setting would you like to focus on: breast, lung, gastric, or another solid tumor?"),
  question("familiarity", "Familiarity and context", "Understand baseline familiarity with ENHERTU in the selected setting.", "How familiar are you with ENHERTU in that setting?"),
  { ...question("decision_framework", "Decision drivers", "Capture the clinician's decision priorities before showing evidence.", "What matters most to you when evaluating treatment evidence in that setting?"), captureBeforeSourceContext: true },
  question("clinical_evidence", "Evidence reaction", `Understand the clinician's reaction to the efficacy evidence relevant to their selected setting and why. ${contextRule}`, "What stands out to you in those results, and what shapes your reaction?", `Present a concise, source-cited account of the relevant ENHERTU study in the setting the participant selected. Include population, regimen, comparator when present, endpoint and material qualifications; select its matching figures when available. ${contextRule}`),
  question("safety_dosing", "Safety and practicality", `Understand safety or administration concerns and their practical implications in the selected setting. ${contextRule}`, "Which aspects of the safety or administration information matter most in your practice, and why?", `Present the relevant ENHERTU safety and administration information for the selected regimen and setting, including material boxed-warning context. Select source-owned safety figures or dose-modification tables only when relevant. ${contextRule}`),
  question("patient_fit", "Patient fit", "Understand the clinician's own view of patient fit, biomarker testing and remaining uncertainty in the chosen setting.", "Where, if anywhere, do you see a role for ENHERTU in your practice, and what shapes that view?"),
  question("practice_resources", "Implementation", "Identify information, resources or practical barriers relevant to the clinician's selected setting.", "What information or practical support would be most useful to you?"),
  question("overall", "Overall perspective", "Capture what changed or remained unchanged in the clinician's perspective and why.", "After this discussion, what stands out most to you about ENHERTU, and why?"),
  question("close", "Remaining needs", "Identify outstanding questions and permit continued discussion before the final recap.", "What, if anything, would you still want clarified about ENHERTU?"),
];

export const ENHERTU_FOCUS = {
  "general-enhertu-reaction": { label: "General ENHERTU Reaction", scope: "the cancer setting chosen by the clinician", question: "Which ENHERTU setting would you like to focus on: breast, lung, gastric, or another solid tumor?" },
  "breast-cancer-evidence": { label: "Breast Cancer Evidence", scope: "breast cancer, distinguishing early from metastatic disease, HER2 status and treatment line", question: "Which breast cancer setting would you like to discuss—early or metastatic disease, and which HER2 group or treatment line?" },
  "lung-cancer-evidence": { label: "Lung Cancer Evidence", scope: "HER2-mutant non-small cell lung cancer, with prior-treatment and biomarker context", question: "What would you most like to understand about ENHERTU in HER2-mutant non-small cell lung cancer?" },
  "gastric-cancer-evidence": { label: "Gastric Cancer Evidence", scope: "HER2-positive gastric or gastroesophageal junction cancer, with prior-treatment context", question: "What would you most like to understand about ENHERTU in HER2-positive gastric or gastroesophageal junction cancer?" },
  "solid-tumor-evidence": { label: "Other Solid Tumor Evidence", scope: "HER2-positive solid tumors, identifying the tumor type and biomarker context", question: "Which solid tumor type would you like to focus on, and what would you like to understand?" },
  "safety-dosing-practicality": { label: "Safety, Dosing & Practicality", scope: "safety and administration in the cancer setting and regimen selected by the clinician", question: "Which cancer setting or ENHERTU regimen should we focus on for safety and dosing?" },
} as const;

export const ENHERTU_SURVEY_INTENTS: MvpSurveyIntent[] = Object.entries(ENHERTU_FOCUS).map(([slug, focus]) => ({
  slug, label: focus.label, primaryIntent: `Understand the clinician's perspective on ${focus.scope}.`,
  requiredCoverage: ["selected setting and baseline familiarity", "decision priorities", "reaction and reasoning", "practical implications", "remaining information needs"],
  steeringRule: `Follow the clinician's chosen focus and allow explicit pivots. Positive, negative and unchanged reactions are equally valid. ${contextRule}`,
  questionOrder: ENHERTU_HCP_GUIDE.filter(q => slug !== "safety-dosing-practicality" || q.id !== "clinical_evidence").map(q => q.id),
}));

export function enhertuGuideForIntent(guide: MvpGuideQuestion[], slug?: string) {
  const focus = ENHERTU_FOCUS[slug as keyof typeof ENHERTU_FOCUS] ?? ENHERTU_FOCUS["general-enhertu-reaction"];
  return guide.map(q => q.id === "primary_disease_focus"
    ? { ...q, canonicalQuestion: focus.question, objective: `Understand ${focus.scope}. ${q.objective}` }
    : q.sourceContextRequirement ? { ...q, sourceContextRequirement: `Selected focus: ${focus.scope}. ${q.sourceContextRequirement}` } : q);
}
