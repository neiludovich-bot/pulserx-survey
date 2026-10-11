import type { StructuredOption, StructuredSurvey } from "./types";

// Figures and numbers verified 2026-10-11 against nubeqahcp.com (efficacy and
// dosing pages). Card wording is pending Bayer medical/legal/regulatory review.
const HCP = "https://www.nubeqahcp.com";
const FILES = `${HCP}/sites/g/files/vrxlpx57896/files`;

/** One balanced reaction scale reused after every evidence card. */
export function reactionOptions(setting: string): StructuredOption[] {
  return [
    { id: "strongly_positive", label: `This is compelling, and it makes me more likely to use NUBEQA ${setting}.`, followUp: "Which patients would you think of first?" },
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
  maxDetoursPerQuestion: 1,
  rotationBlocks: [["c1_aranote", "c2_arasens", "c3_aramis"]],
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
      id: "a2_volume", section: "About you", kind: "single", exportLabel: "Monthly advanced prostate cancer patients",
      prompt: "About how many patients with advanced prostate cancer do you manage in a typical month?",
      options: [
        { id: "lt5", label: "Fewer than 5" }, { id: "5_15", label: "5 to 15" },
        { id: "16_30", label: "16 to 30" }, { id: "gt30", label: "More than 30" },
      ],
    },
    {
      id: "a3_experience", section: "About you", kind: "single", exportLabel: "NUBEQA experience",
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
      prompt: "Which comes closest to your reaction?",
      options: reactionOptions("in mCSPC without docetaxel"),
      card: {
        id: "aranote", title: "ARANOTE", subtitle: "mCSPC · NUBEQA + ADT vs placebo + ADT (no docetaxel)",
        body: "Primary endpoint: radiographic progression-free survival (rPFS). HR 0.54 (95% CI 0.41–0.71; P<0.0001), a 46% reduction in the risk of radiographic progression or death.",
        figures: [{ url: `${FILES}/2026-08/mcspc-aranote-chart.svg`, alt: "ARANOTE: risk of radiographic progression or death, NUBEQA + ADT vs ADT alone" }],
        sourceUrl: `${HCP}/efficacy/mcspc`, sourceLabel: "nubeqahcp.com · mCSPC efficacy",
      },
    },
    {
      id: "c2_arasens", section: "The evidence", kind: "single", exportLabel: "ARASENS reaction",
      prompt: "Which comes closest to your reaction?",
      options: reactionOptions("with docetaxel in mCSPC"),
      card: {
        id: "arasens", title: "ARASENS", subtitle: "mCSPC · NUBEQA + ADT + docetaxel vs placebo + ADT + docetaxel",
        body: "Primary endpoint: overall survival. HR 0.68 (95% CI 0.57–0.80; P<0.0001). Docetaxel 75 mg/m² every 21 days for 6 cycles in both arms.",
        figures: [{ url: `${FILES}/2026-08/mhspc-chart.svg`, alt: "ARASENS: risk of death, NUBEQA + docetaxel + ADT vs docetaxel + ADT" }],
        sourceUrl: `${HCP}/efficacy/mcspc`, sourceLabel: "nubeqahcp.com · mCSPC efficacy",
      },
    },
    {
      id: "c3_aramis", section: "The evidence", kind: "single", exportLabel: "ARAMIS reaction",
      prompt: "Which comes closest to your reaction?",
      options: reactionOptions("in nmCRPC"),
      card: {
        id: "aramis", title: "ARAMIS", subtitle: "nmCRPC · NUBEQA + ADT vs placebo + ADT",
        body: "Primary endpoint: metastasis-free survival, median 40.4 vs 18.4 months, HR 0.41 (95% CI 0.34–0.50; P<0.0001). Overall survival: HR 0.69 (95% CI 0.53–0.88; P=0.003).",
        figures: [
          { url: `${FILES}/2025-06/mfs-adt-alone.svg`, alt: "ARAMIS: probability of metastasis-free survival, NUBEQA + ADT vs ADT alone" },
          { url: `${FILES}/2025-06/nubeqa-adt-survival.svg`, alt: "ARAMIS: risk of death, NUBEQA + ADT vs ADT alone" },
        ],
        sourceUrl: `${HCP}/efficacy/nmcrpc`, sourceLabel: "nubeqahcp.com · nmCRPC efficacy",
      },
    },
    {
      id: "c4_most_relevant", section: "The evidence", kind: "single", optionsFollowRotation: true, exportLabel: "Most relevant trial",
      prompt: "Which of the three trials is most relevant to your practice?",
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
      prompt: "What, if anything, most affects your comfort using NUBEQA day to day?",
      followUp: "How would that change which patients you'd use it in?",
      card: {
        id: "dosing", title: "Dosing at a glance", subtitle: "All approved settings",
        body: "600 mg (two 300 mg tablets) twice daily with food, with a GnRH agonist or antagonist. Reduce to 300 mg twice daily for severe renal impairment (eGFR 15–29, not on dialysis), moderate hepatic impairment (Child-Pugh B), or Grade ≥3 toxicity. Avoid combined P-gp and strong or moderate CYP3A4 inducers; NUBEQA inhibits BCRP.",
        figures: [], sourceUrl: `${HCP}/dosing`, sourceLabel: "nubeqahcp.com · Dosing",
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
