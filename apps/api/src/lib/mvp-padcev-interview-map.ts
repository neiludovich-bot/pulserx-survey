export type PadcevInterviewBranchKey =
  | "ev302_source_excursion"
  | "safety_management_workflow"
  | "safety_patient_caution"
  | "safety_resources"
  | "implementation_barriers";

type PadcevInterviewBranchRule = {
  key: PadcevInterviewBranchKey;
  label: string;
  questionIds: string[];
  triggerPatterns: RegExp[];
  sourceOnly?: boolean;
  sourceDirective: string;
};

export const PADCEV_SIDE_EFFECT_INTENT_SLUG = "side-effect-management";

export const PADCEV_SIDE_EFFECT_HOME_QUESTION_IDS = [
  "safety",
  "safety_management_workflow",
  "safety_patient_caution",
  "safety_resources",
  "support_barriers",
  "safety_close",
  "close",
];

export const PADCEV_SIDE_EFFECT_BRANCH_RULES = [
  {
    key: "ev302_source_excursion",
    label: "EV-302 source detail excursion",
    questionIds: [],
    sourceOnly: true,
    triggerPatterns: [
      /\bev 302\b/,
      /\bev302\b/,
      /\bkeynote a39\b/,
      /\bkeynote-a39\b/,
      /\boverall survival\b/,
      /\bos\b/,
      /\bprogression free\b/,
      /\bpfs\b/,
      /\borr\b/,
      /\bresponse rate\b/,
      /\bcomplete response\b/,
      /\bcr\b/,
      /\befficacy\b/,
      /\bbenefit\b/,
      /\brisk benefit\b/,
      /\bdata show\b/,
    ],
    sourceDirective:
      "The participant explicitly asked about PADCEV efficacy or EV-302/KEYNOTE-A39 data while the interview remains in the side-effect-management intent. Treat this as a source-answer excursion, not a permanent lane switch. Answer the specific efficacy endpoint or trial-design detail they raised using source-supported facts only, including OS, PFS, ORR, CR/PR, comparator, population, follow-up, and caveats when available. Cite the source most likely to expose EV-302 efficacy charts or tables. Then return to the selected side-effect-management survey question.",
  },
  {
    key: "safety_resources",
    label: "Safety-management resources",
    questionIds: ["safety_resources"],
    triggerPatterns: [
      /\bguide\b/,
      /\bguides\b/,
      /\bchecklist\b/,
      /\bchecklists\b/,
      /\bresource\b/,
      /\bresources\b/,
      /\bpdf\b/,
      /\bpatient education\b/,
      /\bcounseling material\b/,
      /\bdownload\b/,
      /\bworkflow aid\b/,
    ],
    sourceDirective:
      "The participant is asking about PADCEV safety-management resources. Prioritize PADCEV HCP monitoring checklists, adverse-reaction management guides, dosing/administration guides, patient counseling materials, downloadable PDFs, and operational workflow aids. Prefer resource pages and PDF/guide assets over efficacy pages. Keep the answer specific to the requested resource need and then ask the selected side-effect-management question.",
  },
  {
    key: "safety_management_workflow",
    label: "Adverse-event management workflow",
    questionIds: ["safety_management_workflow"],
    triggerPatterns: [
      /\bmanage\b/,
      /\bmanagement\b/,
      /\bmonitor\b/,
      /\bmonitoring\b/,
      /\bintervene\b/,
      /\bintervention\b/,
      /\bdose modification\b/,
      /\bdose interruption\b/,
      /\bdose reduction\b/,
      /\bdiscontinuation\b/,
      /\bcontinue treatment\b/,
      /\bgo off treatment\b/,
      /\bneuropathy\b/,
      /\brash\b/,
      /\bskin reaction\b/,
      /\bhyperglycemia\b/,
      /\bpneumonitis\b/,
      /\bocular\b/,
    ],
    sourceDirective:
      "The participant is in the PADCEV side-effect-management lane or asked a practical adverse-event management question. Answer the specific adverse-event, monitoring, dose interruption, dose reduction, discontinuation, counseling, or workflow angle they raised; do not provide a full label-style safety inventory. Use 2-4 focused bullets or one short paragraph. For peripheral neuropathy specifically, look for source-supported grade-based dose modification guidance before saying the source lacks intervention detail. Do not use or cite efficacy/PFS/OS pages or display efficacy graphs unless the participant also asks about efficacy or risk-benefit.",
  },
  {
    key: "safety_patient_caution",
    label: "Safety-caution patient profile",
    questionIds: ["safety_patient_caution"],
    triggerPatterns: [
      /\b(?:patient|profile|cautious|caution|avoid|risk).{0,80}\b(?:side effect|side effects|adverse|toxicity|neuropathy|rash|skin|diabetes|hyperglycemia|ocular)\b/,
      /\b(?:side effect|side effects|adverse|toxicity|neuropathy|rash|skin|diabetes|hyperglycemia|ocular).{0,80}\b(?:patient|profile|cautious|caution|avoid|risk)\b/,
      /\bcomorbidity\b/,
      /\bbaseline neuropathy\b/,
    ],
    sourceDirective:
      "The participant is asking about PADCEV patient profiles from a safety-management standpoint. Frame patient profiles as safety-caution profiles, monitoring needs, mitigation needs, and dose-modification feasibility. Do not turn this into broad efficacy-based patient selection unless the participant explicitly asks about benefit-risk.",
  },
  {
    key: "implementation_barriers",
    label: "Implementation barriers",
    questionIds: ["support_barriers"],
    triggerPatterns: [
      /\bbarrier\b/,
      /\bbarriers\b/,
      /\boperational\b/,
      /\bfeasibility\b/,
      /\binfusion\b/,
      /\bscheduling\b/,
      /\bcoordination\b/,
      /\baccess\b/,
      /\bsupport\b/,
    ],
    sourceDirective:
      "The participant is asking about real-world implementation barriers in the PADCEV side-effect-management intent. Prioritize toxicity monitoring, infusion workflow, patient education, coordination, access/support resources, and practical barriers only where supported by approved sources.",
  },
] satisfies PadcevInterviewBranchRule[];

function normalizeForMap(content: string) {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9/+-]+/g, " ")
    .trim();
}

function firstPatternIndex(content: string, patterns: RegExp[]) {
  const indexes = patterns
    .map((pattern) => content.search(pattern))
    .filter((index) => index >= 0);

  return indexes.length ? Math.min(...indexes) : -1;
}

export function padcevSideEffectMapApplies(intentSlug: string | null | undefined) {
  return intentSlug === PADCEV_SIDE_EFFECT_INTENT_SLUG;
}

export function matchedPadcevSideEffectBranches(participantContent: string) {
  const normalized = normalizeForMap(participantContent);

  return PADCEV_SIDE_EFFECT_BRANCH_RULES.map((rule, order) => ({
    ...rule,
    order,
    index: firstPatternIndex(normalized, rule.triggerPatterns),
  }))
    .filter((rule) => rule.index >= 0)
    .sort((left, right) => left.index - right.index || left.order - right.order);
}

export function padcevSideEffectQuestionIdsForContent(
  participantContent: string,
) {
  return matchedPadcevSideEffectBranches(participantContent)
    .filter((rule) => !rule.sourceOnly)
    .flatMap((rule) => rule.questionIds);
}

export function padcevSideEffectSourceDirective(
  participantContent: string,
  selectedQuestionId: string | null | undefined,
) {
  const matchedDirective = matchedPadcevSideEffectBranches(
    participantContent,
  )[0]?.sourceDirective;

  if (matchedDirective) {
    return matchedDirective;
  }

  if (
    selectedQuestionId &&
    PADCEV_SIDE_EFFECT_HOME_QUESTION_IDS.includes(selectedQuestionId)
  ) {
    return PADCEV_SIDE_EFFECT_BRANCH_RULES.find(
      (rule) => rule.key === "safety_management_workflow",
    )?.sourceDirective;
  }

  return null;
}

export function nextPadcevSideEffectHomeQuestionId(input: {
  currentQuestionId: string | null;
  askedQuestionIds: string[];
  queuedQuestionIds: string[];
  participantContent: string;
}) {
  const asked = new Set(input.askedQuestionIds);
  const queued = new Set(input.queuedQuestionIds);
  const branchQuestionIds = padcevSideEffectQuestionIdsForContent(
    input.participantContent,
  );
  const priorityQuestionIds = [
    ...branchQuestionIds,
    ...PADCEV_SIDE_EFFECT_HOME_QUESTION_IDS,
  ];

  for (const questionId of priorityQuestionIds) {
    if (questionId === "intro_consent") {
      continue;
    }

    if (asked.has(questionId) || queued.has(questionId)) {
      continue;
    }

    return questionId;
  }

  return null;
}
