import type { MvpSurveySlug } from "./mvp-survey-definition";
import {
  matchedPadcevSideEffectBranches,
  padcevSideEffectMapApplies,
} from "./mvp-padcev-interview-map";

export type MvpTurnRouteKind =
  | "planned_answer"
  | "source_question"
  | "in_lane_topic"
  | "off_lane_excursion"
  | "unknown_in_domain"
  | "out_of_scope";

export type MvpDisplayTopic =
  | "padcev_ev302_response"
  | "padcev_ev302_survival"
  | "padcev_neuropathy_management"
  | "padcev_dose_modification"
  | "padcev_safety_resources"
  | "padcev_safety_management"
  | "padcev_patient_selection"
  | "brukinsa_cll_sequoia"
  | "brukinsa_cll_alpine"
  | "brukinsa_safety_management"
  | "unknown_in_domain"
  | null;

export type MvpTurnRouteDecision = {
  kind: MvpTurnRouteKind;
  topic: MvpDisplayTopic;
  needsSource: boolean;
  isOutOfScope: boolean;
  isUnanticipated: boolean;
  rationale: string;
  sourceDirective: string | null;
};

type RouteInput = {
  surveySlug: MvpSurveySlug;
  activeIntentSlug?: string | null;
  participantContent: string;
  currentQuestion?: string | null;
  selectedQuestionId?: string | null;
  selectedQuestionText?: string | null;
  selectedQuestionSourceContext?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/+-]+/g, " ")
    .trim();
}

function anyMatch(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function contentLooksLikeQuestion(raw: string, normalized: string) {
  return (
    raw.includes("?") ||
    anyMatch(normalized, [
      /\b(?:what|why|how|which|who|when|where|explain|tell me|show me|source|reference|data|study|trial|guide|checklist|resource|download|pdf)\b/,
    ])
  );
}

function outOfScopeQuestion(normalized: string) {
  return anyMatch(normalized, [
    /\b(?:weather|forecast|stock market|stock price|recipe|football|baseball|basketball|movie|restaurant|hotel|travel itinerary)\b/,
    /\b(?:write code|debug my code|javascript|python|sql query|spreadsheet formula)\b/,
  ]);
}

function padcevDisplayTopic(normalized: string): MvpDisplayTopic {
  const mentionsEv302 = anyMatch(normalized, [
    /\b(?:ev 302|ev302|ev-302|keynote a39|keynote-a39|keynote)\b/,
  ]);
  const mentionsResponse = anyMatch(normalized, [
    /\b(?:orr|overall response|response rate|complete response|partial response|\bcr\b|\bpr\b|recist)\b/,
  ]);
  const mentionsSurvival = anyMatch(normalized, [
    /\b(?:overall survival|survival|\bos\b|progression free|progression-free|\bpfs\b|hazard ratio|kaplan|\bkm\b)\b/,
  ]);

  if (mentionsEv302 && mentionsResponse) {
    return "padcev_ev302_response";
  }

  if (mentionsEv302 || mentionsSurvival) {
    return "padcev_ev302_survival";
  }

  if (
    anyMatch(normalized, [
      /\b(?:neuropathy|peripheral neuropathy|\bpn\b|numbness|tingling|muscle weakness)\b/,
    ])
  ) {
    return "padcev_neuropathy_management";
  }

  if (
    anyMatch(normalized, [
      /\b(?:dose modification|dose modifications|dose reduction|dose reductions|dose interruption|dose interruptions|withhold|resume|discontinue|discontinuation|reduce dose|interrupt dosing)\b/,
    ])
  ) {
    return "padcev_dose_modification";
  }

  if (
    anyMatch(normalized, [
      /\b(?:resource|resources|guide|checklist|download|pdf|patient education|counsel|counseling|support material|management material)\b/,
    ])
  ) {
    return "padcev_safety_resources";
  }

  if (
    anyMatch(normalized, [
      /\b(?:patient fit|patient population|patient populations|patient type|patient types|appropriate patient|inclusion|exclusion|eligible|candidate|cautious|caution|avoid|baseline risk|comorbidity|renal|cisplatin)\b/,
    ])
  ) {
    return "padcev_patient_selection";
  }

  if (
    anyMatch(normalized, [
      /\b(?:safety|side effect|side effects|adverse|toxicity|rash|skin|hyperglycemia|pneumonitis|ild|ocular|extravasation|monitor|monitoring|manage|management)\b/,
    ])
  ) {
    return "padcev_safety_management";
  }

  return null;
}

function brukinsaDisplayTopic(normalized: string): MvpDisplayTopic {
  if (
    anyMatch(normalized, [
      /\b(?:sequoia|frontline|first line|first-line|treatment naive|pfs|progression free|progression-free)\b/,
    ])
  ) {
    return "brukinsa_cll_sequoia";
  }

  if (
    anyMatch(normalized, [
      /\b(?:alpine|ibrutinib|head to head|head-to-head|relapsed|refractory|orr|response)\b/,
    ])
  ) {
    return "brukinsa_cll_alpine";
  }

  if (
    anyMatch(normalized, [
      /\b(?:safety|tolerability|adverse|side effect|side effects|bleeding|hemorrhage|infection|cytopenia|cardiac|afib|flutter|hepatotoxicity|dili|cyp3a|dose|monitoring|management)\b/,
    ])
  ) {
    return "brukinsa_safety_management";
  }

  return null;
}

function genericPadcevDirective(topic: MvpDisplayTopic) {
  if (topic === "padcev_ev302_response" || topic === "padcev_ev302_survival") {
    return "The participant explicitly asked about PADCEV efficacy or EV-302/KEYNOTE-A39 data. Treat this as a source-answer excursion if the active interview lane is not efficacy. Answer the specific endpoint or trial-design detail they raised using source-supported facts only, including comparator, population, follow-up, OS, PFS, ORR, CR/PR, and caveats when available. Cite the source most likely to expose EV-302 efficacy charts or tables. Then return to the selected survey question.";
  }

  if (
    topic === "padcev_neuropathy_management" ||
    topic === "padcev_dose_modification" ||
    topic === "padcev_safety_resources" ||
    topic === "padcev_safety_management" ||
    topic === "padcev_patient_selection"
  ) {
    return "The participant asked a PADCEV safety-management, patient-caution, dose-modification, or resource question. Answer the specific angle they raised; do not provide a full label-style safety inventory. Prefer source-supported monitoring, counseling, dose hold/reduction/discontinuation, and operational resources. If patient profiles are discussed, frame them as safety-caution or monitoring/mitigation considerations unless the participant explicitly asks for broad efficacy-based patient selection. Then return to the selected survey question.";
  }

  return "The participant asked an in-domain PADCEV source question that does not match a predefined route. Answer only the specific question using approved PADCEV HCP source material, cite sources, avoid patient-specific treatment advice, and then return to the selected survey question.";
}

function genericBrukinsaDirective(topic: MvpDisplayTopic) {
  if (topic === "brukinsa_cll_sequoia") {
    return "The participant asked about BRUKINSA SEQUOIA or first-line CLL/SLL evidence. Answer using approved BRUKINSA HCP CLL/SLL source material only, including population, comparator/cohort, endpoints, results, and caveats where source-supported. Then return to the selected survey question.";
  }

  if (topic === "brukinsa_cll_alpine") {
    return "The participant asked about BRUKINSA ALPINE, ibrutinib comparison, or relapsed/refractory CLL/SLL evidence. Answer using approved BRUKINSA HCP CLL/SLL source material only, including population, comparator, endpoints, results, and caveats where source-supported. Then return to the selected survey question.";
  }

  if (topic === "brukinsa_safety_management") {
    return "The participant asked a BRUKINSA safety, monitoring, medication-management, dose-modification, or resource question. Answer the specific angle they raised using approved BRUKINSA HCP source material, without providing a full label-style safety inventory. Then return to the selected survey question.";
  }

  return "The participant asked an in-domain BRUKINSA source question that does not match a predefined route. Answer only the specific question using approved BRUKINSA HCP source material, cite sources, avoid patient-specific treatment advice, and then return to the selected survey question.";
}

export function classifyMvpTurnRoute(input: RouteInput): MvpTurnRouteDecision {
  const participantText = normalizeText(input.participantContent);
  const combinedText = normalizeText(
    [
      input.participantContent,
      input.currentQuestion,
      input.selectedQuestionText,
      input.selectedQuestionSourceContext,
    ].join(" "),
  );
  const participantAskedQuestion = contentLooksLikeQuestion(
    input.participantContent,
    participantText,
  );

  if (outOfScopeQuestion(participantText)) {
    return {
      kind: "out_of_scope",
      topic: null,
      needsSource: false,
      isOutOfScope: true,
      isUnanticipated: true,
      rationale:
        "Participant asked a clearly non-survey question; keep the interview focused.",
      sourceDirective: null,
    };
  }

  if (input.surveySlug === "padcev") {
    const participantTopic = padcevDisplayTopic(participantText);
    const routeTopic = participantTopic ?? padcevDisplayTopic(combinedText);
    const matchedSideEffectBranch = padcevSideEffectMapApplies(
      input.activeIntentSlug,
    )
      ? matchedPadcevSideEffectBranches(input.participantContent)[0]
      : null;
    const sourceDirective =
      matchedSideEffectBranch?.sourceDirective ??
      (routeTopic ? genericPadcevDirective(routeTopic) : null);
    const efficacyExcursion =
      padcevSideEffectMapApplies(input.activeIntentSlug) &&
      (routeTopic === "padcev_ev302_response" ||
        routeTopic === "padcev_ev302_survival");

    if (participantTopic) {
      return {
        kind: efficacyExcursion ? "off_lane_excursion" : "in_lane_topic",
        topic: routeTopic,
        needsSource: true,
        isOutOfScope: false,
        isUnanticipated: !matchedSideEffectBranch,
        rationale: efficacyExcursion
          ? "Participant asked an in-domain PADCEV source question outside the active intent lane."
          : "Participant asked an in-domain PADCEV question that maps to a known route.",
        sourceDirective,
      };
    }

    if (participantAskedQuestion) {
      return {
        kind: "unknown_in_domain",
        topic: "unknown_in_domain",
        needsSource: true,
        isOutOfScope: false,
        isUnanticipated: true,
        rationale:
          "Participant asked a source-like question that did not match a predefined PADCEV route.",
        sourceDirective: genericPadcevDirective(null),
      };
    }
  }

  if (input.surveySlug === "brukinsa") {
    const participantTopic = brukinsaDisplayTopic(participantText);
    const routeTopic = participantTopic ?? brukinsaDisplayTopic(combinedText);

    if (participantTopic) {
      return {
        kind: "in_lane_topic",
        topic: routeTopic,
        needsSource: true,
        isOutOfScope: false,
        isUnanticipated: false,
        rationale:
          "Participant asked an in-domain BRUKINSA question that maps to a known route.",
        sourceDirective: genericBrukinsaDirective(routeTopic),
      };
    }

    if (participantAskedQuestion) {
      return {
        kind: "unknown_in_domain",
        topic: "unknown_in_domain",
        needsSource: true,
        isOutOfScope: false,
        isUnanticipated: true,
        rationale:
          "Participant asked a source-like question that did not match a predefined BRUKINSA route.",
        sourceDirective: null,
      };
    }
  }

  return {
    kind: "planned_answer",
    topic: null,
    needsSource: false,
    isOutOfScope: false,
    isUnanticipated: false,
    rationale:
      "Participant response appears to answer the current survey question without requiring a source excursion.",
    sourceDirective: null,
  };
}
