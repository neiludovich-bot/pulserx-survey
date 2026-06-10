import type { MvpSurveyIntent } from "./mvp-survey-definition";

export const BRUKINSA_SAFETY_LANE_QUESTION_IDS = new Set([
  "cll_safety_tolerability",
  "general_safety_isi",
  "medication_management",
  "dosing_formulation",
  "support_resources",
]);

export const BRUKINSA_SURVEY_INTENTS = [
  {
    slug: "general-brukinsa-reaction",
    label: "General BRUKINSA Reaction",
    primaryIntent:
      "Understand the respondent's overall reaction to BRUKINSA source information across evidence, safety, patient fit, dosing, medication management, and support.",
    requiredCoverage: [
      "baseline familiarity",
      "current breadth and positioning",
      "CLL/SLL evidence anchors when CLL/SLL is relevant",
      "safety and tolerability",
      "dosing or medication-management fit",
      "overall perception",
    ],
    steeringRule:
      "Keep the discussion balanced across source-supported evidence, safety/tolerability, patient fit, dosing, medication management, and support. Do not dwell on intake demographics.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "breadth",
      "cll_orientation",
      "sequoia",
      "alpine",
      "cll_safety_tolerability",
      "dosing_formulation",
      "support_resources",
      "overall_perception",
      "close",
    ],
  },
  {
    slug: "cll-sequoia-evidence",
    label: "CLL/SLL: SEQUOIA & ALPINE",
    primaryIntent:
      "Guide the respondent through BRUKINSA CLL/SLL evidence, with emphasis on SEQUOIA first-line evidence and ALPINE head-to-head evidence when relevant.",
    requiredCoverage: [
      "baseline CLL/SLL perception",
      "SEQUOIA design and key results",
      "ALPINE comparative evidence when relevant",
      "NCCN or guideline positioning",
      "patient types where evidence is compelling",
      "remaining evidence questions",
    ],
    steeringRule:
      "Prioritize concrete CLL/SLL source details and implications. Keep the disease lane in CLL/SLL unless the respondent explicitly asks to compare another disease area.",
    questionOrder: [
      "intro_consent",
      "cll_baseline_perception",
      "cll_orientation",
      "sequoia",
      "sequoia_patient_fit",
      "alpine",
      "cll_guideline_positioning",
      "cll_safety_tolerability",
      "overall_perception",
      "close",
    ],
  },
  {
    slug: "safety-tolerability-management",
    label: "Safety & Tolerability Management",
    primaryIntent:
      "Understand how practitioners think about BRUKINSA safety, tolerability, monitoring, dose modification, interactions, and operational support.",
    requiredCoverage: [
      "baseline safety or tolerability concern",
      "CLL/SLL safety/tolerability when CLL/SLL is relevant",
      "hemorrhage, infection, cytopenia, cardiac, hepatic, or interaction concerns when raised",
      "dose modification and medication-management confidence",
      "support resources or remaining barriers",
    ],
    steeringRule:
      "Prioritize safety/tolerability confidence, monitoring workflow, dose modification, medication-management fit, and practical barriers. Do not route into broad efficacy, PFS/OS, or cross-disease breadth unless the respondent explicitly asks about efficacy or risk-benefit.",
    questionOrder: [
      "intro_consent",
      "general_safety_isi",
      "cll_safety_tolerability",
      "medication_management",
      "dosing_formulation",
      "support_resources",
      "patient_fit",
      "close",
    ],
    allowedQuestionIds: [
      "intro_consent",
      "general_safety_isi",
      "cll_safety_tolerability",
      "medication_management",
      "dosing_formulation",
      "support_resources",
      "patient_fit",
      "close",
    ],
    blockedQuestionIds: [
      "breadth",
      "evidence_overview",
      "sequoia",
      "alpine",
      "wm_aspen",
      "accelerated_approval_indolent",
      "overall_perception",
    ],
    offLaneSourceRule:
      "For the safety-tolerability-management intent, efficacy/PFS/OS and broad disease-breadth modules are off-lane unless the respondent explicitly asks about efficacy, clinical benefit, or risk-benefit tradeoff.",
  },
  {
    slug: "patient-selection-barriers",
    label: "Patient Selection & Barriers",
    primaryIntent:
      "Identify where BRUKINSA feels appropriate, where clinicians are cautious, and which practical barriers prevent adoption or broader use.",
    requiredCoverage: [
      "appropriate patient populations",
      "caution or avoidance segments",
      "gene mutation or high-risk clinical context when raised",
      "safety and medication-management barriers",
      "support or access needs",
      "what would increase confidence",
    ],
    steeringRule:
      "Prioritize patient-fit, caution segments, safety/medication-management concerns, and barriers. Use source evidence to probe why the respondent would or would not use BRUKINSA in specific scenarios.",
    questionOrder: [
      "intro_consent",
      "breadth",
      "cll_orientation",
      "sequoia_patient_fit",
      "general_safety_isi",
      "medication_management",
      "dosing_formulation",
      "support_resources",
      "overall_perception",
      "close",
    ],
  },
  {
    slug: "familiar-whats-new",
    label: "Already Familiar: What's New",
    primaryIntent:
      "Orient familiar respondents to newer or emphasized BRUKINSA information and determine what, if anything, would change behavior.",
    requiredCoverage: [
      "current indication breadth or positioning updates",
      "CLL/SLL SEQUOIA and ALPINE details when relevant",
      "NCCN or guideline positioning",
      "tablet/dosing/formulation updates",
      "safety or medication-management details that may be underappreciated",
      "remaining information gaps",
    ],
    steeringRule:
      "Assume basic familiarity. Avoid basic intake and introductory education; focus on what is new, underappreciated, or practice-changing while staying in the respondent's active disease lane.",
    questionOrder: [
      "intro_consent",
      "breadth",
      "cll_orientation",
      "sequoia",
      "alpine",
      "cll_guideline_positioning",
      "dosing_formulation",
      "cll_safety_tolerability",
      "overall_perception",
      "close",
    ],
  },
] satisfies MvpSurveyIntent[];
