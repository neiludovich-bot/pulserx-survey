import type { GroundedReference } from "@interview/schemas";

export type MvpGuideQuestion = {
  id: string;
  module: string;
  objective: string;
  canonicalQuestion: string;
  sourceContextRequirement: string | null;
  routeKeywords: string[];
  completionSignals: string[];
  adaptiveProbes: string[];
  analyzableOutputs: string[];
  close?: boolean;
  surfacedReferences?: GroundedReference[];
};

export function guideFromQuestionStrings(questions: string[]) {
  return questions.map((question, index) => ({
    id: `imported_${index + 1}`,
    module: "Imported guide",
    objective: "Ask the imported survey question.",
    canonicalQuestion: question,
    sourceContextRequirement: null,
    routeKeywords: [],
    completionSignals: ["respondent provides an answer"],
    adaptiveProbes: [],
    analyzableOutputs: [],
  })) satisfies MvpGuideQuestion[];
}

export const BRUKINSA_HCP_MVP_GUIDE = [
  {
    id: "intro_consent",
    module: "Introduction",
    objective: "Confirm permission and set neutral market research context.",
    canonicalQuestion:
      "Thank you for participating. We're conducting market research about BRUKINSA and how healthcare professionals react to clinical information about the drug. This is not a test of knowledge, and there are no right or wrong answers. Please don't include patient-identifying information. Is it okay to begin?",
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
    routeKeywords: ["physician", "oncologist", "hematologist", "np", "pa", "pharmacist"],
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
    routeKeywords: ["academic", "community", "hospital", "idn", "specialty pharmacy"],
    completionSignals: ["practice setting is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["practice_setting"],
  },
  {
    id: "disease_involvement",
    module: "Context",
    objective: "Identify disease areas the respondent treats, manages, counsels, monitors, or supports.",
    canonicalQuestion:
      "Which B-cell malignancies do you personally treat, manage, counsel, monitor, or support?",
    sourceContextRequirement: null,
    routeKeywords: ["cll", "sll", "wm", "waldenstrom", "mcl", "mzl", "fl", "follicular"],
    completionSignals: ["one or more disease areas are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["disease_areas"],
  },
  {
    id: "primary_disease_focus",
    module: "Context",
    objective: "Choose the first disease route.",
    canonicalQuestion: "Which of those disease areas is most central to your day-to-day practice?",
    sourceContextRequirement: null,
    routeKeywords: ["cll", "sll", "wm", "waldenstrom", "mcl", "mzl", "fl", "follicular"],
    completionSignals: ["primary disease focus is stated"],
    adaptiveProbes: [
      "If multiple or unclear: Which disease area would be most useful to focus on first for this discussion?",
    ],
    analyzableOutputs: ["primary_disease_focus"],
  },
  {
    id: "patient_volume",
    module: "Context",
    objective: "Estimate exposure to the primary disease area.",
    canonicalQuestion:
      "About how many patients in that primary disease area do you personally see or support in a typical month?",
    sourceContextRequirement: null,
    routeKeywords: ["patients", "month", "volume"],
    completionSignals: ["patient volume range is stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["primary_disease_patient_volume"],
  },
  {
    id: "familiarity",
    module: "Context",
    objective: "Capture baseline BRUKINSA familiarity and prior exposure.",
    canonicalQuestion: "How familiar are you with BRUKINSA today?",
    sourceContextRequirement: null,
    routeKeywords: ["familiar", "aware", "used", "prescribe", "recommend", "support"],
    completionSignals: ["familiarity level or usage experience is stated"],
    adaptiveProbes: [
      "If current/regular user: What has most shaped your view of BRUKINSA so far?",
      "If occasional user: What types of patients or situations tend to bring BRUKINSA to mind?",
      "If aware non-user: What has kept BRUKINSA from being more prominent in your thinking?",
      "If low familiarity: What would you need to understand first: efficacy, safety, patient fit, dosing, guidelines, or access?",
    ],
    analyzableOutputs: ["brukinsa_familiarity", "baseline_driver", "baseline_barrier"],
  },
  {
    id: "btki_decision_framework",
    module: "Baseline BTKi Decision Framework",
    objective: "Understand how the respondent evaluates BTK inhibitors before BRUKINSA-specific material.",
    canonicalQuestion:
      "Before we get into BRUKINSA-specific information, when you evaluate or support use of a BTK inhibitor for an appropriate patient, what are the top two or three factors that matter most?",
    sourceContextRequirement: null,
    routeKeywords: ["efficacy", "safety", "patient fit", "dosing", "guidelines", "access", "pfs", "orr"],
    completionSignals: ["two or three decision factors are stated"],
    adaptiveProbes: [
      "If efficacy: What kind of efficacy evidence matters most?",
      "If safety: Which safety concerns matter most?",
      "If patient fit: What patient factors most affect BTKi choice?",
      "If practical/logistical: What practical issues matter most?",
    ],
    analyzableOutputs: ["btki_decision_factors", "evidence_preferences", "safety_priorities"],
  },
  {
    id: "breadth",
    module: "BRUKINSA Breadth",
    objective: "Test reaction to breadth across five B-cell malignancies and accelerated approval caveats.",
    canonicalQuestion:
      "Clinically, what does BRUKINSA's breadth across five B-cell malignancies suggest to you about the drug?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA HCP homepage or indication section. Include that BRUKINSA is presented as approved across CLL/SLL, WM, MCL, MZL, and FL, and include the accelerated approval caveats for MCL, MZL, and FL when supported by the source.",
    routeKeywords: ["breadth", "indications", "approved", "five", "mcl", "mzl", "fl", "accelerated approval"],
    completionSignals: ["reaction to breadth or caveats is stated"],
    adaptiveProbes: [
      "If positive: Does the breadth make BRUKINSA feel more established, more familiar across diseases, or more useful in practice?",
      "If skeptical: Do you need disease-specific evidence before the breadth message matters?",
      "If mixed: Which part of the breadth story is meaningful, and which part needs proof?",
    ],
    analyzableOutputs: ["breadth_reaction", "accelerated_approval_reaction"],
  },
  {
    id: "evidence_overview",
    module: "Evidence Overview",
    objective:
      "Answer a broad HCP evidence request with concrete study highlights before routing into disease-specific evidence.",
    canonicalQuestion:
      "Which part of this evidence is most relevant to your view: CLL/SLL SEQUOIA first-line data, CLL/SLL ALPINE head-to-head data, MCL/MZL/FL response-focused data, safety/tolerability, or something else?",
    sourceContextRequirement:
      "The respondent is asking what the data show. Do not give a vague brand story or website outline. Retrieve and summarize concrete BRUKINSA HCP evidence highlights for the disease areas already mentioned by the respondent, and include CLL/SLL SEQUOIA and ALPINE highlights when CLL/SLL is relevant. For each relevant study, include study name, setting/population, design/comparator or cohorts, endpoint(s), key source-supported numeric result(s), safety/tolerability context if relevant, and caveats such as accelerated approval or exploratory/descriptive analyses. If the respondent mentioned MCL, include response-focused MCL evidence and accelerated approval caveat if supported by the source.",
    routeKeywords: [
      "data",
      "evidence",
      "results",
      "study",
      "study details",
      "clinical trial",
      "what does the data show",
      "what does the evidence show",
    ],
    completionSignals: ["reaction to concrete evidence overview is stated"],
    adaptiveProbes: [
      "Which study or disease setting is most important to go deeper on?",
      "What evidence detail is most persuasive or still missing?",
    ],
    analyzableOutputs: [
      "evidence_overview_reaction",
      "highest_priority_evidence_area",
      "evidence_gap",
    ],
  },
  {
    id: "cll_baseline_perception",
    module: "CLL/SLL Primary Route",
    objective: "Establish current perception in CLL/SLL before evidence review.",
    canonicalQuestion:
      "Before reviewing the BRUKINSA CLL/SLL information, what is your current perception of BRUKINSA in CLL/SLL?",
    sourceContextRequirement: null,
    routeKeywords: ["cll", "sll", "first line", "frontline", "treatment naive", "relapsed", "refractory"],
    completionSignals: ["baseline CLL/SLL perception is stated"],
    adaptiveProbes: [
      "If positive: What has shaped that positive view?",
      "If negative: What is the main concern or barrier?",
      "If mixed: What is positive, and what still gives you pause?",
      "If unfamiliar: What would you need to understand first?",
    ],
    analyzableOutputs: ["cll_baseline_perception", "cll_baseline_driver", "cll_barrier"],
  },
  {
    id: "cll_orientation",
    module: "CLL/SLL Evidence Orientation",
    objective: "Orient to the CLL/SLL story and choose the highest-value evidence path.",
    canonicalQuestion:
      "Based on that high-level CLL/SLL story, what part matters most for your view of BRUKINSA: first-line efficacy, relapsed/refractory head-to-head data, safety/tolerability, patient fit, dosing, or guidelines?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA CLL/SLL main page and efficacy page. Include the CLL/SLL positioning, SEQUOIA as the first-line CLL/SLL evidence anchor, ALPINE as the relapsed/refractory head-to-head evidence anchor, and note that the section also covers safety/tolerability, NCCN preferred positioning, dosing, and resources if supported by the source.",
    routeKeywords: ["cll", "sll", "sequoia", "alpine", "guidelines", "nccn", "safety", "dosing"],
    completionSignals: ["priority CLL/SLL topic is stated"],
    adaptiveProbes: [
      "If evidence: move into the evidence.",
      "If safety: capture it, then cover efficacy anchors before safety.",
      "If dosing/practical: capture it and return after efficacy and safety.",
    ],
    analyzableOutputs: ["cll_priority_topic"],
  },
  {
    id: "cll_guideline_positioning",
    module: "CLL/SLL - Guideline Positioning",
    objective: "Understand how CLL/SLL guideline positioning affects interest and confidence.",
    canonicalQuestion:
      "How, if at all, does the NCCN or guideline positioning affect your willingness to consider BRUKINSA in CLL/SLL?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA HCP CLL/SLL guideline or NCCN positioning context. Include only source-supported wording, category/preferred status, and caveats. If the source only supports a high-level NCCN preferred-positioning statement, state that plainly and do not invent additional guideline detail.",
    routeKeywords: [
      "guidelines",
      "guideline",
      "nccn",
      "preferred",
      "category",
      "recommendation",
      "positioning",
    ],
    completionSignals: ["reaction to CLL/SLL guideline positioning is stated"],
    adaptiveProbes: [
      "If positive: Does guideline positioning affect confidence, adoption, or patient selection?",
      "If skeptical: What exact guideline detail or external validation would be needed?",
      "If neutral: What matters more than guideline positioning?",
    ],
    analyzableOutputs: [
      "cll_guideline_reaction",
      "guideline_driver",
      "guideline_gap",
    ],
  },
  {
    id: "sequoia",
    module: "CLL/SLL - SEQUOIA First-Line Efficacy",
    objective: "Understand reaction to first-line CLL/SLL evidence.",
    canonicalQuestion:
      "How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA CLL/SLL efficacy page, SEQUOIA section. Include trial design, treatment-naive CLL/SLL setting, Cohort 1 BRUKINSA versus bendamustine plus rituximab in patients without del(17p), Cohort 2 BRUKINSA-only del(17p) context if available, primary endpoint PFS by IRC in the ITT population, current key PFS result, longer-term results if current on site, and exploratory/descriptive caveats.",
    routeKeywords: [
      "sequoia",
      "frontline",
      "first line",
      "1l",
      "treatment naive",
      "pfs",
      "overall survival",
      "os",
      "survival",
      "del17p",
      "tp53",
      "data",
      "evidence",
      "results",
      "study",
      "study details",
      "what does the data show",
    ],
    completionSignals: ["reaction to SEQUOIA is stated"],
    adaptiveProbes: [
      "If positive: What most drives confidence: PFS, Phase 3 design, follow-up, del(17p)/TP53 information, or consistency across subgroups?",
      "If skeptical: What limits confidence: comparator relevance, open-label design, patient population, del(17p) cohort design, or need for a different comparator?",
      "If mixed: What part supports consideration, and what still needs more context?",
    ],
    analyzableOutputs: ["sequoia_reaction", "first_line_evidence_driver", "sequoia_concern"],
  },
  {
    id: "sequoia_patient_fit",
    module: "CLL/SLL - SEQUOIA Patient Fit",
    objective: "Tie first-line evidence to patient types.",
    canonicalQuestion:
      "For which first-line CLL/SLL patient types, if any, would this evidence make BRUKINSA more attractive?",
    sourceContextRequirement:
      "Use the SEQUOIA context already retrieved. If needed, briefly restate source-supported setting, patient population, and caveats before asking about patient fit.",
    routeKeywords: [
      "patient type",
      "patient population",
      "appropriate patient",
      "inclusion",
      "exclusion",
      "gene mutation",
      "mutation",
      "older",
      "comorbid",
      "high risk",
      "side effect",
      "cardiac",
      "del17p",
      "tp53",
      "frontline",
    ],
    completionSignals: ["patient type or lack of fit is stated"],
    adaptiveProbes: [
      "If older/comorbid: What comorbidity considerations matter most?",
      "If del(17p)/TP53: What would you need to know to feel confident in that subgroup?",
      "If cardiac risk: Should we look at the cardiac/safety data next?",
    ],
    analyzableOutputs: ["first_line_patient_fit", "patient_fit_caveat"],
  },
  {
    id: "alpine",
    module: "CLL/SLL - ALPINE Relapsed/Refractory Efficacy",
    objective: "Understand reaction to relapsed/refractory head-to-head evidence.",
    canonicalQuestion:
      "How does the ALPINE head-to-head evidence affect your view of BRUKINSA relative to ibrutinib or other BTK inhibitors?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA CLL/SLL efficacy page, ALPINE section. Include global Phase 3 randomized open-label R/R CLL/SLL setting after at least one prior systemic therapy, BRUKINSA versus ibrutinib comparison, ORR primary endpoint assessed for noninferiority, PFS key secondary endpoint, superiority testing after noninferiority, current key PFS and ORR information, and longer-term/subgroup caveats where applicable.",
    routeKeywords: ["alpine", "ibrutinib", "head to head", "relapsed", "refractory", "orr", "pfs", "comparative"],
    completionSignals: ["reaction to ALPINE or comparative evidence is stated"],
    adaptiveProbes: [
      "If positive: What matters most: the head-to-head design, ibrutinib comparator, PFS, ORR, follow-up, or relevance to R/R patients?",
      "If skeptical: What additional context would you need before this would influence BTKi choice?",
      "If mixed: Does the head-to-head evidence move BRUKINSA up in your thinking, or does patient-specific safety still dominate?",
    ],
    analyzableOutputs: ["alpine_reaction", "comparative_confidence", "alpine_concern"],
  },
  {
    id: "cll_safety_tolerability",
    module: "CLL/SLL - Safety and Tolerability",
    objective: "Capture reaction to CLL/SLL safety/tolerability claims and risk-benefit impact.",
    canonicalQuestion:
      "How does the CLL/SLL safety and tolerability information affect your risk-benefit view of BRUKINSA?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA CLL/SLL safety page, tolerability page, and Important Safety Information. Include source-supported CLL/SLL safety/tolerability framing, low AFib/flutter and discontinuation context if current, and broader risks including hemorrhage, infections, cytopenias, second primary malignancies, cardiac arrhythmias, hepatotoxicity including DILI, embryo-fetal toxicity, drug interactions, and common adverse reactions/lab abnormalities.",
    routeKeywords: ["safety", "tolerability", "afib", "flutter", "cardiac", "bleeding", "hemorrhage", "infection", "cytopenia", "discontinuation"],
    completionSignals: ["risk-benefit reaction is stated"],
    adaptiveProbes: [
      "If favorable: Which safety element is most persuasive?",
      "If concerned: Which risk would most limit use?",
      "If mixed: What is manageable, and what remains a barrier?",
    ],
    analyzableOutputs: ["cll_safety_reaction", "safety_driver", "safety_barrier"],
  },
  {
    id: "wm_aspen",
    module: "WM Primary Route",
    objective: "Understand reaction to WM evidence when WM is relevant.",
    canonicalQuestion:
      "How does the WM evidence story affect your perception of BRUKINSA for appropriate patients with Waldenstrom macroglobulinemia?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA WM pages. Include ASPEN head-to-head BTKi framing, relevant efficacy and safety context, NCCN or positioning details if supported, and caveats needed for fair interpretation.",
    routeKeywords: ["wm", "waldenstrom", "aspen"],
    completionSignals: ["reaction to WM evidence is stated"],
    adaptiveProbes: [
      "What part matters most: head-to-head framing, response data, tolerability, or guideline positioning?",
    ],
    analyzableOutputs: ["wm_reaction", "wm_evidence_driver"],
  },
  {
    id: "accelerated_approval_indolent",
    module: "MCL/MZL/FL Routes",
    objective: "Understand how response-focused evidence and accelerated approval caveats affect perception.",
    canonicalQuestion:
      "How do the response-focused evidence and accelerated approval caveats in MCL, MZL, or FL affect your perception of BRUKINSA in those settings?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA MCL, MZL, and/or FL page most relevant to the respondent. Include disease-specific indication, response-focused evidence, line-of-therapy context, and accelerated approval caveat if supported by the source.",
    routeKeywords: ["mcl", "mzl", "fl", "follicular", "rosewood", "magnolia", "accelerated approval", "response rate"],
    completionSignals: ["reaction to response-focused evidence or caveats is stated"],
    adaptiveProbes: [
      "What evidence would reduce concern: durability, confirmatory data, PFS, OS, safety, or sequencing information?",
      "Which of MCL, MZL, or FL is most affected by the caveat in your view?",
    ],
    analyzableOutputs: ["accelerated_approval_concern", "noncll_evidence_reaction"],
  },
  {
    id: "general_safety_isi",
    module: "General Safety / ISI",
    objective: "Capture which broader safety issue affects selection or monitoring most.",
    canonicalQuestion:
      "Which safety issue would most affect patient selection or monitoring in your practice?",
    sourceContextRequirement:
      "Retrieve and summarize the current Important Safety Information from the relevant BRUKINSA HCP page. Include hemorrhage and bleeding risk with antiplatelet/anticoagulant medications, infections including HBV reactivation if present, cytopenias, second primary malignancies, cardiac arrhythmias including AFib/flutter, hepatotoxicity including DILI, embryo-fetal toxicity, common adverse reactions/lab abnormalities, drug interactions, and hepatic impairment guidance where relevant.",
    routeKeywords: ["safety", "isi", "bleeding", "anticoagulant", "infection", "cytopenia", "cardiac", "hepatotoxicity", "dili"],
    completionSignals: ["most important safety issue is stated"],
    adaptiveProbes: ["What makes that safety issue most important?"],
    analyzableOutputs: ["most_important_safety_issue", "safety_monitoring_concern"],
  },
  {
    id: "dosing_formulation",
    module: "Dosing / Formulation / Dose Modification",
    objective: "Understand reaction to real-world dosing and formulation profile.",
    canonicalQuestion:
      "From a real-world practice perspective, how does the dosing and formulation profile affect your view of BRUKINSA?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA dosing page. Include tablet formulation, 160 mg twice daily or 320 mg once daily dosing if current, scored tablets, dose reduction by reducing tablet count, no dose exchanges for dose reductions, dosing with or without food, missed-dose guidance, continuation until progression or unacceptable toxicity, and dose-modification guidance.",
    routeKeywords: ["dosing", "tablet", "bid", "qd", "dose modification", "scored", "food", "pill burden"],
    completionSignals: ["dosing/formulation reaction is stated"],
    adaptiveProbes: [
      "If positive: What makes it practical?",
      "If negative: What practical issue remains?",
      "If pharmacist: Does the no-dose-exchange approach reduce dispensing or refill friction?",
      "If NP/PA: Would this make patient counseling easier or more complicated?",
    ],
    analyzableOutputs: ["dosing_reaction", "formulation_driver", "practical_barrier"],
  },
  {
    id: "medication_management",
    module: "Medication Management / Comorbidities",
    objective: "Assess fit with comorbidities, interactions, and medication-management workflow.",
    canonicalQuestion:
      "How well does this medication-management profile fit the kinds of patients you see or support?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA dosing page and ISI drug-interaction sections. Include gastric acid reducing agents, anticoagulant/antiplatelet information and hemorrhage monitoring, CYP3A inhibitor/inducer guidance, severe hepatic impairment dosing, surgery/bleeding considerations if shown, and relevant safety caveats.",
    routeKeywords: ["cyp3a", "anticoagulant", "antiplatelet", "acid reducer", "ppi", "hepatic", "drug interaction", "comorbid"],
    completionSignals: ["medication-management fit or concern is stated"],
    adaptiveProbes: [
      "Which part is most useful: acid reducers, anticoagulation/antiplatelet guidance, CYP3A guidance, hepatic impairment dosing, or dose modification?",
      "Which issue creates the most caution?",
    ],
    analyzableOutputs: ["medication_management_fit", "interaction_concern", "comorbidity_caution"],
  },
  {
    id: "patient_fit",
    module: "Patient Fit",
    objective: "Synthesize evidence, safety, dosing, and management into patient-fit perception.",
    canonicalQuestion:
      "For which patient types does BRUKINSA seem most attractive, and for which patient types would you be more cautious?",
    sourceContextRequirement:
      "Briefly synthesize the efficacy, safety/tolerability, dosing, and medication-management information already discussed, then ask about patient fit. Do not introduce new claims unless supported by the approved source.",
    routeKeywords: ["patient fit", "patient type", "older", "comorbid", "cardiac", "anticoagulated", "prior intolerance"],
    completionSignals: ["attractive and cautious patient types are stated"],
    adaptiveProbes: [
      "If cardiac-risk patients: What information most drives that view?",
      "If anticoagulated patients: What would you want to know before feeling comfortable?",
      "If no patient type: What evidence would help define the best-fit patient?",
    ],
    analyzableOutputs: ["attractive_patient_types", "caution_patient_types", "patient_fit_driver"],
  },
  {
    id: "support_resources",
    module: "Support and Resources",
    objective: "Understand whether resources remove real-world barriers.",
    canonicalQuestion:
      "Would these support resources remove any real-world barrier to using or supporting BRUKINSA, or would access and logistics remain a concern?",
    sourceContextRequirement:
      "Retrieve and summarize the current BRUKINSA resources page and myBeOne Support references. Include access support, patient education, dosing/admin materials, patient management guide, patient brochures, support brochures, specialty pharmacy/distributor information, enrollment materials, PI/ISI, videos, contact-a-rep if relevant, and caveats that support is not insurance and does not guarantee coverage/reimbursement where shown.",
    routeKeywords: ["support", "access", "mybeone", "resources", "brochure", "specialty pharmacy", "enrollment", "patient education"],
    completionSignals: ["support/resource value or remaining barrier is stated"],
    adaptiveProbes: [
      "Which resource would make the most difference?",
      "If not useful: What barrier remains unresolved?",
      "If NP/PA: Would these materials help with education, monitoring, or follow-up?",
      "If pharmacist: Would they help with counseling, fulfillment, or specialty pharmacy coordination?",
    ],
    analyzableOutputs: ["support_resource_reaction", "resource_value_driver", "access_barrier"],
  },
  {
    id: "overall_perception",
    module: "Overall Drug Perception",
    objective: "Capture final overall perception after reviewing information.",
    canonicalQuestion:
      "Thinking across the clinical evidence, safety and tolerability, disease indications, dosing, medication-management information, patient fit, and support resources, what is your overall perception of BRUKINSA after reviewing this information?",
    sourceContextRequirement: null,
    routeKeywords: ["overall", "perception", "summary", "positive", "negative", "neutral", "mixed"],
    completionSignals: ["overall perception and sentiment are stated"],
    adaptiveProbes: [
      "If positive: What are the top two reasons your perception is positive?",
      "If negative: What are the top two barriers or concerns?",
      "If mixed: What is the strongest positive and the strongest concern?",
      "If not enough information: What specific information is missing?",
    ],
    analyzableOutputs: ["overall_perception", "sentiment", "top_positive_drivers", "top_barriers"],
  },
  {
    id: "behavioral_implication",
    module: "Overall Drug Perception",
    objective: "Capture likely action or no-action implication.",
    canonicalQuestion:
      "What action, if any, would you be more likely to take after reviewing this information?",
    sourceContextRequirement: null,
    routeKeywords: ["action", "consider", "use", "recommend", "support", "rep", "pi", "information", "no change"],
    completionSignals: ["likely action or no change is stated"],
    adaptiveProbes: ["What is the main reason for that action or lack of action?"],
    analyzableOutputs: ["likely_behavioral_implication", "action_rationale"],
  },
  {
    id: "close",
    module: "Closing",
    objective: "Close with strongest positive, biggest concern, and remaining question.",
    canonicalQuestion:
      "To close, what is the strongest part of the BRUKINSA clinical story, what is the biggest remaining concern or evidence gap, and what question would you still want answered?",
    sourceContextRequirement: null,
    routeKeywords: ["close", "concern", "gap", "question", "strongest"],
    completionSignals: ["strongest positive, concern/gap, and remaining question are stated"],
    adaptiveProbes: [],
    analyzableOutputs: ["strongest_story_element", "biggest_remaining_concern", "remaining_question"],
    close: true,
  },
] satisfies MvpGuideQuestion[];
