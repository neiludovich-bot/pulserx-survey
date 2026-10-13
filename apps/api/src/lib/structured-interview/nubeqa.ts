import { figureById } from "./nubeqa-figures";
import type { EvidenceFigure, StructuredOption, StructuredSurvey } from "./types";

const figures = (...ids: string[]): EvidenceFigure[] => ids.map(id => { const { url, alt, caption } = figureById(id); return { url, alt, caption }; });

// Figures and numbers verified 2026-10-11 against nubeqahcp.com (efficacy and
// dosing pages). Card wording is pending Bayer medical/legal/regulatory review.
const HCP = "https://www.nubeqahcp.com";

/** One balanced reaction scale reused after every evidence card. */
export function reactionOptions(setting: string, positiveFollowUp: string): StructuredOption[] {
  return [
    { id: "strongly_positive", label: `This is compelling, and it makes me more likely to use NUBEQA ${setting}.`, followUp: positiveFollowUp },
    { id: "positive_reservations", label: "The data look good, but something holds me back from using it more.", followUp: "What is holding you back?" },
    { id: "no_change", label: "This is about what I expected, and it doesn't change how I treat.", followUp: "What would it take to change your approach here?" },
    { id: "concerns", label: "I have doubts about this data or how it applies to my patients.", followUp: "What is your main doubt?" },
  ];
}

export const NUBEQA_STRUCTURED_SURVEY: StructuredSurvey = {
  slug: "nubeqa",
  version: "nubeqa-structured-v1",
  brand: "NUBEQA",
  title: "NUBEQA HCP discussion",
  targetMinutes: 10,
  welcome: "Thank you for joining. This takes about 10 minutes. Tap an answer, or type or speak in your own words. You can ask me a question about NUBEQA at any point, and I'll answer from the official prescribing site before we continue.",
  closing: "Thank you. That's everything we needed, and your responses have been recorded. You can close this window.",
  declined: "No problem. Thank you for your time. You can close this window.",
  stopped: "Understood, we'll stop here. Thank you for your time; the answers you gave have been saved. You can close this window.",
  maxDetoursPerQuestion: 3,
  acknowledgments: ["Thank you.", "Got it.", "Thanks, that's helpful.", "Understood.", "Thanks for that."],
  rotationBlocks: [["c1_aranote", "c2_arasens", "c3_aramis"]],
  sectionLeads: {
    "About you": "Great, thank you. To start, a little about you.",
    "Reimbursement changes": "Thanks. A few questions now about upcoming reimbursement changes.",
    "Your practice": "Thanks. Now a couple of questions about your practice.",
    "What matters to you": "Before we look at any data, I'd like to understand what drives your choices.",
    "The evidence": "Before we go on, a quick orientation. NUBEQA, darolutamide, is an oral androgen receptor pathway inhibitor taken with ADT. It's approved for non-metastatic castration-resistant prostate cancer, and for metastatic castration-sensitive prostate cancer, either alone or with docetaxel. For comparison, Xtandi, enzalutamide, is also an oral ARPI taken with ADT; it's approved in nmCRPC and mCSPC, and additionally in mCRPC and high-risk biochemical recurrence. The two have not been compared in a head-to-head trial, and each has its own safety and drug-interaction profile; NUBEQA's warnings include ischemic heart disease and seizure. Now let's look at NUBEQA's own evidence. I'll walk you through three studies, one at a time, and for each one I'd like your honest reaction.",
    "Using it in practice": "Thanks. Next, a couple of questions about using it day to day.",
    "Overall": "We're nearly done.",
  },
  questions: [
    {
      id: "a0_consent", section: "Introduction", kind: "single", exportLabel: "Consent",
      prompt: "This is market research about NUBEQA (darolutamide). There are no right or wrong answers, and both positive and critical views are equally useful. Please don't share any patient-identifying information. OK to begin?",
      options: [{ id: "yes", label: "Yes, let's begin" }, { id: "no", label: "No, not now", ends: true }],
    },
    {
      id: "a1_specialty", section: "About you", kind: "single", exportLabel: "Specialty",
      prompt: "What is your primary specialty?",
      options: [
        { id: "medical_oncology", label: "Medical oncology" },
        { id: "urology", label: "Urology" },
        { id: "radiation_oncology", label: "Radiation oncology" },
        { id: "other", label: "Other", anchored: true, followUp: "Which specialty?" },
      ],
    },
    {
      id: "m1_mfp_aware", section: "Reimbursement changes", kind: "single", exportLabel: "Aware of Xtandi MFP change",
      prompt: "Are you familiar with Medicare's Maximum Fair Price (MFP) program and the reimbursement changes for Xtandi that begin January 1, 2027?",
      options: [
        { id: "yes_understand", label: "Yes, and I understand the impact on my practice" },
        { id: "heard", label: "I've heard of it but I'm not clear on the details" },
        { id: "new", label: "No, this is new to me" },
      ],
    },
    {
      id: "m2_mfp_plan", section: "Reimbursement changes", kind: "single", exportLabel: "Practice has an MFP plan",
      showIf: { questionId: "m1_mfp_aware", anyOf: ["yes_understand", "heard"] },
      prompt: "Does your practice have a plan to mitigate the impact of the Xtandi MFP change?",
      options: [
        { id: "yes", label: "Yes, we have a plan" },
        { id: "in_progress", label: "We're working on one" },
        { id: "no", label: "No" },
        { id: "unsure", label: "I'm not sure" },
      ],
    },
    {
      id: "m3_mfp_plan_detail", section: "Reimbursement changes", kind: "single", exportLabel: "MFP plan",
      showIf: { questionId: "m2_mfp_plan", anyOf: ["yes"] },
      prompt: "What is that plan?",
      options: [
        { id: "xtandi_no_change", label: "Continue to put new patients on Xtandi where appropriate, no changes" },
        { id: "other_arpi", label: "Put new patients on another ARPI where appropriate" },
        { id: "switch_existing", label: "Switch some existing patients off Xtandi" },
        { id: "other", label: "Something else", anchored: true, followUp: "What does the plan involve?" },
      ],
    },
    {
      id: "m4_alt_factors", section: "Reimbursement changes", kind: "rank", exportLabel: "Factors when choosing an alternative ARPI (ranked)",
      showIf: { questionId: "m2_mfp_plan", anyOf: ["yes"] },
      prompt: "Rank the factors you consider when choosing an alternative ARPI, most important first.",
      options: [
        { id: "clinical", label: "Clinical appropriateness" },
        { id: "ddi", label: "Drug-drug interactions" },
        { id: "pfs", label: "PFS" },
        { id: "os", label: "Overall survival" },
        { id: "financials", label: "Best overall financials" },
        { id: "contract", label: "Best financials and contract structure" },
      ],
    },
    {
      id: "a2_volume", section: "Your practice", kind: "single", exportLabel: "Monthly advanced prostate cancer patients",
      prompt: "About how many patients with advanced prostate cancer do you manage in a typical month?",
      options: [
        { id: "lt5", label: "Fewer than 5" }, { id: "5_15", label: "5 to 15" },
        { id: "16_30", label: "16 to 30" }, { id: "gt30", label: "More than 30" },
      ],
    },
    {
      id: "a3_experience", section: "Your practice", kind: "single", exportLabel: "NUBEQA experience",
      prompt: "Which best describes your experience with NUBEQA?",
      options: [
        { id: "regular", label: "I prescribe it regularly" },
        { id: "occasional", label: "I've prescribed it occasionally" },
        { id: "aware", label: "I know it but haven't prescribed it" },
        { id: "unfamiliar", label: "I'm not familiar with it" },
      ],
    },
    {
      id: "b1_drivers", section: "What matters to you", kind: "multi", maxSelect: 3, shuffleOptions: true, exportLabel: "Top decision factors",
      prompt: "When choosing an androgen receptor pathway inhibitor for an appropriate patient, which factors matter most to you? Pick up to 3.",
      followUp: "What makes that the deciding factor for you?", followUpOnlyIfSingleChoice: true,
      options: [
        { id: "os", label: "Overall survival benefit" },
        { id: "progression", label: "Delaying progression (rPFS or MFS)" },
        { id: "tolerability", label: "Tolerability and quality of life" },
        { id: "ddi", label: "Drug-interaction profile" },
        { id: "docetaxel_fit", label: "Fit with or without docetaxel" },
        { id: "guidelines", label: "Guideline positioning" },
        { id: "access", label: "Access and cost to the patient" },
        { id: "dosing", label: "Dosing convenience" },
        { id: "other", label: "Something else", anchored: true, followUp: "What else matters most to you?" },
      ],
    },
    {
      id: "c1_aranote", section: "The evidence", kind: "single", exportLabel: "ARANOTE reaction",
      transition: "ARANOTE, in metastatic castration-sensitive prostate cancer without docetaxel",
      intro: "The ARANOTE study enrolled 669 men with metastatic castration-sensitive prostate cancer who were not receiving docetaxel. Adding NUBEQA to ADT reduced the risk of radiographic progression or death by 46% compared with placebo plus ADT, a hazard ratio of 0.54. At two years, 70% were alive without radiographic progression, versus 52% with placebo.",
      prompt: "Which of these comes closest to your reaction?",
      options: reactionOptions("in mCSPC without docetaxel", "For which of your mCSPC patients who aren't getting docetaxel would this change what you prescribe?"),
      card: {
        id: "aranote", title: "ARANOTE", subtitle: "mCSPC · NUBEQA + ADT vs placebo + ADT (no docetaxel)",
        body: "Primary endpoint: radiographic progression-free survival (rPFS). HR 0.54 (95% CI 0.41–0.71; P<0.0001), a 46% reduction in the risk of radiographic progression or death.",
        figures: figures("aranote-rpfs", "aranote-design", "aranote-duration", "aranote-ae", "aranote-discontinuation"),
        context: [
          "Design: randomized 2:1, double-blind, phase III; 669 patients (446 NUBEQA, 223 placebo), all on ADT.",
          "Median rPFS was not reached with NUBEQA vs 25 months with placebo; median follow-up was about 25 months.",
          "At 24 months, 70.3% vs 52.1% were alive without radiological progression. This is a landmark analysis, which ignores events before 24 months.",
        ],
        sourceUrl: `${HCP}/efficacy/mcspc`, sourceLabel: "nubeqahcp.com · mCSPC efficacy",
      },
    },
    {
      id: "c2_arasens", section: "The evidence", kind: "single", exportLabel: "ARASENS reaction",
      transition: "ARASENS, in metastatic castration-sensitive prostate cancer with docetaxel",
      intro: "The ARASENS study looked at men with metastatic castration-sensitive prostate cancer who were also receiving docetaxel. Adding NUBEQA to docetaxel and ADT reduced the risk of death by nearly a third compared with docetaxel and ADT alone, a hazard ratio of 0.68. At four years, 63% of patients were alive with the NUBEQA combination, versus 50% without it.",
      prompt: "Which of these comes closest to your reaction?",
      options: reactionOptions("with docetaxel in mCSPC", "For which patients who are already getting docetaxel would you add NUBEQA, and who would you hold off on?"),
      card: {
        id: "arasens", title: "ARASENS", subtitle: "mCSPC · NUBEQA + ADT + docetaxel vs placebo + ADT + docetaxel",
        body: "Primary endpoint: overall survival. HR 0.68 (95% CI 0.57–0.80; P<0.0001). Docetaxel 75 mg/m² every 21 days for 6 cycles in both arms.",
        figures: figures("arasens-os", "arasens-4yr", "arasens-crpc", "arasens-secondary", "arasens-design", "arasens-ae"),
        context: [
          "Design: double-blind phase III; docetaxel was started within 6 weeks of NUBEQA or placebo, with ADT in both arms.",
          "At 4 years, 63% were alive with the NUBEQA combination vs 50% with docetaxel and ADT (landmark analysis).",
          "76% of patients in the control arm went on to receive a subsequent life-prolonging therapy.",
        ],
        sourceUrl: `${HCP}/efficacy/mcspc`, sourceLabel: "nubeqahcp.com · mCSPC efficacy",
      },
    },
    {
      id: "c3_aramis", section: "The evidence", kind: "single", exportLabel: "ARAMIS reaction",
      transition: "ARAMIS, in non-metastatic castration-resistant prostate cancer",
      intro: "The ARAMIS study enrolled men with non-metastatic castration-resistant prostate cancer. Adding NUBEQA to ADT extended median metastasis-free survival to 40.4 months, versus 18.4 months with placebo plus ADT, and reduced the risk of death by 31%, a hazard ratio of 0.69.",
      prompt: "Which of these comes closest to your reaction?",
      options: reactionOptions("in nmCRPC", "Which of your nmCRPC patients would you start sooner because of this, and what would you be watching for?"),
      card: {
        id: "aramis", title: "ARAMIS", subtitle: "nmCRPC · NUBEQA + ADT vs placebo + ADT",
        body: "Primary endpoint: metastasis-free survival, median 40.4 vs 18.4 months, HR 0.41 (95% CI 0.34–0.50; P<0.0001). Overall survival: HR 0.69 (95% CI 0.53–0.88; P=0.003).",
        figures: figures("aramis-mfs", "aramis-os", "aramis-pain", "aramis-chemo", "aramis-design", "aramis-ae"),
        context: [
          "Design: double-blind, placebo-controlled, international; 955 NUBEQA vs 554 placebo, all on ADT.",
          "Time to pain progression: HR 0.65 (95% CI 0.53–0.79). Time to cytotoxic chemotherapy: HR 0.58 (95% CI 0.44–0.76).",
          "The MFS benefit was consistent in patients with a PSA doubling time of 6 months or less and of more than 6 months.",
        ],
        sourceUrl: `${HCP}/efficacy/nmcrpc`, sourceLabel: "nubeqahcp.com · nmCRPC efficacy",
      },
    },
    {
      id: "c4_most_relevant", section: "The evidence", kind: "single", optionsFollowRotation: true, exportLabel: "Most relevant trial",
      intro: "You've now seen all three studies.",
      prompt: "Which of them is most relevant to your practice?",
      options: [
        { id: "aranote", label: "ARANOTE (mCSPC, no docetaxel)", ref: "c1_aranote" },
        { id: "arasens", label: "ARASENS (mCSPC, with docetaxel)", ref: "c2_arasens" },
        { id: "aramis", label: "ARAMIS (nmCRPC)", ref: "c3_aramis" },
        { id: "none", label: "None of them", anchored: true, followUp: "What would make one of them more relevant?" },
      ],
      followUp: "What makes that one most relevant for you?",
    },
    {
      id: "d1_practicality", section: "Using it in practice", kind: "single", shuffleOptions: true, exportLabel: "Biggest practical concern",
      intro: "NUBEQA is taken as two 300 mg tablets twice a day with food, alongside ADT. The dose is reduced for severe renal impairment, moderate hepatic impairment, or significant side effects, and some drug combinations need care.",
      prompt: "What, if anything, most affects your comfort using NUBEQA day to day?",
      followUp: "How would that change which patients you'd use it in?",
      card: {
        id: "dosing", title: "Dosing at a glance", subtitle: "All approved settings",
        body: "600 mg (two 300 mg tablets) twice daily with food, with a GnRH agonist or antagonist. Reduce to 300 mg twice daily for severe renal impairment (eGFR 15–29, not on dialysis), moderate hepatic impairment (Child-Pugh B), or Grade ≥3 toxicity. Avoid combined P-gp and strong or moderate CYP3A4 inducers; NUBEQA inhibits BCRP.",
        figures: figures("dosing-regimens", "ddi-overview", "ddi-anticoagulants"), context: [], sourceUrl: `${HCP}/dosing`, sourceLabel: "nubeqahcp.com · Dosing",
      },
      options: [
        { id: "ddi", label: "Drug interactions" },
        { id: "bid_food", label: "Twice-daily dosing with food" },
        { id: "side_effects", label: "Side effects" },
        { id: "organ_adjust", label: "Renal or hepatic dose adjustment" },
        { id: "nothing", label: "Nothing in particular", anchored: true, followUp: "What makes it straightforward in your practice?" },
        { id: "other", label: "Something else", anchored: true, followUp: "What is it?" },
      ],
    },
    {
      id: "d2_patient_fit", section: "Using it in practice", kind: "multi", shuffleOptions: true, exportLabel: "First-consideration patients",
      prompt: "For which patients would NUBEQA be your first consideration? Pick all that apply.",
      options: [
        { id: "mcspc_no_docetaxel", label: "mCSPC, not a docetaxel candidate" },
        { id: "mcspc_docetaxel", label: "mCSPC, fit for docetaxel" },
        { id: "nmcrpc", label: "nmCRPC with a short PSA doubling time" },
        { id: "polypharmacy", label: "Patients on several other medicines" },
        { id: "older_frail", label: "Older or frail patients" },
        { id: "none", label: "None of these", anchored: true, exclusive: true, followUp: "What keeps it from being a first choice?" },
      ],
    },
    {
      id: "e1_intent", section: "Overall", kind: "single", exportLabel: "Expected change in use (6 months)",
      prompt: "After this discussion, how do you expect your use of NUBEQA to change over the next 6 months?",
      followUp: "What is the main reason?",
      options: [
        { id: "increase_significantly", label: "Increase significantly" },
        { id: "increase_somewhat", label: "Increase somewhat" },
        { id: "same", label: "Stay the same" },
        { id: "decrease", label: "Decrease" },
      ],
    },
    {
      id: "e2_unlock", section: "Overall", kind: "single", shuffleOptions: true, exportLabel: "What would increase use",
      prompt: "What, if anything, would most increase your use of NUBEQA?",
      options: [
        { id: "longer_follow_up", label: "Longer follow-up data" },
        { id: "head_to_head", label: "Head-to-head data versus other ARPIs" },
        { id: "access", label: "Better access or coverage" },
        { id: "real_world", label: "Real-world tolerability data" },
        { id: "nothing", label: "Nothing, I'm already where I want to be", anchored: true },
        { id: "other", label: "Something else", anchored: true, followUp: "What would it be?" },
      ],
    },
    {
      id: "e3_open_questions", section: "Overall", kind: "single", exportLabel: "Remaining questions",
      prompt: "Is there anything you'd still like clarified about NUBEQA?",
      detourOnOptions: ["yes"], detourPrompt: "What would you like clarified?",
      options: [{ id: "no", label: "No, I'm all set" }, { id: "yes", label: "Yes, I have a question" }],
    },
  ],
};

export const STRUCTURED_SURVEYS: Partial<Record<StructuredSurvey["slug"], StructuredSurvey>> = {
  nubeqa: NUBEQA_STRUCTURED_SURVEY,
};
