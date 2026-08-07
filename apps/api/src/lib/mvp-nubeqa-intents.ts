import type { MvpSurveyIntent } from "./mvp-survey-definition";

export const NUBEQA_SURVEY_INTENTS = [
  {
    slug: "general-nubeqa-reaction",
    label: "General NUBEQA Reaction",
    primaryIntent:
      "Understand overall reaction to NUBEQA source information across mCSPC evidence, nmCRPC evidence, safety, dosing, patient fit, and implementation.",
    requiredCoverage: [
      "baseline familiarity",
      "current role across nmCRPC and mCSPC",
      "ARANOTE and/or ARASENS evidence when relevant",
      "ARAMIS evidence when relevant",
      "patient fit and caution areas",
      "safety, dosing, DDI, or implementation barriers",
    ],
    steeringRule:
      "Keep the discussion balanced. If the respondent is negative, ask what source-supported evidence or operational support might change that view; if positive, ask where that confidence would apply first.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "decision_framework",
      "indication_positioning",
      "mcspc_aranote",
      "mcspc_arasens",
      "nmcrpc_aramis",
      "patient_fit",
      "safety_dosing",
      "guidelines_resources",
      "overall",
      "close",
    ],
  },
  {
    slug: "mcspc-evidence",
    label: "mCSPC Evidence",
    primaryIntent:
      "Guide the respondent through NUBEQA mCSPC evidence and identify how ARANOTE and ARASENS affect patient-fit thinking.",
    requiredCoverage: [
      "ARANOTE NUBEQA plus ADT evidence",
      "ARASENS NUBEQA plus ADT plus docetaxel evidence",
      "docetaxel-fit or without-docetaxel decision point",
      "safety or dosing caveats",
      "remaining mCSPC evidence questions",
    ],
    steeringRule:
      "Prioritize mCSPC evidence. If the respondent asks about nmCRPC, answer briefly from source and return to mCSPC unless they clearly pivot.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "mcspc_aranote",
      "mcspc_arasens",
      "patient_fit",
      "safety_dosing",
      "overall",
      "close",
    ],
  },
  {
    slug: "nmcrpc-evidence",
    label: "nmCRPC Evidence",
    primaryIntent:
      "Understand reaction to ARAMIS evidence and where NUBEQA fits for appropriate nmCRPC patients.",
    requiredCoverage: [
      "ARAMIS MFS evidence",
      "overall survival or secondary endpoints when relevant",
      "PSADT or patient-fit considerations",
      "safety or dosing caveats",
      "remaining nmCRPC evidence questions",
    ],
    steeringRule:
      "Prioritize nmCRPC and ARAMIS. Answer mCSPC questions as brief source excursions; the controller will resume the nmCRPC lane unless the respondent clearly pivots.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "nmcrpc_aramis",
      "patient_fit",
      "safety_dosing",
      "guidelines_resources",
      "overall",
      "close",
    ],
  },
  {
    slug: "safety-dosing-practicality",
    label: "Safety, Dosing & Practicality",
    primaryIntent:
      "Understand safety, DDI, dosing, and operational barriers to using or supporting NUBEQA.",
    requiredCoverage: [
      "main safety concern",
      "DDI or comorbidity concern when raised",
      "BID with food and dose-modification feasibility",
      "practice resources or access support",
      "what would reduce the barrier",
    ],
    steeringRule:
      "Prioritize practical safety/dosing barriers and source-supported mitigation. Do not drift into efficacy unless the respondent asks about risk-benefit.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "safety_dosing",
      "patient_fit",
      "guidelines_resources",
      "overall",
      "close",
    ],
    allowedQuestionIds: [
      "intro_consent",
      "familiarity",
      "safety_dosing",
      "patient_fit",
      "guidelines_resources",
      "overall",
      "close",
    ],
    blockedQuestionIds: ["mcspc_aranote", "mcspc_arasens", "nmcrpc_aramis"],
    offLaneSourceRule:
      "In this intent, efficacy questions are source excursions unless the respondent explicitly asks to compare benefit-risk or evidence strength.",
  },
  {
    slug: "patient-selection-barriers",
    label: "Patient Selection & Barriers",
    primaryIntent:
      "Identify where NUBEQA feels most appropriate, where clinicians are cautious, and what would make them more confident.",
    requiredCoverage: [
      "disease-state or patient-type fit",
      "mCSPC with or without docetaxel considerations",
      "nmCRPC considerations",
      "safety/DDI/comorbidity cautions",
      "evidence or resource needed to change thinking",
    ],
    steeringRule:
      "Probe patient-fit reasoning. If negative, present the most relevant source evidence and ask whether that changes anything; if not, capture the remaining blocker.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "patient_fit",
      "mcspc_aranote",
      "nmcrpc_aramis",
      "safety_dosing",
      "overall",
      "close",
    ],
  },
  {
    slug: "familiar-whats-new",
    label: "Already Familiar: What's New",
    primaryIntent:
      "Orient familiar respondents to newer or emphasized NUBEQA information and determine what, if anything, would change behavior.",
    requiredCoverage: [
      "current mCSPC with/without docetaxel framing",
      "ARANOTE mCSPC evidence",
      "ARASENS or ARAMIS if relevant",
      "guideline or implementation updates",
      "remaining information gaps",
    ],
    steeringRule:
      "Assume basic familiarity. Avoid slow intake and focus on source-backed updates, underappreciated details, and what could change clinical behavior.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "indication_positioning",
      "mcspc_aranote",
      "mcspc_arasens",
      "nmcrpc_aramis",
      "guidelines_resources",
      "close",
    ],
  },
] satisfies MvpSurveyIntent[];
