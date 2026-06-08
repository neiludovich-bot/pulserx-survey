import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";

export const PADCEV_HCP_MVP_GUIDE = [
  {
    id: "intro_consent",
    module: "Introduction",
    objective: "Confirm permission and set neutral market research context.",
    canonicalQuestion:
      "Thank you for participating. We're conducting market research about PADCEV and how healthcare professionals react to clinical information about the drug. This is not a test of knowledge, and there are no right or wrong answers. Please don't include patient-identifying information. Is it okay to begin?",
    sourceContextRequirement: null,
    routeKeywords: [],
    completionSignals: ["respondent agrees to begin"],
    adaptiveProbes: [],
    analyzableOutputs: ["consent_to_begin"],
  },
  {
    id: "role",
    module: "Context",
    objective: "Understand respondent role so later probes can adapt.",
    canonicalQuestion: "What is your clinical role?",
    sourceContextRequirement: null,
    routeKeywords: ["physician", "oncologist", "urologist", "np", "pa", "pharmacist"],
    completionSignals: ["role or specialty is stated"],
    adaptiveProbes: [
      "If physician: What is your specialty?",
      "If NP/PA: What parts of care are you most involved in?",
      "If pharmacist: What parts of medication management or access are you most involved in?",
    ],
    analyzableOutputs: ["role", "specialty", "care_responsibility"],
  },
  {
    id: "practice_setting",
    module: "Context",
    objective: "Capture practice environment.",
    canonicalQuestion: "What type of practice setting do you work in?",
    sourceContextRequirement: null,
    routeKeywords: ["academic", "community", "hospital", "idn", "urology", "oncology"],
    completionSignals: ["practice setting is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["practice_setting"],
  },
  {
    id: "uc_involvement",
    module: "Context",
    objective: "Identify the respondent's urothelial cancer exposure.",
    canonicalQuestion:
      "Which urothelial cancer or bladder cancer patient populations do you personally treat, manage, counsel, monitor, or support?",
    sourceContextRequirement: null,
    routeKeywords: [
      "urothelial",
      "bladder",
      "locally advanced",
      "metastatic",
      "muc",
      "la/muc",
    ],
    completionSignals: ["urothelial or bladder cancer involvement is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["urothelial_cancer_involvement"],
  },
  {
    id: "patient_volume",
    module: "Context",
    objective: "Estimate respondent experience with relevant patients.",
    canonicalQuestion:
      "About how many locally advanced or metastatic urothelial cancer patients do you personally see or support in a typical month?",
    sourceContextRequirement: null,
    routeKeywords: ["patient", "patients", "month", "volume"],
    completionSignals: ["monthly patient count or range is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["monthly_lamuc_patient_volume"],
  },
  {
    id: "familiarity",
    module: "Baseline perception",
    objective: "Establish baseline familiarity with PADCEV.",
    canonicalQuestion:
      "How familiar are you with PADCEV today, either as monotherapy or in combination with pembrolizumab?",
    sourceContextRequirement: null,
    routeKeywords: ["familiar", "unfamiliar", "used", "heard", "pembrolizumab", "keytruda"],
    completionSignals: ["familiarity level is stated"],
    adaptiveProbes: [
      "If unfamiliar: What would you most want to understand first?",
      "If familiar: What part of the PADCEV story do you feel most up to date on?",
    ],
    analyzableOutputs: ["baseline_familiarity", "known_topics"],
  },
  {
    id: "decision_framework",
    module: "Baseline perception",
    objective: "Capture decision drivers before PADCEV-specific source context.",
    canonicalQuestion:
      "Before we get into PADCEV-specific information, when you evaluate systemic therapy options for an appropriate locally advanced or metastatic urothelial cancer patient, what are the top two or three factors that matter most?",
    sourceContextRequirement: null,
    routeKeywords: [
      "efficacy",
      "survival",
      "response",
      "safety",
      "neuropathy",
      "skin",
      "quality of life",
      "dosing",
      "guidelines",
    ],
    completionSignals: ["two or three decision factors are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["decision_drivers"],
  },
  {
    id: "indication_positioning",
    module: "Source reaction",
    objective: "Orient respondent to current PADCEV role and capture reaction.",
    canonicalQuestion:
      "Clinically, how does PADCEV's current role across first-line combination therapy and later-line monotherapy fit into your treatment framework?",
    sourceContextRequirement:
      "Before asking the PADCEV positioning question, retrieve and briefly summarize the current PADCEV HCP indication and role from approved source material. Include PADCEV plus pembrolizumab in adult patients with locally advanced or metastatic urothelial cancer, the monotherapy role after prior therapy when supported by source material, and any key source-supported limitations or safety framing. Do not provide patient-specific treatment advice.",
    routeKeywords: ["indication", "first line", "combination", "pembrolizumab", "monotherapy"],
    completionSignals: ["reaction to PADCEV positioning is stated"],
    adaptiveProbes: [
      "If positive: What makes that role most compelling?",
      "If neutral or negative: What prevents it from being more compelling?",
    ],
    analyzableOutputs: ["positioning_reaction", "role_in_framework"],
  },
  {
    id: "ev302",
    module: "Source reaction",
    objective: "Capture reaction to EV-302/KEYNOTE-A39 first-line evidence.",
    canonicalQuestion:
      "What stands out to you from the EV-302/KEYNOTE-A39 evidence, and how does it affect your view of PADCEV plus pembrolizumab in first-line locally advanced or metastatic urothelial cancer?",
    sourceContextRequirement:
      "Before asking the EV-302/KEYNOTE-A39 reaction question, retrieve and summarize the PADCEV HCP source context for the trial. Include setting/population, phase/design if supported, comparator or treatment arms, primary or key endpoints, concrete source-supported efficacy results, safety or discontinuation context when available, and caveats. If the source includes a chart, table, or study graphic, cite the source most likely to display it.",
    routeKeywords: ["ev-302", "keynote-a39", "overall survival", "progression free", "pfs", "os"],
    completionSignals: ["reaction to EV-302 evidence is stated"],
    adaptiveProbes: [
      "If skeptical: What evidence or patient subgroup detail would you need to feel more confident?",
      "If positive: Which result would most change your behavior?",
    ],
    analyzableOutputs: ["ev302_reaction", "first_line_evidence_driver"],
  },
  {
    id: "patient_fit",
    module: "Adaptive probe",
    objective: "Understand where the respondent sees PADCEV fit and caution.",
    canonicalQuestion:
      "For which locally advanced or metastatic urothelial cancer patient types, if any, would the PADCEV evidence make treatment more attractive, and where would you be cautious?",
    sourceContextRequirement:
      "Before asking the patient-fit question, answer any source-specific patient population, subgroup, inclusion/exclusion, or risk-factor detail the participant has raised using only approved PADCEV HCP source material. Include limitations if the source does not provide the requested subgroup detail.",
    routeKeywords: ["patient", "fit", "eligible", "cisplatin", "renal", "neuropathy", "diabetes", "skin"],
    completionSignals: ["patient types and caution areas are stated"],
    adaptiveProbes: [
      "If only benefits are mentioned: What patient profile would still make you cautious?",
      "If only concerns are mentioned: Is there any patient type where the profile still feels compelling?",
    ],
    analyzableOutputs: ["patient_fit", "caution_segments"],
  },
  {
    id: "monotherapy_evidence",
    module: "Source reaction",
    objective: "Capture reaction to PADCEV monotherapy evidence after prior therapy.",
    canonicalQuestion:
      "How do the later-line PADCEV monotherapy data affect your view of PADCEV after prior therapy?",
    sourceContextRequirement:
      "Before asking the monotherapy question, retrieve and briefly summarize PADCEV HCP source material on later-line monotherapy evidence, including EV-301 and EV-201 when supported. Include population/prior therapy context, design/comparator or cohort, concrete outcomes if available, and relevant caveats.",
    routeKeywords: ["monotherapy", "ev-301", "ev-201", "later line", "post platinum", "pd-1", "pd-l1"],
    completionSignals: ["reaction to monotherapy evidence is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["monotherapy_reaction", "later_line_role"],
  },
  {
    id: "safety",
    module: "Source reaction",
    objective: "Capture safety and tolerability barriers.",
    canonicalQuestion:
      "Which safety or tolerability details most influence how comfortable you would be using or supporting PADCEV?",
    sourceContextRequirement:
      "Before asking the safety/tolerability question, summarize the most relevant PADCEV HCP Important Safety Information and safety topics. Include source-supported warnings and precautions such as serious skin reactions including SJS/TEN, hyperglycemia, pneumonitis/ILD, peripheral neuropathy, ocular disorders, infusion site extravasation, embryo-fetal toxicity, common adverse reactions or labs when available, and dose-modification framing. Keep it concise and non-patient-specific.",
    routeKeywords: ["safety", "skin", "sjs", "ten", "hyperglycemia", "neuropathy", "pneumonitis", "ocular"],
    completionSignals: ["safety concerns or comfort drivers are stated"],
    adaptiveProbes: [
      "If concern is high: What mitigation, monitoring, or evidence would reduce that concern?",
      "If concern is low: Which safety issue would still require the most counseling or monitoring?",
    ],
    analyzableOutputs: ["safety_drivers", "barriers"],
  },
  {
    id: "dosing_admin",
    module: "Implementation",
    objective: "Understand operational feasibility.",
    canonicalQuestion:
      "From an operational perspective, how does the PADCEV dosing and administration profile affect real-world feasibility?",
    sourceContextRequirement:
      "Before asking the dosing/administration question, retrieve and summarize PADCEV HCP dosing and administration source material or dosing guide details, including schedule, weight-based dosing or dose caps, combination vs monotherapy schedule differences, dose modification, and operational considerations only when supported by the source.",
    routeKeywords: ["dose", "dosing", "administration", "schedule", "infusion", "day 1", "day 8"],
    completionSignals: ["operational reaction is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["dosing_feasibility", "implementation_barriers"],
  },
  {
    id: "support_barriers",
    module: "Implementation",
    objective: "Identify practical adoption barriers.",
    canonicalQuestion:
      "What practical barriers would most affect implementation: toxicity monitoring, infusion scheduling, patient education, coordination with pembrolizumab, access, or something else?",
    sourceContextRequirement:
      "Before asking the practical barriers question, retrieve PADCEV HCP source material on support resources, patient materials, dosing resources, or access resources if available. If no meaningful support resource detail is available in the source, say that briefly and ask the question without inventing programs.",
    routeKeywords: ["barrier", "monitoring", "scheduling", "education", "access", "support"],
    completionSignals: ["implementation barriers are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["implementation_barriers", "support_needs"],
  },
  {
    id: "overall",
    module: "Synthesis",
    objective: "Capture overall perception after source context.",
    canonicalQuestion:
      "Thinking across efficacy, safety, patient fit, dosing/administration, and implementation, what is your overall perception of PADCEV after reviewing this information?",
    sourceContextRequirement: null,
    routeKeywords: ["overall", "perception", "more likely", "less likely", "neutral"],
    completionSignals: ["overall perception is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["overall_sentiment", "key_drivers"],
  },
  {
    id: "close",
    module: "Close",
    objective: "Capture final strongest point, concern, and unanswered question.",
    canonicalQuestion:
      "To close, what is the strongest part of the PADCEV clinical story, what is the biggest remaining concern or evidence gap, and what question would you still want answered?",
    sourceContextRequirement: null,
    routeKeywords: ["strongest", "concern", "gap", "question"],
    completionSignals: ["final strongest point, concern, and unanswered question are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["strongest_story", "remaining_concern", "unanswered_question"],
    close: true,
  },
] satisfies MvpGuideQuestion[];
