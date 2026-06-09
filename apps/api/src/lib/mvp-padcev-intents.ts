import type { MvpSurveyIntent } from "./mvp-survey-definition";

export const PADCEV_SAFETY_LANE_QUESTION_IDS = new Set([
  "safety",
  "safety_management_workflow",
  "safety_patient_caution",
  "safety_resources",
  "support_barriers",
  "safety_close",
]);

export const PADCEV_SURVEY_INTENTS = [
  {
    slug: "general-padcev-reaction",
    label: "General PADCEV Reaction",
    primaryIntent:
      "Understand the respondent's overall reaction to PADCEV source information across evidence, safety, patient fit, and implementation.",
    requiredCoverage: [
      "baseline familiarity",
      "current indication and positioning",
      "EV-302/KEYNOTE-A39 first-line evidence",
      "patient fit",
      "safety/tolerability",
      "overall perception",
    ],
    steeringRule:
      "Keep the discussion balanced across source-supported efficacy, safety, patient fit, dosing/admin, and implementation. Do not dwell on intake demographics.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "indication_positioning",
      "ev302",
      "patient_fit",
      "safety",
      "dosing_admin",
      "overall",
      "close",
    ],
  },
  {
    slug: "ev302-first-line-evidence",
    label: "EV-302 / First-Line Evidence",
    primaryIntent:
      "Guide the respondent through the PADCEV plus pembrolizumab first-line evidence and identify what the EV-302/KEYNOTE-A39 data changes or fails to change.",
    requiredCoverage: [
      "EV-302/KEYNOTE-A39 design",
      "key efficacy outcomes",
      "patient types where evidence is compelling",
      "safety caveats tied to first-line use",
      "remaining evidence questions",
    ],
    steeringRule:
      "Prioritize concrete EV-302/KEYNOTE-A39 study details and first-line implications. Answer other source questions briefly, then return to first-line evidence.",
    questionOrder: [
      "intro_consent",
      "ev302",
      "patient_fit",
      "safety",
      "overall",
      "close",
    ],
  },
  {
    slug: "side-effect-management",
    label: "Side Effect Management",
    primaryIntent:
      "Understand how practitioners think about monitoring, counseling, mitigating, and operationalizing PADCEV-associated adverse events.",
    requiredCoverage: [
      "baseline safety concern",
      "skin reaction management",
      "peripheral neuropathy",
      "hyperglycemia",
      "pneumonitis/ILD and ocular issues when relevant",
      "dose modification confidence",
      "patient counseling and monitoring barriers",
    ],
    steeringRule:
      "Prioritize safety-management confidence, monitoring workflow, dose modification comfort, and practical barriers. Do not route into broad efficacy, PFS/OS, or general patient-attractiveness questions unless the respondent explicitly asks about efficacy or risk-benefit.",
    questionOrder: [
      "intro_consent",
      "safety",
      "safety_management_workflow",
      "safety_patient_caution",
      "safety_resources",
      "support_barriers",
      "safety_close",
      "close",
    ],
    allowedQuestionIds: [
      "intro_consent",
      "safety",
      "safety_management_workflow",
      "safety_patient_caution",
      "safety_resources",
      "support_barriers",
      "safety_close",
      "close",
    ],
    blockedQuestionIds: [
      "indication_positioning",
      "ev302",
      "patient_fit",
      "monotherapy_evidence",
      "overall",
    ],
    offLaneSourceRule:
      "For the side-effect-management intent, efficacy/PFS/OS and broad patient-attractiveness modules are off-lane unless the respondent explicitly asks about efficacy, clinical benefit, or risk-benefit tradeoff.",
  },
  {
    slug: "patient-selection-barriers",
    label: "Patient Selection & Barriers",
    primaryIntent:
      "Identify where PADCEV feels appropriate, where clinicians are cautious, and which practical barriers prevent adoption.",
    requiredCoverage: [
      "appropriate patient populations",
      "caution or avoidance segments",
      "comorbidity and toxicity-risk concerns",
      "implementation barriers",
      "access/support needs",
      "what would increase confidence",
    ],
    steeringRule:
      "Prioritize patient-fit, caution segments, and barriers. Use source evidence to probe why the respondent would or would not use PADCEV in specific scenarios.",
    questionOrder: [
      "intro_consent",
      "patient_fit",
      "indication_positioning",
      "ev302",
      "safety",
      "support_barriers",
      "overall",
      "close",
    ],
  },
  {
    slug: "familiar-whats-new",
    label: "Already Familiar: What's New",
    primaryIntent:
      "Orient familiar respondents to newer or emphasized PADCEV information and determine what, if anything, would change behavior.",
    requiredCoverage: [
      "current indication or positioning updates",
      "EV-302/KEYNOTE-A39 first-line evidence",
      "later-line monotherapy context",
      "safety-management details that may be underappreciated",
      "remaining information gaps",
    ],
    steeringRule:
      "Assume basic familiarity. Avoid basic intake and introductory education; focus on what is new, underappreciated, or practice-changing.",
    questionOrder: [
      "intro_consent",
      "indication_positioning",
      "ev302",
      "monotherapy_evidence",
      "safety",
      "overall",
      "close",
    ],
  },
] satisfies MvpSurveyIntent[];
