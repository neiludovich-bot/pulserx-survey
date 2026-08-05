import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";

export const NUBEQA_HCP_MVP_GUIDE = [
  {
    id: "intro_consent",
    module: "Introduction",
    objective: "Confirm permission and set neutral market research context.",
    canonicalQuestion:
      "Thank you for participating. We're conducting market research about NUBEQA and how healthcare professionals react to clinical information about the drug. This is not a test of knowledge, and there are no right or wrong answers. Please don't include patient-identifying information. Is it okay to begin?",
    sourceContextRequirement: null,
    routeKeywords: [],
    completionSignals: ["respondent agrees to begin"],
    adaptiveProbes: [],
    analyzableOutputs: ["consent_to_begin"],
  },
  {
    id: "familiarity",
    module: "Baseline perception",
    objective: "Establish baseline familiarity and identify the first topic lane.",
    canonicalQuestion:
      "How familiar are you with NUBEQA today across nmCRPC and metastatic castration-sensitive prostate cancer?",
    sourceContextRequirement: null,
    routeKeywords: [
      "familiar",
      "unfamiliar",
      "heard",
      "used",
      "nmcrpc",
      "mcspc",
      "mhspc",
      "darolutamide",
    ],
    completionSignals: ["familiarity level or known topic is stated"],
    adaptiveProbes: [
      "If unfamiliar: ask what they would want clarified first: eligible patients, survival data, rPFS/MFS, safety, or dosing.",
      "If familiar: ask which part they feel most up to date on and which part they may not have revisited recently.",
    ],
    analyzableOutputs: ["baseline_familiarity", "known_topics", "first_information_need"],
  },
  {
    id: "decision_framework",
    module: "Baseline perception",
    objective:
      "Capture decision drivers before the interviewer provides NUBEQA-specific source context.",
    canonicalQuestion:
      "Before we get into NUBEQA-specific information, what are the top factors that matter most when you evaluate androgen receptor pathway therapy or systemic intensification for an appropriate prostate cancer patient?",
    sourceContextRequirement: null,
    routeKeywords: [
      "efficacy",
      "survival",
      "progression",
      "metastasis",
      "safety",
      "tolerability",
      "dosing",
      "docetaxel",
      "guidelines",
      "patient fit",
    ],
    completionSignals: ["decision factors are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["decision_drivers"],
  },
  {
    id: "indication_positioning",
    module: "Source reaction",
    objective:
      "Orient respondent to NUBEQA's HCP positioning across mCSPC and nmCRPC and capture first reaction.",
    canonicalQuestion:
      "Clinically, how does NUBEQA's role across nmCRPC and mCSPC fit into your treatment framework?",
    sourceContextRequirement:
      "Before asking the positioning question, summarize only the current NUBEQA HCP indication and high-level role: adult patients with nmCRPC and adult patients with mCSPC, including use with ADT and the mCSPC with/without docetaxel framing when source-supported. Keep it neutral, concise, and source-cited.",
    routeKeywords: [
      "indication",
      "positioning",
      "nmcrpc",
      "mcspc",
      "mhspc",
      "adt",
      "docetaxel",
      "framework",
    ],
    completionSignals: ["reaction to NUBEQA positioning is stated"],
    adaptiveProbes: [
      "If positive: ask which disease state or patient scenario is most affected.",
      "If negative or skeptical: ask what evidence, patient-fit detail, or practical issue prevents stronger consideration.",
    ],
    analyzableOutputs: ["positioning_reaction", "role_in_framework"],
  },
  {
    id: "mcspc_aranote",
    module: "mCSPC evidence",
    objective: "Capture reaction to ARANOTE evidence for NUBEQA plus ADT.",
    canonicalQuestion:
      "What, if anything, does the ARANOTE mCSPC evidence change about how you think about NUBEQA plus ADT without docetaxel?",
    sourceContextRequirement:
      "Before asking the ARANOTE question, retrieve NUBEQA HCP mCSPC source context for ARANOTE. Include population, NUBEQA plus ADT versus placebo plus ADT, rPFS as the primary endpoint, source-supported results such as 24-month rPFS proportions when available, follow-up, and caveats. Cite the source most likely to expose the ARANOTE rPFS chart and study-design visual.",
    routeKeywords: [
      "aranote",
      "mcspc",
      "mhspc",
      "adt",
      "without docetaxel",
      "rpfs",
      "radiographic progression",
      "radiological progression",
    ],
    completionSignals: ["reaction to ARANOTE evidence is stated"],
    adaptiveProbes: [
      "If skeptical: ask what endpoint, follow-up, subgroup, or comparator detail would make the evidence more useful.",
      "If positive: ask which mCSPC patient type would be most affected by the without-docetaxel profile.",
    ],
    analyzableOutputs: ["aranote_reaction", "mcspc_without_docetaxel_fit"],
  },
  {
    id: "mcspc_arasens",
    module: "mCSPC evidence",
    objective: "Capture reaction to ARASENS evidence for NUBEQA with ADT and docetaxel.",
    canonicalQuestion:
      "For mCSPC patients where docetaxel is already part of the plan, how do the ARASENS data affect your view of adding NUBEQA?",
    sourceContextRequirement:
      "Before asking the ARASENS question, retrieve NUBEQA HCP mCSPC source context for ARASENS. Include NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel, overall survival and time-to-mCRPC framing when source-supported, and any key caveats. Cite the source most likely to expose ARASENS survival, secondary-endpoint, or study-design charts.",
    routeKeywords: [
      "arasens",
      "docetaxel",
      "triplet",
      "overall survival",
      "os",
      "time to mcrpc",
      "mcspc",
      "mhspc",
    ],
    completionSignals: ["reaction to ARASENS evidence is stated"],
    adaptiveProbes: [
      "If hesitant: ask whether the concern is docetaxel use, added toxicity, patient age/fitness, or evidence relevance.",
      "If positive: ask which patient profile would most justify the triplet approach.",
    ],
    analyzableOutputs: ["arasens_reaction", "docetaxel_combination_fit"],
  },
  {
    id: "nmcrpc_aramis",
    module: "nmCRPC evidence",
    objective: "Capture reaction to ARAMIS evidence in nmCRPC.",
    canonicalQuestion:
      "How does the ARAMIS nmCRPC evidence affect your view of NUBEQA for delaying metastasis or progression in appropriate patients?",
    sourceContextRequirement:
      "Before asking the ARAMIS question, retrieve NUBEQA HCP nmCRPC source context for ARAMIS. Include NUBEQA plus ADT versus ADT/placebo alone, metastasis-free survival as the primary endpoint, overall survival secondary endpoint when source-supported, time-to-pain or other secondary endpoint detail only if relevant, and caveats. Cite the source most likely to expose ARAMIS MFS and OS charts.",
    routeKeywords: [
      "aramis",
      "nmcrpc",
      "metastasis free",
      "metastasis-free",
      "mfs",
      "overall survival",
      "os",
      "psadt",
    ],
    completionSignals: ["reaction to ARAMIS evidence is stated"],
    adaptiveProbes: [
      "If negative: ask whether the concern is endpoint relevance, treatment burden, safety, cost/access, or patient selection.",
      "If positive: ask which nmCRPC patients would become higher priority for discussion.",
    ],
    analyzableOutputs: ["aramis_reaction", "nmcrpc_fit"],
  },
  {
    id: "patient_fit",
    module: "Adaptive probe",
    objective:
      "Understand where respondent sees appropriate use and caution across mCSPC and nmCRPC.",
    canonicalQuestion:
      "Which prostate cancer patient types seem like better fits for NUBEQA, and where would you be cautious?",
    sourceContextRequirement:
      "If the respondent has expressed a positive or negative view, answer with the most relevant source-supported patient-fit context before asking. Use disease state, docetaxel-fit, ADT backbone, safety/DDI, renal/hepatic dose modification, and guideline/resource context as applicable. Do not provide patient-specific treatment advice.",
    routeKeywords: [
      "patient",
      "fit",
      "eligible",
      "appropriate",
      "cautious",
      "avoid",
      "renal",
      "hepatic",
      "cardiac",
      "docetaxel",
      "older",
      "frail",
    ],
    completionSignals: ["patient fit and caution areas are stated"],
    adaptiveProbes: [
      "If only benefits are mentioned: ask what patient profile would still create caution.",
      "If only concerns are mentioned: ask whether ARANOTE, ARASENS, ARAMIS, safety, or dosing evidence would change that view.",
    ],
    analyzableOutputs: ["patient_fit", "caution_segments", "evidence_needed_to_change_view"],
  },
  {
    id: "safety_dosing",
    module: "Safety and dosing",
    objective:
      "Capture safety, DDI, and dosing feasibility barriers without turning into a label recital.",
    canonicalQuestion:
      "What safety, drug-interaction, or dosing issue would most affect your comfort with NUBEQA in practice?",
    sourceContextRequirement:
      "Before asking the safety/dosing question, provide a compact, source-grounded orientation to the specific safety, DDI, or dosing angle most relevant to the respondent's prior answer. Include ischemic heart disease and seizure warning only when relevant, adverse-reaction context from ARANOTE/ARASENS/ARAMIS when relevant, 600 mg twice-daily-with-food dosing, dose modification to 300 mg twice daily for supported renal/hepatic/toxicity contexts, and DDI considerations when relevant. Do not list the full label.",
    routeKeywords: [
      "safety",
      "tolerability",
      "adverse",
      "side effect",
      "dosing",
      "dose",
      "food",
      "twice daily",
      "drug interaction",
      "ddi",
      "renal",
      "hepatic",
      "ischemic",
      "seizure",
    ],
    completionSignals: ["safety, DDI, or dosing concern is stated"],
    adaptiveProbes: [
      "If safety concern is high: ask what monitoring, dose-modification, or comparative tolerability detail would reduce concern.",
      "If dosing concern is high: ask whether the issue is BID dosing, food requirement, adherence, renal/hepatic modification, or staff education.",
    ],
    analyzableOutputs: ["safety_dosing_barrier", "mitigation_need"],
  },
  {
    id: "guidelines_resources",
    module: "Guidelines and implementation",
    objective:
      "Understand whether guideline positioning and practice resources reduce adoption barriers.",
    canonicalQuestion:
      "Do guideline positioning, Bayer access support, or practice resources meaningfully change how feasible NUBEQA feels in your setting?",
    sourceContextRequirement:
      "Before asking the guidelines/resources question, retrieve NUBEQA HCP guideline and resource context. Include NCCN/AUA-style positioning only as source-supported, plus access/support or practice resources when relevant. Cite the source most likely to expose guideline treatment visual or practice-resource links.",
    routeKeywords: [
      "guideline",
      "guidelines",
      "nccn",
      "aua",
      "access",
      "support",
      "resources",
      "practice",
      "coverage",
      "formulary",
    ],
    completionSignals: ["reaction to guidelines or resources is stated"],
    adaptiveProbes: [
      "If positive: ask which resource would be most actionable.",
      "If negative: ask whether the barrier is evidence, access, workflow, patient education, or payer friction.",
    ],
    analyzableOutputs: ["guideline_impact", "resource_impact", "implementation_barrier"],
  },
  {
    id: "overall",
    module: "Synthesis",
    objective:
      "Capture overall perception and the most persuasive or limiting source point.",
    canonicalQuestion:
      "Thinking across mCSPC evidence, nmCRPC evidence, safety, dosing, and implementation, what is your overall perception of NUBEQA after reviewing this information?",
    sourceContextRequirement: null,
    routeKeywords: ["overall", "perception", "more likely", "less likely", "neutral"],
    completionSignals: ["overall perception is stated"],
    adaptiveProbes: [
      "If negative: ask what evidence or operational support would most likely change that view.",
      "If positive: ask where they would use that confidence first.",
    ],
    analyzableOutputs: ["overall_sentiment", "key_drivers", "remaining_barriers"],
  },
  {
    id: "close",
    module: "Close",
    objective: "Capture final strongest point, concern, and unanswered question.",
    canonicalQuestion:
      "To close, what is the strongest part of the NUBEQA clinical story, what is the biggest remaining concern or evidence gap, and what question would you still want answered?",
    sourceContextRequirement: null,
    routeKeywords: ["strongest", "concern", "gap", "question"],
    completionSignals: [
      "final strongest point, concern, and unanswered question are stated",
    ],
    adaptiveProbes: [],
    analyzableOutputs: [
      "strongest_story",
      "remaining_concern",
      "unanswered_question",
    ],
    close: true,
  },
] satisfies MvpGuideQuestion[];
