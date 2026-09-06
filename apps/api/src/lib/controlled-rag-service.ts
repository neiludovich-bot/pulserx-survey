import { moderatorEvidencePacketSchema, sourceQuestionPlanSchema, sourceAnswerGroundingAuditSchema, type SourceAnswerGroundingAudit, type GroundedReference, type ModeratorEvidencePacket, type SourceQuestionPlan, type SourceQuestionPlanInput, type SourceTurnOutcome } from "@interview/schemas";
import {
  CONTROLLED_RAG_CHUNKS,
  NUBEQA_ARANOTE_UTI_FACTS,
  NUBEQA_DDI_FACTS,
  type ControlledRagChunk,
} from "./controlled-rag-source-packs";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { classifyMvpTurnRoute, type MvpDisplayTopic } from "./mvp-turn-router";
import { prisma } from "./prisma";
import { stripQuestionSentences } from "./source-answer-sentences";
import { alignCitedSourceReferences, normalizeSourceCitationMarkers, selectFocusedSourceEvidence, withExplicitSourceAssets } from "./focused-source-evidence";
import { recoverSelectedSourceExcerpt } from "./source-extractive-recovery";
import { sourceContentSearchSql, sourceContentSearchTerms } from "./source-retrieval-query";
import { planSourceQuestion } from "./source-question-planner";
import { answerFromWebsite, renderWebsiteAnswer } from "./website-answer-service";
import { sourceTurnOutcome } from "./source-turn-outcome";
import { logSyntheticGroundingDiagnostics } from "./synthetic-grounding-diagnostics";
import { sourcePresentationForTurn } from "./source-presentation";

type ControlledRagAsset = NonNullable<ControlledRagChunk["assets"]>[number];
type WeightedTokenGroup = {
  tokens: string[];
  weight: number;
};
type DisplayTopic = MvpDisplayTopic;
type ClinicalEvidenceCard = {
  id: string;
  title: string;
  topic: DisplayTopic;
  clinicianBrief: string;
  keyFacts: string[];
  caveats: string[];
  answerDirective: string;
  preferredSourceIds: string[];
  preferredAssetTags: string[];
};

export type ControlledRagSurveyTurnInput = {
  surveySlug: "brukinsa" | "padcev" | "nubeqa";
  participantMessage: string;
  surveyContext: string;
  currentQuestion: string | null;
  selectedNextQuestion: string | null;
  selectedQuestionSourceContext: string | null;
  recentInterviewerContext?: string | null;
  recentTurns?: SourceQuestionPlanInput["recentTurns"];
  sourceQuestionPlan?: SourceQuestionPlan | null;
  sourceTopicContext?: string | null;
  evidencePacket?: ModeratorEvidencePacket | null;
  presentationPlan?: SourceQuestionPlanInput["presentationPlan"];
  responseMode?: "answer_only" | "answer_then_ask";
  requestOrigin?: "participant" | "selected_priority";
};

export type ControlledRagSurveyTurnResult = {
  enabled: boolean;
  answer: string | null;
  references: GroundedReference[];
  citationIds: string[];
  conversationId: string | null;
  reason: string | null;
  evidencePacket?: ModeratorEvidencePacket | null;
  sourceQuestionPlan?: SourceQuestionPlan | null;
  sourceAnswerGrounding?: SourceAnswerGroundingAudit | null;
  sourceOutcome?: SourceTurnOutcome;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "ask",
  "asked",
  "before",
  "being",
  "can",
  "could",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "material",
  "next",
  "question",
  "source",
  "survey",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "turn",
  "use",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/+-]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function compact(value: string | null | undefined, maxChars: number) {
  if (!value) {
    return "";
  }

  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars - 18).trimEnd()} [truncated]`;
}

export function isReferentialClarification(message: string) {
  const text = normalizeText(message)
    .replace(/^(?:please\s+|(?:can|could|would) (?:you )?)/, "")
    .replace(/^please\s+/, "")
    .replace(/\s+please$/, "");

  // Match the entire request so a newly named topic always owns retrieval.
  return /^(?:explain(?: (?:that|this|it))?(?: (?:more simply|in simpler terms|in simple terms|again|a bit more))?|(?:even )?(?:more simply|simpler|shorter)|(?:say|tell me) more(?: about (?:that|this|it))?|simplify(?: (?:that|this|it))?|what does (?:that|this|it) mean)$/.test(text);
}

function hasBackwardSourceReference(message: string) {
  // Linguistic references identify a dependency on already presented entities;
  // they do not choose a clinical topic or imply a medical relationship.
  return /\b(?:those|these|such|they|them)\b|\bthe same\b|\b(?:on|with|from|for|of|to)\s+it\b/i.test(message);
}

function sourceTurnInputs(input: ControlledRagSurveyTurnInput) {
  if (input.responseMode !== "answer_only") {
    const retrievalQuery = [input.selectedQuestionSourceContext, input.selectedNextQuestion].filter(Boolean).join("\n") || input.participantMessage;
    return { retrievalQuery, retrievalInput: { ...input, participantMessage: retrievalQuery, currentQuestion: null }, compositionInput: input };
  }

  // The research question is parked during a source discussion. Keep lane
  // constraints and the reactive source directive, but do not retrieve or
  // compose an answer to that parked research question.
  const compositionInput = {
    ...input,
    currentQuestion: null,
    selectedNextQuestion: null,
    selectedQuestionSourceContext: null,
    surveyContext: input.surveyContext.split("\n").filter((line) =>
      !/^(?:Current question|Selected next question|Parked survey question to resume after a source-answer pause|Upcoming unasked guide preview):/i.test(line.trim()),
    ).join("\n"),
  };
  let retrievalQuery = input.participantMessage;
  if (isReferentialClarification(input.participantMessage)) {
    const exchanges = [...(input.recentInterviewerContext ?? "").matchAll(
      /(?:^|\n)(participant|interviewer):\s*([\s\S]*?)(?=\n(?:participant|interviewer):|$)/gi,
    )];
    const recent = exchanges.reverse();
    const previousAnswer = recent.find((exchange) => exchange[1]?.toLowerCase() === "interviewer" && exchange[2]?.trim());
    const previousRequest = recent.find((exchange) => exchange[1]?.toLowerCase() === "participant" && exchange[2]?.trim() && !isReferentialClarification(exchange[2]));
    // Moderator source presentations can follow a reaction to the previous
    // topic. Canonical source context owns "that"; legacy sessions use the
    // newest source answer instead of the older participant reaction.
    retrievalQuery = input.sourceTopicContext?.trim() || previousAnswer?.[2]?.trim() || previousRequest?.[2]?.trim() || retrievalQuery;
  }

  return {
    retrievalQuery,
    retrievalInput: { ...compositionInput, participantMessage: retrievalQuery },
    compositionInput,
  };
}

function chunkHaystack(chunk: ControlledRagChunk) {
  return normalizeText(
    [chunk.title, chunk.description, chunk.tags.join(" "), chunk.text].join(
      " ",
    ),
  );
}

function chunkTokenSet(chunk: ControlledRagChunk) {
  return new Set(tokens(chunkHaystack(chunk)));
}

function chunkTagTokenSet(chunk: ControlledRagChunk) {
  return new Set(chunk.tags.flatMap((tag) => tokens(tag)));
}

function scoreChunk(
  chunk: ControlledRagChunk,
  queryTokenGroups: WeightedTokenGroup[],
) {
  const haystackTokens = chunkTokenSet(chunk);
  const tagTokens = chunkTagTokenSet(chunk);
  let score = 0;

  for (const group of queryTokenGroups) {
    for (const token of group.tokens) {
      if (!haystackTokens.has(token)) {
        continue;
      }

      score += (tagTokens.has(token) ? 4 : 1) * group.weight;
    }
  }

  return score;
}

function retrievalTokenGroups(input: ControlledRagSurveyTurnInput) {
  if (input.responseMode === "answer_only") {
    return [{ tokens: tokens(input.participantMessage), weight: 10 }];
  }
  return [
    { tokens: tokens(input.participantMessage), weight: 10 },
    { tokens: tokens(input.selectedQuestionSourceContext ?? ""), weight: 3 },
    { tokens: tokens(input.selectedNextQuestion ?? ""), weight: 1 },
    { tokens: tokens(input.currentQuestion ?? ""), weight: 1 },
    { tokens: tokens(input.surveyContext), weight: 1 },
  ].filter((group) => group.tokens.length > 0);
}

function scoreAsset(asset: ControlledRagAsset, queryTokens: string[]) {
  const haystackTokens = new Set(
    tokens(
      [
        asset.title,
        asset.description,
        asset.url,
        asset.assetKind,
        asset.tags.join(" "),
      ].join(" "),
    ),
  );
  const tagTokens = new Set(asset.tags.flatMap((tag) => tokens(tag)));
  const kind = asset.assetKind.toUpperCase();
  let score = asset.priority;

  if (["CHART", "TABLE", "IMAGE"].includes(kind)) {
    score += 90;
  }

  if (kind === "PDF") {
    score += 70;
  }

  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      score += tagTokens.has(token) ? 10 : 3;
    }
  }

  if (
    /\b(?:hero|lifestyle|campaign|airplane|aircraft|plane|jet|flight|travel|splash|product shot|pill|tablet|capsule)\b/i.test(
      `${asset.title} ${asset.description ?? ""} ${asset.url}`,
    )
  ) {
    score -= 160;
  }

  return score;
}

function assetSearchText(asset: ControlledRagAsset) {
  return normalizeText(
    [
      asset.title,
      asset.description ?? "",
      asset.url,
      asset.assetKind,
      asset.tags.join(" "),
    ].join(" "),
  );
}

function textMatchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function displayTopicForTurn(
  input: ControlledRagSurveyTurnInput,
): DisplayTopic {
  return classifyMvpTurnRoute({
    surveySlug: input.surveySlug,
    participantContent: input.participantMessage,
    currentQuestion: input.currentQuestion,
    selectedQuestionText: input.selectedNextQuestion,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
  }).topic;
}

function citationMarkerForCard(
  chunks: ControlledRagChunk[],
  card: Pick<ClinicalEvidenceCard, "preferredSourceIds" | "preferredAssetTags">,
  fallbackIndex = 0,
) {
  const sourceNeedles = card.preferredSourceIds.map(normalizeText);
  const assetNeedles = card.preferredAssetTags.map(normalizeText);
  const index = chunks.findIndex((chunk) => {
    const haystack = chunkHaystack(chunk);

    return (
      sourceNeedles.some(
        (needle) =>
          needle.length > 0 &&
          (normalizeText(chunk.id).includes(needle) ||
            normalizeText(chunk.title).includes(needle) ||
            haystack.includes(needle)),
      ) ||
      assetNeedles.some((needle) => needle.length > 0 && haystack.includes(needle))
    );
  });

  return `[${(index >= 0 ? index : Math.min(fallbackIndex, chunks.length - 1)) + 1}]`;
}

function citationMarkerForCardFact(
  chunks: ControlledRagChunk[],
  card: ClinicalEvidenceCard,
  factIndex: number,
  fallbackIndex = 0,
) {
  const sourceId = card.preferredSourceIds[factIndex];

  if (sourceId) {
    return citationMarkerForCard(
      chunks,
      {
        preferredSourceIds: [sourceId],
        preferredAssetTags: [],
      },
      fallbackIndex,
    );
  }

  return citationMarkerForCard(chunks, card, fallbackIndex);
}

function sentenceFragments(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function removeInstructionalSourceLanguage(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bUse the source page for exact current [^.]+\.?/gi, "")
    .replace(/\bUse source page detail for exact current [^.]+\.?/gi, "")
    .replace(/\bIf the cited material does not answer the exact question,?[^.]+\.?/gi, "")
    .replace(/\bCurrent imported source notes include\b/gi, "The imported source notes include")
    .replace(/\bThe source pack states that\b/gi, "The source states that")
    .replace(/\bThe source card reports\b/gi, "The source reports")
    .replace(/\bThe page states that\b/gi, "The page reports that")
    .replace(/\bThe page frames\b/gi, "The page uses")
    .replace(/\bThe HCP material describes\b/gi, "The HCP material reports")
    .replace(/\bThe HCP source frames\b/gi, "The HCP source describes")
    .replace(
      /\bThe NUBEQA mCSPC HCP efficacy page presents\b/gi,
      "The mCSPC HCP efficacy page presents",
    )
    .replace(
      /\bThe NUBEQA HCP dosing page describes\b/gi,
      "The HCP dosing page describes",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function compactClinicalFact(value: string, maxChars = 390) {
  const cleaned = removeInstructionalSourceLanguage(value);
  const sentences = sentenceFragments(cleaned).filter(
    (sentence) =>
      !textMatchesAny(normalizeText(sentence), [
        /\b(?:use the source page|exact current|if the cited material|does not answer the exact question)\b/,
      ]),
  );
  const fact = (sentences.slice(0, 2).join(" ") || cleaned).trim();

  if (fact.length <= maxChars) {
    return fact;
  }

  return `${fact.slice(0, maxChars - 1).trimEnd()}.`;
}

function nonInstructionalCaveats(caveats: string[]) {
  return caveats.filter(
    (caveat) =>
      !textMatchesAny(normalizeText(caveat), [
        /\buse the source page\b/,
        /\bif the cited material does not answer\b/,
        /\bkeep the answer descriptive\b/,
      ]),
  );
}

function chunksMentionMultipleNubeqaEvidenceAreas(chunks: ControlledRagChunk[]) {
  const text = normalizeText(
    chunks
      .map((chunk) => [chunk.id, chunk.title, chunk.tags.join(" ")].join(" "))
      .join(" "),
  );
  const hits = [
    /\baramis\b/.test(text),
    /\baranote\b/.test(text),
    /\barasens\b/.test(text),
    /\b(?:safety|dosing|ddi|dose modification)\b/.test(text),
  ].filter(Boolean).length;

  return hits >= 2;
}

function asksAboutNubeqaDrugInteractions(input: ControlledRagSurveyTurnInput) {
  if (input.surveySlug !== "nubeqa") {
    return false;
  }

  const participant = normalizeText(input.participantMessage);

  return textMatchesAny(participant, [
    /\b(?:drug-drug|drug drug|drug interaction|drug interactions|interactions|ddi|cyp3a|cyp3a4|p-gp|pgp|bcrp|oatp|oatp1b1|oatp1b3|inducer|inducers|inhibitor|inhibitors|substrate|substrates)\b/,
  ]);
}

function focusedNubeqaEvidenceId(input: ControlledRagSurveyTurnInput) {
  if (input.surveySlug !== "nubeqa") return null;
  const participant = normalizeText(input.participantMessage);
  if (
    /\b(?:uti|utis|urinary tract infections?)\b/.test(participant) &&
    !/\b(?:aramis|arasens|nmcrpc)\b/.test(participant) &&
    (!/\bdocetaxel\b/.test(participant) || /\bwithout docetaxel\b/.test(participant))
  ) return "nubeqa-aranote-uti";
  return asksAboutNubeqaDrugInteractions(input) ? "nubeqa-ddi-profile" : null;
}

function buildClinicalEvidenceCard(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
): ClinicalEvidenceCard | null {
  const topic = displayTopicForTurn(input);
  const sourceContext = normalizeText(input.selectedQuestionSourceContext ?? "");
  const selectedQuestion = normalizeText(input.selectedNextQuestion ?? "");
  const participant = normalizeText(input.participantMessage);
  const focusedEvidenceId = focusedNubeqaEvidenceId(input);
  if (focusedEvidenceId && chunks.some((chunk) => chunk.id === focusedEvidenceId)) {
    const uti = focusedEvidenceId === "nubeqa-aranote-uti";
    return {
      id: focusedEvidenceId,
      title: uti ? "NUBEQA ARANOTE Urinary Tract Infection Rates" : "NUBEQA Drug-Drug Interaction (DDI) Profile",
      topic: "nubeqa_safety_dosing",
      clinicianBrief: uti
        ? "Report the ARANOTE urinary tract infection rates by treatment arm and severity."
        : "Explain the specific drug interaction classes and direction of the interaction.",
      keyFacts: uti ? [...NUBEQA_ARANOTE_UTI_FACTS] : [...NUBEQA_DDI_FACTS],
      caveats: uti
        ? ["These are ARANOTE trial rates, not estimates of an individual patient's risk or rates from ARAMIS or ARASENS."]
        : [],
      answerDirective: uti
        ? "Give the all-grade and Grade 3 or 4 urinary tract infection percentages for both ARANOTE arms. The exact incidence is in this approved source; do not say it is unavailable. Do not confuse Grade 3 or 4 incidence with the separate serious-adverse-reaction category."
        : "Answer the DDI question from these interaction facts, not from general adverse-reaction incidence or dose-modification tables.",
      preferredSourceIds: [focusedEvidenceId],
      preferredAssetTags: uti ? ["urinary tract infection", "uti", "aranote"] : ["ddi", "drug interactions", "bcrp", "cyp3a4"],
    };
  }
  const asksSpecificNubeqaDrugInteractions =
    asksAboutNubeqaDrugInteractions(input);
  const topicLooksBroad =
    topic === null ||
    topic === "unknown_in_domain" ||
    topic === "nubeqa_patient_selection";
  const asksBroadNubeqaPositioning =
    input.surveySlug === "nubeqa" &&
    (sourceContext.includes("indication") ||
      sourceContext.includes("high level role") ||
      selectedQuestion.includes("role across nmcrpc and mcspc") ||
      selectedQuestion.includes("treatment framework") ||
      selectedQuestion.includes("top factors") ||
      selectedQuestion.includes("nubeqa specific information") ||
      (topicLooksBroad && chunksMentionMultipleNubeqaEvidenceAreas(chunks))) &&
    !asksSpecificNubeqaDrugInteractions;

  if (input.surveySlug === "nubeqa" && asksBroadNubeqaPositioning) {
    return {
      id: "nubeqa-positioning-overview",
      title: "NUBEQA Disease-State Positioning",
      topic: "nubeqa_patient_selection",
      clinicianBrief:
        "Frame NUBEQA by disease state and treatment backbone rather than as a generic prostate-cancer source tour.",
      keyFacts: [
        "For nmCRPC, ARAMIS frames NUBEQA plus ADT versus ADT/placebo, with metastasis-free survival as the primary endpoint and overall survival also reported.",
        "For mCSPC without docetaxel, ARANOTE frames NUBEQA plus ADT versus placebo plus ADT, with rPFS as the primary endpoint.",
        "For mCSPC with docetaxel, ARASENS frames NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel, including OS and time-to-mCRPC context.",
        "The dosing/safety material adds 600 mg twice daily with food plus dose-modification, renal/hepatic, DDI, ischemic-heart-disease, and seizure-warning context where relevant.",
      ],
      caveats: [],
      answerDirective:
        "Give a concise clinical map across nmCRPC, mCSPC without docetaxel, and mCSPC with docetaxel. Do not say 'source areas,' imply a page inventory, or add a follow-up question.",
      preferredSourceIds: [
        "nubeqa-nmcrpc-aramis",
        "nubeqa-mcspc-aranote",
        "nubeqa-mcspc-arasens",
        "nubeqa-safety-dosing",
      ],
      preferredAssetTags: [
        "aramis",
        "aranote",
        "arasens",
        "mfs",
        "rpfs",
        "overall survival",
        "dosing",
      ],
    };
  }

  if (topic === "nubeqa_mcspc_aranote") {
    return {
      id: "nubeqa-aranote",
      title: "NUBEQA ARANOTE mCSPC Evidence",
      topic,
      clinicianBrief:
        "Answer ARANOTE questions as an mCSPC without-docetaxel evidence discussion, focused on rPFS and the ADT-only backbone.",
      keyFacts: [
        "ARANOTE is presented as NUBEQA plus ADT versus placebo plus ADT in mCSPC.",
        "rPFS is the primary endpoint in the HCP source material.",
        "The source card reports median follow-up of 25.3 months for NUBEQA plus ADT and 25.0 months for placebo plus ADT.",
        "At 24 months, 70.3% of patients receiving NUBEQA plus ADT versus 52.1% receiving placebo plus ADT remained free of radiological progression and were alive.",
      ],
      caveats: ["Use the source page for exact current curve details and caveats."],
      answerDirective:
        "If the participant asks what ARANOTE shows, answer with population, comparator, endpoint, result, and caveat. Avoid broad NUBEQA overview unless requested.",
      preferredSourceIds: ["nubeqa-mcspc-aranote", "aranote"],
      preferredAssetTags: ["aranote", "rpfs", "mcspc", "adt"],
    };
  }

  if (topic === "nubeqa_mcspc_arasens") {
    return {
      id: "nubeqa-arasens",
      title: "NUBEQA ARASENS mCSPC Evidence",
      topic,
      clinicianBrief:
        "Answer ARASENS questions as a docetaxel-containing mCSPC triplet discussion, focused on OS and time-to-mCRPC where supported.",
      keyFacts: [
        "ARASENS is presented as NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel in mCSPC.",
        "The HCP material describes overall survival and time-to-mCRPC context for this docetaxel-containing setting.",
        "The source pack states that NUBEQA in combination with docetaxel significantly reduced the risk of death by nearly a third versus docetaxel and ADT alone.",
      ],
      caveats: ["Use source page detail for exact current Kaplan-Meier values, landmark analyses, and endpoint hierarchy."],
      answerDirective:
        "Keep the answer anchored to the docetaxel/planned-triplet use case and do not drift into ARANOTE unless asked to compare.",
      preferredSourceIds: ["nubeqa-mcspc-arasens", "arasens"],
      preferredAssetTags: ["arasens", "overall survival", "time to mcrpc", "docetaxel"],
    };
  }

  if (topic === "nubeqa_nmcrpc_aramis") {
    return {
      id: "nubeqa-aramis",
      title: "NUBEQA ARAMIS nmCRPC Evidence",
      topic,
      clinicianBrief:
        "Answer ARAMIS questions as an nmCRPC evidence discussion, focused on MFS, OS, and subgroup context when supported.",
      keyFacts: [
        "ARAMIS is presented as NUBEQA plus ADT versus ADT/placebo alone in nmCRPC.",
        "Metastasis-free survival is described as the primary endpoint.",
        "The HCP material states that NUBEQA significantly improved metastasis-free survival and overall survival in nmCRPC.",
        "The source pack notes consistent MFS results across subgroups such as PSADT and prior bone-targeting agent use.",
      ],
      caveats: ["Use the source page for exact current Kaplan-Meier values and secondary endpoint detail."],
      answerDirective:
        "Keep the response specific to nmCRPC and ARAMIS unless the participant asks to compare mCSPC data.",
      preferredSourceIds: ["nubeqa-nmcrpc-aramis", "aramis"],
      preferredAssetTags: ["aramis", "mfs", "metastasis-free survival", "overall survival"],
    };
  }

  if (topic === "nubeqa_safety_dosing") {
    return {
      id: "nubeqa-safety-dosing",
      title: "NUBEQA Safety, Dosing, and DDI",
      topic,
      clinicianBrief:
        "Answer NUBEQA safety and dosing questions with specific dosing, modification, renal/hepatic, DDI, ischemic-heart-disease, and seizure-warning points only as relevant.",
      keyFacts: [
        "The HCP dosing page describes 600 mg twice daily with food and treatment until disease progression or unacceptable toxicity.",
        "Dose modification to 300 mg twice daily is described for supported severe renal impairment, moderate hepatic impairment, Grade 3 or greater toxicity, or intolerable adverse reaction contexts.",
        "The same source notes that in ARASENS, NUBEQA continues even if docetaxel is delayed, interrupted, or discontinued.",
        "Important Safety Information includes ischemic heart disease and seizure warnings, plus adverse-reaction context across ARAMIS, ARANOTE, and ARASENS.",
        "For drug interactions, combined P-gp plus strong or moderate CYP3A4 inducers can decrease darolutamide exposure and should be avoided; combined P-gp plus strong CYP3A4 inhibitors can increase darolutamide exposure, so patients should be monitored more frequently for adverse reactions and dose modified as needed.",
        "NUBEQA is described as an inhibitor of BCRP, OATP1B1, and OATP1B3 transporters; concomitant use may increase substrate exposure, so BCRP substrates should be avoided when possible or monitored with possible substrate dose reduction, and OATP substrates should be monitored with possible dose reduction.",
      ],
      caveats: ["Do not turn this into a full label inventory unless the participant explicitly asks."],
      answerDirective:
        "Answer the named safety, DDI, dosing, or management issue first. Do not add a follow-up question.",
      preferredSourceIds: ["nubeqa-safety-dosing", "safety dosing ddi"],
      preferredAssetTags: ["safety", "dosing", "dose modification", "ddi", "adverse reactions"],
    };
  }

  if (topic === "nubeqa_guidelines_resources") {
    return {
      id: "nubeqa-guidelines-resources",
      title: "NUBEQA Guidelines and Practice Resources",
      topic,
      clinicianBrief:
        "Answer NUBEQA guideline and resource questions as practice-implementation context, not as efficacy or safety claims.",
      keyFacts: [
        "The HCP guidelines page presents treatment-guideline context for mCSPC and nmCRPC.",
        "The HCP site includes access/support areas, formulary coverage, Access Services by Bayer, contact-a-representative pathways, Bayer Den, KOL videos, practice resources, patient resources, and patient profiles.",
      ],
      caveats: ["Use source pages for exact current guideline wording, categories, and resource names."],
      answerDirective:
        "Keep guideline/resource answers concrete and implementation-focused; avoid implying guideline endorsement beyond the source wording.",
      preferredSourceIds: ["nubeqa-guidelines-resources", "guidelines"],
      preferredAssetTags: ["guidelines", "nccn", "aua", "resources", "access"],
    };
  }

  if (topic === "nubeqa_patient_selection") {
    return {
      id: "nubeqa-patient-selection",
      title: "NUBEQA Patient Fit Across Disease States",
      topic,
      clinicianBrief:
        "Answer patient-fit questions by separating disease state and treatment backbone, then add safety/dosing cautions only when relevant.",
      keyFacts: [
        "For nmCRPC, ARAMIS supports discussion of NUBEQA plus ADT versus ADT/placebo, with MFS as the primary endpoint and OS also reported.",
        "For mCSPC without docetaxel, ARANOTE supports discussion of NUBEQA plus ADT versus placebo plus ADT, with rPFS as the primary endpoint.",
        "For mCSPC with docetaxel, ARASENS supports discussion of NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel, including OS and time-to-mCRPC context.",
        "Safety and dosing considerations include 600 mg twice daily with food, dose-modification contexts, and labeled ischemic-heart-disease and seizure warnings.",
      ],
      caveats: [
        "Frame this as market-research reaction to source material, not patient-specific treatment advice.",
      ],
      answerDirective:
        "If the respondent asks which patients fit, answer by disease state and treatment backbone. Do not recite the website structure.",
      preferredSourceIds: [
        "nubeqa-nmcrpc-aramis",
        "nubeqa-mcspc-aranote",
        "nubeqa-mcspc-arasens",
        "nubeqa-safety-dosing",
      ],
      preferredAssetTags: [
        "patient",
        "aramis",
        "aranote",
        "arasens",
        "mfs",
        "rpfs",
        "overall survival",
        "dosing",
      ],
    };
  }

  if (topic === "padcev_ev302_response" || topic === "padcev_ev302_survival") {
    return {
      id: "padcev-ev302",
      title: "PADCEV EV-302/KEYNOTE-A39 Evidence",
      topic,
      clinicianBrief:
        "Answer PADCEV EV-302 questions with the exact endpoint requested first, then trial context.",
      keyFacts: [
        "EV-302/KEYNOTE-A39 is presented as a pivotal phase 3 trial in previously untreated locally advanced or metastatic urothelial cancer.",
        "The comparison is PADCEV plus pembrolizumab versus platinum-based chemotherapy.",
        "Current imported source notes include OS, PFS, ORR, CR, PR, comparator, and follow-up details when present in the retrieved excerpts.",
      ],
      caveats: ["Updated analyses may be descriptive; report that caveat when it appears in the cited material."],
      answerDirective:
        "If the participant asks for response, lead with ORR/CR/PR. If they ask survival, lead with OS/PFS. Do not answer a safety lane question with efficacy unless they explicitly ask.",
      preferredSourceIds: ["padcev-ev302", "ev-302", "keynote-a39", "pembrolizumab efficacy"],
      preferredAssetTags: ["ev-302", "keynote", "overall survival", "pfs", "orr", "complete response"],
    };
  }

  if (
    topic === "padcev_neuropathy_management" ||
    topic === "padcev_dose_modification" ||
    topic === "padcev_safety_resources" ||
    topic === "padcev_safety_management"
  ) {
    return {
      id: "padcev-safety-management",
      title: "PADCEV Safety and Adverse-Reaction Management",
      topic,
      clinicianBrief:
        "Answer PADCEV safety-management turns with the specific adverse event, monitoring point, dose-modification action, or resource requested.",
      keyFacts: [
        "PADCEV safety-management materials include monitoring, dose interruption, dose reduction, discontinuation, counseling, and resource concepts.",
        "For peripheral neuropathy, the source-supported management is grade-based: Grade 2 is withheld until Grade <=1 and then resumed according to first occurrence or recurrence; Grade >=3 is permanently discontinued when supported by the cited material.",
        "Resources can include adverse-reaction monitoring checklists, dose-modification materials, patient education, counseling aids, and downloadable guides when surfaced by the cited source.",
      ],
      caveats: ["Do not provide a broad label-style safety inventory unless the participant asks for one."],
      answerDirective:
        "Start with the named adverse event or resource need. Keep efficacy out unless the participant asks for risk-benefit.",
      preferredSourceIds: [
        "padcev-safety-management",
        "peripheral neuropathy",
        "dose modifications",
        "adverse reactions monitoring checklist",
      ],
      preferredAssetTags: [
        "neuropathy",
        "dose modification",
        "monitoring",
        "checklist",
        "adverse reactions",
        "patient education",
      ],
    };
  }

  if (topic === "brukinsa_cll_sequoia") {
    return {
      id: "brukinsa-sequoia",
      title: "BRUKINSA SEQUOIA CLL/SLL Evidence",
      topic,
      clinicianBrief:
        "Answer SEQUOIA questions as first-line CLL/SLL evidence, focused on treatment-naive population, cohort structure, comparator, PFS, and del(17p) caveats.",
      keyFacts: [
        "SEQUOIA is the BRUKINSA first-line CLL/SLL evidence anchor on the HCP site.",
        "The source pack describes Cohort 1 as BRUKINSA versus bendamustine plus rituximab in patients without del(17p).",
        "It also describes a separate del(17p) BRUKINSA-only cohort, which limits direct comparative conclusions for that subgroup.",
        "The HCP source presents progression-free survival as a key efficacy focus and includes Kaplan-Meier visuals and patient-at-risk information.",
      ],
      caveats: ["Use the source page for exact current numeric results and publication details."],
      answerDirective:
        "Keep the answer scoped to CLL/SLL SEQUOIA unless the participant asks about ALPINE or another disease area.",
      preferredSourceIds: ["brukinsa-cll-sequoia", "sequoia"],
      preferredAssetTags: ["sequoia", "cll", "pfs", "kaplan"],
    };
  }

  if (topic === "brukinsa_cll_alpine") {
    return {
      id: "brukinsa-alpine",
      title: "BRUKINSA ALPINE CLL/SLL Evidence",
      topic,
      clinicianBrief:
        "Answer ALPINE questions as relapsed/refractory CLL/SLL head-to-head evidence versus ibrutinib.",
      keyFacts: [
        "ALPINE is the BRUKINSA relapsed/refractory CLL/SLL head-to-head evidence anchor on the HCP site.",
        "The HCP source frames ALPINE as BRUKINSA versus ibrutinib after prior systemic therapy.",
        "ORR and PFS information are used to support HCP discussion of comparative evidence.",
      ],
      caveats: ["Use the source page for exact current numeric results and caveats."],
      answerDirective:
        "Keep the answer scoped to ALPINE and relapsed/refractory CLL/SLL unless the participant asks about first-line SEQUOIA.",
      preferredSourceIds: ["brukinsa-cll-alpine", "alpine"],
      preferredAssetTags: ["alpine", "ibrutinib", "cll", "orr", "pfs"],
    };
  }

  if (topic === "brukinsa_safety_management") {
    return {
      id: "brukinsa-safety-management",
      title: "BRUKINSA Safety, Dosing, and Medication Management",
      topic,
      clinicianBrief:
        "Answer BRUKINSA safety and medication-management questions with the specific safety, dosing, drug-interaction, or resource angle raised.",
      keyFacts: [
        "BRUKINSA HCP resources cover tablet formulation, dosing schedule, dose reduction or modification, drug-interaction considerations, and hepatic impairment.",
        "Important Safety Information topics include hemorrhage, infections, cytopenias, second primary malignancies, cardiac arrhythmias, hepatotoxicity, embryo-fetal toxicity, and common adverse reactions or lab abnormalities.",
        "Resource materials can include patient education, patient-management materials, dosing and administration resources, brochures, and access-support references.",
      ],
      caveats: ["Do not provide patient-specific treatment advice."],
      answerDirective:
        "Answer the named safety or workflow issue first and keep disease-area scope stable unless the participant asks to compare.",
      preferredSourceIds: ["brukinsa-safety-management", "brukinsa-resources"],
      preferredAssetTags: ["safety", "dosing", "drug interaction", "resources", "patient management"],
    };
  }

  if (chunks.length === 0) {
    return null;
  }

  return {
    id: `${input.surveySlug}-ad-hoc`,
    title: "Source-Grounded Clinical Answer",
    topic,
    clinicianBrief:
      "Answer the participant's specific in-domain question from the most relevant cited material without exposing retrieval mechanics.",
    keyFacts: chunks.slice(0, 3).map((chunk) => compactClinicalFact(chunk.text)),
    caveats: [],
    answerDirective:
      "Lead with the direct answer. Use only the cited material. Do not say source areas, snippets, knowledge base, or available here.",
    preferredSourceIds: chunks.slice(0, 3).map((chunk) => chunk.id),
    preferredAssetTags: tokens(
      [participant, sourceContext, selectedQuestion, chunks[0]?.tags.join(" ")].join(
        " ",
      ),
    ).slice(0, 12),
  };
}

function chunkEvidenceCardScore(
  chunk: ControlledRagChunk,
  evidenceCard: ClinicalEvidenceCard | null,
) {
  if (!evidenceCard) {
    return 0;
  }

  const haystack = chunkHaystack(chunk);
  const normalizedId = normalizeText(chunk.id);
  const normalizedTitle = normalizeText(chunk.title);
  let score = 0;

  evidenceCard.preferredSourceIds.forEach((sourceId, index) => {
    const needle = normalizeText(sourceId);
    if (
      needle.length > 0 &&
      (normalizedId.includes(needle) ||
        normalizedTitle.includes(needle) ||
        haystack.includes(needle))
    ) {
      score += 1000 - index * 80;
    }
  });

  evidenceCard.preferredAssetTags.forEach((tag) => {
    const needle = normalizeText(tag);
    if (needle.length > 0 && haystack.includes(needle)) {
      score += 15;
    }
  });

  return score;
}

function orderChunksForEvidenceCard(
  chunks: ControlledRagChunk[],
  evidenceCard: ClinicalEvidenceCard | null,
) {
  if (!evidenceCard) {
    return chunks;
  }

  return chunks
    .map((chunk, index) => ({
      chunk,
      score: chunkEvidenceCardScore(chunk, evidenceCard),
      index,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((match) => match.chunk);
}

function scoreNubeqaTopicText(text: string, topic: DisplayTopic) {
  if (!topic?.startsWith("nubeqa_")) {
    return 0;
  }

  const safetyProfile = textMatchesAny(text, [
    /\bnubeqa safety dosing and ddi profile\b/,
    /\bsafety dosing and ddi\b/,
  ]);
  const aranoteSource = textMatchesAny(text, [
    /\bnubeqa mcspc efficacy aranote\b/,
    /\baranote\b.*\b(?:rpfs|radiographic progression|radiological progression|progression free|progression-free|study design|endpoint|treatment duration|efficacy)\b/,
    /\b(?:rpfs|radiographic progression|radiological progression|progression free|progression-free|study design|endpoint|treatment duration|efficacy)\b.*\baranote\b/,
  ]);
  const arasensSource = textMatchesAny(text, [
    /\bnubeqa mcspc efficacy arasens\b/,
    /\barasens\b.*\b(?:overall survival|survival|\bos\b|time to mcrpc|risk of death|docetaxel|triplet|secondary endpoint|study design|efficacy)\b/,
    /\b(?:overall survival|survival|\bos\b|time to mcrpc|risk of death|docetaxel|triplet|secondary endpoint|study design|efficacy)\b.*\barasens\b/,
  ]);
  const aramisSource = textMatchesAny(text, [
    /\bnubeqa nmcrpc efficacy aramis\b/,
    /\baramis\b.*\b(?:metastasis free|metastasis-free|\bmfs\b|overall survival|\bos\b|nmcrpc|non metastatic|non-metastatic|psadt|study design|efficacy)\b/,
    /\b(?:metastasis free|metastasis-free|\bmfs\b|overall survival|\bos\b|nmcrpc|non metastatic|non-metastatic|psadt|study design|efficacy)\b.*\baramis\b/,
  ]);
  const safetySource = textMatchesAny(text, [
    /\b(?:safety|adverse|reaction|reactions|toxicity|tolerability|dosing|dose|dose modification|twice daily|food|renal|hepatic|ddi|drug interaction|ischemic|seizure)\b/,
  ]);
  const guidelineSource = textMatchesAny(text, [
    /\b(?:guideline|guidelines|nccn|aua|access|support|resources|practice|formulary|coverage|representative)\b/,
  ]);
  const patientFitSource = textMatchesAny(text, [
    /\b(?:patient|profile|fit|appropriate|candidate|eligible|cautious|caution|older|frail|comorbidity|docetaxel fit|mspc|mcspc|mhspc|nmcrpc)\b/,
  ]);
  const studySource = aranoteSource || arasensSource || aramisSource;
  let score = 0;

  if (topic === "nubeqa_mcspc_aranote") {
    if (aranoteSource) {
      score += 2600;
    }
    if (safetySource && !aranoteSource) {
      score -= safetyProfile ? 2600 : 1600;
    }
    if (arasensSource || aramisSource) {
      score -= 1100;
    }
  }

  if (topic === "nubeqa_mcspc_arasens") {
    if (arasensSource) {
      score += 2600;
    }
    if (safetySource && !arasensSource) {
      score -= safetyProfile ? 2600 : 1600;
    }
    if (aranoteSource || aramisSource) {
      score -= 1100;
    }
  }

  if (topic === "nubeqa_nmcrpc_aramis") {
    if (aramisSource) {
      score += 2600;
    }
    if (safetySource && !aramisSource) {
      score -= safetyProfile ? 2600 : 1600;
    }
    if (aranoteSource || arasensSource) {
      score -= 1100;
    }
  }

  if (topic === "nubeqa_safety_dosing") {
    if (safetySource) {
      score += safetyProfile ? 2600 : 1900;
    }
    if (studySource && !safetySource) {
      score -= 1100;
    }
  }

  if (topic === "nubeqa_guidelines_resources") {
    if (guidelineSource) {
      score += 2100;
    }
    if (safetyProfile && !guidelineSource) {
      score -= 900;
    }
  }

  if (topic === "nubeqa_patient_selection") {
    if (patientFitSource) {
      score += 1100;
    }
    if (studySource) {
      score += 650;
    }
    if (safetyProfile && !patientFitSource) {
      score -= 500;
    }
  }

  return score;
}

function displayTopicChunkScore(chunk: ControlledRagChunk, topic: DisplayTopic) {
  return scoreNubeqaTopicText(chunkHaystack(chunk), topic);
}

function displayTopicAssetScore(
  asset: ControlledRagAsset,
  topic: DisplayTopic,
) {
  if (!topic) {
    return 0;
  }

  const text = assetSearchText(asset);
  const kind = asset.assetKind.toUpperCase();
  const isVisual = ["CHART", "TABLE", "IMAGE"].includes(kind);
  const isPdf = kind === "PDF" || /\.pdf(?:$|[?#])/i.test(asset.url);
  const padcevSafetyTopic =
    topic?.startsWith("padcev_safety") ||
    topic === "padcev_neuropathy_management" ||
    topic === "padcev_dose_modification";
  const padcevEfficacyTopic =
    topic === "padcev_ev302_response" ||
    topic === "padcev_ev302_survival";
  const padcevSafetyAsset = textMatchesAny(text, [
    /\b(?:safety|adverse|side effect|toxicity|monitoring|checklist|guide|resource|resources|dose modification|dose modifications|dose reduction|dose interruption|withhold|resume|discontinue|neuropathy|rash|skin|hyperglycemia|pneumonitis|ild|ocular|extravasation|patient education|counseling)\b/,
  ]);
  const padcevEfficacyAsset = textMatchesAny(text, [
    /\b(?:overall survival|progression free|progression-free|\bpfs\b|\bos\b|efficacy|ev 302|ev302|keynote|orr|complete response|partial response|response rate|hazard ratio|kaplan|curve)\b/,
    /\b(?:ev-302|keynote-a39)\b/,
  ]);
  let score = 0;

  if (isVisual) {
    score += 700;
  }

  if (isPdf) {
    score += 80;
  }

  if (
    textMatchesAny(text, [
      /\b(?:hero|lifestyle|campaign|airplane|aircraft|plane|jet|flight|travel|splash|product shot|pill|tablet|capsule|stays on|stays off|up to 100)\b/,
    ])
  ) {
    score -= 1400;
  }

  if (
    topic === "padcev_ev302_response" &&
    textMatchesAny(text, [
      /\b(?:ev 302|ev302|keynote a39|keynote)\b/,
      /\b(?:ev-302|keynote-a39)\b/,
      /\b(?:orr|overall response|response rate|complete response|partial response|cr|pr|recist)\b/,
    ])
  ) {
    score += 1600;
  }

  if (
    topic === "padcev_ev302_survival" &&
    textMatchesAny(text, [
      /\b(?:ev 302|ev302|keynote a39|keynote)\b/,
      /\b(?:ev-302|keynote-a39)\b/,
      /\b(?:overall survival|survival|os|progression free|progression-free|pfs|hazard ratio|kaplan|km|curve)\b/,
    ])
  ) {
    score += 1600;
  }

  if (
    topic === "padcev_neuropathy_management" &&
    textMatchesAny(text, [
      /\b(?:neuropathy|peripheral neuropathy|\bpn\b|numbness|tingling|muscle weakness)\b/,
      /\b(?:dose modification|dose reduction|withhold|resume|discontinue|monitoring|checklist|patient education|informational resource)\b/,
    ])
  ) {
    score += 1800;
  }

  if (
    topic === "padcev_dose_modification" &&
    textMatchesAny(text, [
      /\b(?:dose modification|dose modifications|dose reduction|dose interruption|withhold|resume|discontinue|recommended dose reduction schedule|dose modifications table)\b/,
    ])
  ) {
    score += 1700;
  }

  if (
    topic === "padcev_safety_resources" &&
    textMatchesAny(text, [
      /\b(?:resource|resources|guide|checklist|monitoring|patient education|counseling|support|adverse reaction management|informational resource)\b/,
    ])
  ) {
    score += 1500;
  }

  if (
    topic === "padcev_safety_management" &&
    textMatchesAny(text, [
      /\b(?:safety|adverse|side effect|toxicity|monitoring|dose modification|neuropathy|rash|skin|hyperglycemia|pneumonitis|ild|ocular|extravasation|checklist|management)\b/,
    ])
  ) {
    score += 1200;
  }

  if (
    topic === "nubeqa_mcspc_aranote" &&
    textMatchesAny(text, [
      /\b(?:aranote|mcspc|mhspc|adt)\b/,
      /\b(?:rpfs|radiographic progression|radiological progression|progression free|progression-free|risk of progression)\b/,
    ])
  ) {
    score += 1700;
  }

  if (
    topic === "nubeqa_mcspc_arasens" &&
    textMatchesAny(text, [
      /\b(?:arasens|docetaxel|triplet|mcspc|mhspc)\b/,
      /\b(?:overall survival|survival|\bos\b|risk of death|time to mcrpc|secondary endpoint)\b/,
    ])
  ) {
    score += 1700;
  }

  if (
    topic === "nubeqa_nmcrpc_aramis" &&
    textMatchesAny(text, [
      /\b(?:aramis|nmcrpc|non metastatic|non-metastatic)\b/,
      /\b(?:metastasis free|metastasis-free|\bmfs\b|overall survival|\bos\b|psadt|time to pain)\b/,
    ])
  ) {
    score += 1700;
  }

  if (
    topic === "nubeqa_safety_dosing" &&
    textMatchesAny(text, [
      /\b(?:safety|adverse|reaction|reactions|dosing|dose|dose modification|twice daily|food|renal|hepatic|ddi|drug interaction|ischemic|seizure)\b/,
    ])
  ) {
    score += 1500;
  }

  if (
    topic === "nubeqa_guidelines_resources" &&
    textMatchesAny(text, [
      /\b(?:guideline|guidelines|nccn|aua|access|support|resources|practice|formulary|coverage|representative)\b/,
    ])
  ) {
    score += 1500;
  }

  if (
    topic === "nubeqa_patient_selection" &&
    textMatchesAny(text, [
      /\b(?:patient|profile|fit|appropriate|cautious|caution|eligible|older|frail|docetaxel|renal|hepatic|cardiac|nmcrpc|mcspc)\b/,
    ])
  ) {
    score += 1100;
  }

  if (
    topic?.startsWith("nubeqa_mcspc") ||
    topic === "nubeqa_nmcrpc_aramis"
  ) {
    if (
      textMatchesAny(text, [
        /\b(?:adverse reactions|safety|dose modification|dosing|ddi|renal|hepatic|ischemic|seizure)\b/,
      ])
    ) {
      score -= 300;
    }
  }

  if (
    topic === "nubeqa_safety_dosing" ||
    topic === "nubeqa_guidelines_resources"
  ) {
    if (
      textMatchesAny(text, [
        /\b(?:overall survival|metastasis free|metastasis-free|\bmfs\b|\bos\b|\brpfs\b|risk of death|risk of progression)\b/,
      ])
    ) {
      score -= 250;
    }
  }

  score += scoreNubeqaTopicText(text, topic);

  if (padcevEfficacyTopic && padcevSafetyAsset && !padcevEfficacyAsset) {
    score -= 1100;
  }

  if (padcevSafetyTopic && padcevEfficacyAsset && !padcevSafetyAsset) {
    score -= 1300;
  }

  return score;
}

function rankAssetsForDisplay(
  assets: ControlledRagAsset[],
  queryTokens: string[],
  topic: DisplayTopic,
) {
  if (!topic) {
    return rankAssets(assets, queryTokens);
  }

  const seen = new Set<string>();

  return [...assets]
    .map((asset) => {
      const genericScore = scoreAsset(asset, queryTokens);
      const displayScore = displayTopicAssetScore(asset, topic);
      const score = genericScore + displayScore;

      return {
        asset: {
          ...asset,
          priority:
            displayScore > 0
              ? Math.max(asset.priority, Math.round(score))
              : asset.priority,
        },
        score,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(({ asset }) => {
      if (seen.has(asset.url)) {
        return false;
      }
      seen.add(asset.url);
      return true;
    })
    .slice(0, 8)
    .map(({ asset }) => asset);
}

function rankAssets(assets: ControlledRagAsset[], queryTokens: string[], contextTokens: string[] = []) {
  const seen = new Set<string>();

  return [...assets]
    .map((asset) => ({ asset, score: scoreAsset(asset, queryTokens) - scoreAsset(asset, []), contextScore: scoreAsset(asset, contextTokens) - scoreAsset(asset, []), base: scoreAsset(asset, []) }))
    .filter(({ score, contextScore }) => score > 0 || contextScore > 0)
    .sort((left, right) => right.score - left.score || right.contextScore - left.contextScore || right.base - left.base)
    .filter(({ asset }) => {
      if (seen.has(asset.url)) {
        return false;
      }
      seen.add(asset.url);
      return true;
    })
    .slice(0, 8)
    .map(({ asset }) => asset);
}

async function databaseChunks(input: ControlledRagSurveyTurnInput) {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  try {
    const searchQuery = sourceContentSearchSql(input.participantMessage, input.surveySlug, input.sourceTopicContext);
    if (!searchQuery) return [];
    const matches = await prisma.$queryRaw<Array<{ id: string }>>(searchQuery);
    if (!matches.length) return [];
    const chunks = await prisma.sourceChunk.findMany({
      where: {
        id: { in: matches.map((match) => match.id) },
        surveySlug: input.surveySlug,
        sourceDocument: {
          status: "ACTIVE",
        },
      },
      take: 80,
      include: {
        sourceDocument: {
          select: {
            id: true,
            title: true,
            description: true,
            url: true,
            tags: true,
            priority: true,
            assets: {
              where: {
                assetKind: {
                  in: ["CHART", "TABLE", "PDF", "IMAGE", "LINK"],
                },
              },
              orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
              take: 12,
              select: {
                title: true,
                description: true,
                assetKind: true,
                url: true,
                tags: true,
                priority: true,
              },
            },
          },
        },
      },
    });
    const matchOrder = new Map(matches.map((match, index) => [match.id, index]));
    return chunks.sort((left, right) => (matchOrder.get(left.id) ?? 80) - (matchOrder.get(right.id) ?? 80)).map(
      (chunk) =>
        ({
          id: `db:${chunk.id}`,
          surveySlug: input.surveySlug,
          title: chunk.sourceDocument.title,
          description: chunk.sourceDocument.description ?? "",
          url: chunk.sourceDocument.url ?? "",
          tags: Array.from(
            new Set([...chunk.tags, ...chunk.sourceDocument.tags]),
          ),
          text: chunk.content,
          assets: chunk.sourceDocument.assets.map((asset) => ({
              ...asset,
              assetKind: asset.assetKind,
            })),
        }) satisfies ControlledRagChunk,
    );
  } catch {
    // A failed library read is different from a successful query with no
    // matches. Keep the fallback available without logging queries or secrets.
    console.warn({ event: "source_library_retrieval_failed", surveySlug: input.surveySlug });
    return [];
  }
}

export async function retrieveWebsiteCandidates(input: ControlledRagSurveyTurnInput) {
  const queryTokenGroups = retrievalTokenGroups(input);
  const displayTopic = displayTopicForTurn(input);
  const focusedEvidenceId = focusedNubeqaEvidenceId(input);
  const activeDatabaseChunks = await databaseChunks(input);
  const candidateChunks = [
    ...activeDatabaseChunks,
    ...CONTROLLED_RAG_CHUNKS.filter(
      (chunk) => chunk.surveySlug === input.surveySlug,
    ),
  ];

  const rankedCandidates = candidateChunks
    .map((chunk) => ({
      chunk,
      score:
        scoreChunk(chunk, queryTokenGroups) +
        displayTopicChunkScore(chunk, displayTopic) +
        // An exact, trial-scoped question must retain its vetted fact card
        // even when the broader display topic is ARANOTE efficacy or dosing.
        (chunk.id === focusedEvidenceId ? 6000 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .map((match) => match.chunk);
  // Preserve the approved catalog alongside retrieved library excerpts, so
  // keyword-poor paraphrases can still be resolved by semantic selection.
  const curatedIds = new Set(candidateChunks.filter((chunk) => !chunk.id.startsWith("db:")).map((chunk) => chunk.id));
  // Preserve the content-ranked library order, not just its membership.
  // Inherited tags and broad evidence cards must not promote an introductory
  // document fragment ahead of the passage that actually matches the query.
  // A site index contains many passages from the same page and repeats that
  // page's asset catalog. Prefer diverse pages, with a bounded second passage
  // only when fewer pages match. Keep the best content-search order intact.
  const pageCounts = new Map<string, number>();
  const diverse: ControlledRagChunk[] = []; const additional: ControlledRagChunk[] = [];
  for (const source of activeDatabaseChunks) {
    const key = source.url || source.id;
    const count = pageCounts.get(key) ?? 0; pageCounts.set(key, count + 1);
    if (!count) diverse.push(source); else if (count === 1) additional.push(source);
  }
  // Current-message relevance takes precedence; history only breaks ties.
  // Keep contextual candidates for anaphoric follow-ups without letting a
  // long prior request outweigh a short explicit topic correction.
  const assetTerms = sourceContentSearchTerms(input.participantMessage, input.surveySlug);
  const contextAssetTerms = sourceContentSearchTerms(input.sourceTopicContext ?? "", input.surveySlug);
  return [
    ...[...diverse, ...additional].slice(0, Math.min(8, Math.max(0, 24 - curatedIds.size))).map(source => ({ ...source,
      assets: rankAssets(source.assets ?? [], assetTerms, contextAssetTerms).slice(0, 3),
    })),
    ...rankedCandidates.filter((chunk) => curatedIds.has(chunk.id)),
  ].slice(0, 24);
}

const retrieveChunks = retrieveWebsiteCandidates;

function referencesForChunks(
  chunks: ControlledRagChunk[],
  _turnAssets: ControlledRagAsset[] = [],
  _queryTokens: string[] = [],
) {
  return chunks.map(
    (chunk) =>
      withExplicitSourceAssets({
        citationId: `rag:${chunk.id}`,
        title: chunk.title,
        url: chunk.url || null,
        description: chunk.description || null,
        assets: chunk.assets ?? [],
      }),
  );
}

function sourceSummary(chunks: ControlledRagChunk[]) {
  return chunks
    .map((chunk, index) => {
      const marker = `[${index + 1}]`;
      return `${chunk.text} ${marker}`;
    })
    .join("\n\n");
}

function selectedQuestionLead(
  question: string | null,
  responseMode: "answer_only" | "answer_then_ask",
) {
  if (responseMode === "answer_only") {
    return "";
  }

  return question
    ? `\n\n${question}`
    : "\n\nThank you for participating. Your feedback has been recorded, and we can close the interview here.";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComposerFollowUpQuestions(
  answer: string,
  selectedQuestion: string | null,
  responseMode: "answer_only" | "answer_then_ask",
) {
  if (responseMode !== "answer_then_ask") {
    return answer.trim();
  }

  let cleaned = answer.trim();

  if (selectedQuestion) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(selectedQuestion), "gi"), "");
  }

  return stripQuestionSentences(cleaned);
}

function fallbackSourceAnswer(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
  evidenceCard: ClinicalEvidenceCard | null,
) {
  if (evidenceCard) {
    const marker = citationMarkerForCard(chunks, evidenceCard);
    const factLimit =
      evidenceCard.id === "nubeqa-positioning-overview" ||
      evidenceCard.id === "nubeqa-patient-selection" ||
      input.responseMode === "answer_only"
        ? 3
      : 2;
    const isAdHocCard = evidenceCard.id.endsWith("-ad-hoc");
    const factEntries = evidenceCard.keyFacts.map((fact, index) => ({
      fact,
      originalIndex: index,
    }));
    const selectedFactEntries =
      evidenceCard.id === "nubeqa-safety-dosing" &&
      asksAboutNubeqaDrugInteractions(input)
        ? [factEntries[4], factEntries[5], factEntries[0]]
            .filter(Boolean)
            .slice(0, Math.max(factLimit, 2))
        : factEntries.slice(0, factLimit);
    const body = selectedFactEntries
      .map(({ fact, originalIndex }, outputIndex) => {
        const factMarker = isAdHocCard
          ? `[${Math.min(outputIndex + 1, chunks.length)}]`
          : citationMarkerForCardFact(
              chunks,
              evidenceCard,
              originalIndex,
              outputIndex,
            );
        return `${compactClinicalFact(fact)} ${factMarker}`;
      })
      .join(" ");
    const caveat = nonInstructionalCaveats(evidenceCard.caveats)[0]
      ? ` ${nonInstructionalCaveats(evidenceCard.caveats)[0]} ${marker}`
      : "";

    return `${body}${caveat}`.trim();
  }

  const alreadyCovered = input.recentInterviewerContext
    ? `Building on what we already covered, here is the narrower source detail.\n\n`
    : "";

  return [alreadyCovered, sourceSummary(chunks)].join("").trim();
}

function ensureCitationMarker(answer: string, chunks: ControlledRagChunk[], firstSourceIndex = 1) {
  if (/\[\d+\]/.test(answer) || chunks.length === 0) {
    return answer;
  }

  return `${answer.trimEnd()} [${firstSourceIndex}]`;
}

function lowerFirstPlainWord(value: string) {
  return value.replace(/^([A-Z])(?=[a-z])/, (letter) =>
    letter.toLowerCase(),
  );
}

function removeParticipantVoiceMirror(answer: string) {
  const leadingFamiliarityMirror =
    /^\s*I(?:'m| am)\s+(?:not\s+)?(?:very\s+)?familiar(?:\s+with\s+[^.]+)?\.\s*/i;
  const match = answer.match(leadingFamiliarityMirror);

  if (!match) {
    return answer;
  }

  const rest = answer.slice(match[0].length).trimStart();
  if (!rest) {
    return "The source materials provide the following context.";
  }

  return lowerFirstPlainWord(
    rest.replace(/^from the source material,?\s*/i, ""),
  );
}

function removeInternalSourceNarration(answer: string) {
  return answer
    .replace(
      /^\s*I can orient(?: you)?\s+(?:on|to|around)\s+(?:the\s+)?(?:main\s+)?source\s+areas(?:\s+for\s+([a-z0-9+/-]+))?\s*:\s*/i,
      (_match, brand: string | undefined) =>
        brand ? `For ${brand.toUpperCase()}, ` : "The HCP materials frame the evidence around ",
    )
    .replace(/\bUse the source page for exact current [^.]+\.?/gi, "")
    .replace(/\bUse source page detail for exact current [^.]+\.?/gi, "")
    .replace(
      /\bIf the cited material does not answer the exact question,?[^.]+\.?/gi,
      "",
    )
    .replace(
      /^\s*I can orient(?: you)?\s+(?:on|to|around)\s+the\s+source\s+areas\s+available\s+here:\s*/i,
      "The HCP materials frame the evidence around ",
    )
    .replace(
      /^\s*I can orient(?: you)?\s+(?:on|to|around)\s+available\s+source\s+areas:\s*/i,
      "The HCP materials frame the evidence around ",
    )
    .replace(/^\s*I can orient(?: you)?\s+briefly[:,]?\s*/i, "")
    .replace(/^\s*For context[:,]?\s*/i, "")
    .replace(/^\s*From the source material,?\s*/i, "")
    .replace(
      /\bsource\s+areas\s+available\s+here\b/gi,
      "approved HCP evidence areas",
    )
    .replace(
      /\bthe\s+provided\s+source\s+snippets\s+do\s+not\s+include\b/gi,
      "the cited HCP material does not include",
    )
    .replace(
      /\bthe\s+provided\s+snippets\s+do\s+not\s+include\b/gi,
      "the cited HCP material does not include",
    )
    .replace(
      /\bthe\s+provided\s+source\s+snippets\s+do\s+not\s+(give|provide)\b/gi,
      (_match, verb: string) => `the cited HCP material does not ${verb}`,
    )
    .replace(
      /\bthe\s+provided\s+snippets\s+do\s+not\s+(give|provide)\b/gi,
      (_match, verb: string) => `the cited HCP material does not ${verb}`,
    )
    .replace(
      /\bthe\s+source\s+snippets\s+are\s+thin\b/gi,
      "the cited HCP material is limited",
    )
    .replace(
      /\bsource\s+snippets\s+are\s+thin\b/gi,
      "the cited HCP material is limited",
    )
    .replace(/\bprovided\s+source\s+snippets\b/gi, "cited HCP material")
    .replace(/\bprovided\s+snippets\b/gi, "cited HCP material")
    .replace(/\bsource\s+snippets\b/gi, "cited HCP material")
    .replace(/\bthe\s+provided\s+sources\b/gi, "the cited HCP materials")
    .replace(/\bprovided\s+sources\b/gi, "cited HCP materials")
    .replace(/\bthe\s+source\s+set\b/gi, "the cited materials")
    .replace(/\bsource\s+set\b/gi, "cited materials")
    .replace(/\bknowledge\s+base\b/gi, "approved HCP material");
}

function cleanClinicalAnswer(answer: string) {
  return removeInternalSourceNarration(
    removeParticipantVoiceMirror(answer),
  ).trim();
}

const SOURCE_EXPLANATION_UNAVAILABLE = "I couldn't verify a clear explanation from the cited information. You can open the sources below, ask a follow-up, or continue the survey.";

async function composeSourceAnswer(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
  evidenceCard: ClinicalEvidenceCard | null,
  resolvedSourceQuestion: string,
) {
  const gateway = getOptionalOpenAIGateway();
  const fallbackInput = { ...input, participantMessage: resolvedSourceQuestion };

  if (process.env.NODE_ENV === "test") {
    return { available: true, answer: cleanClinicalAnswer(fallbackSourceAnswer(fallbackInput, chunks, evidenceCard)), grounding: null, outcome: sourceTurnOutcome("success") };
  }
  if (!gateway) return { available: false, answer: SOURCE_EXPLANATION_UNAVAILABLE, grounding: null, outcome: sourceTurnOutcome("configuration_failure") };

  try {
    const composition = await gateway.composeControlledRagAnswer({
      surveySlug: input.surveySlug,
      participantMessage: input.participantMessage,
      resolvedSourceQuestion,
      sourceTopicContext: input.sourceTopicContext?.trim().slice(0, 6000) || null,
      sourceQuestionPlan: input.sourceQuestionPlan ?? null,
      presentationPlan: input.presentationPlan,
      recentTurns: input.recentTurns ?? [],
      surveyContext: input.surveyContext,
      currentQuestion: input.currentQuestion,
      selectedNextQuestion: input.selectedNextQuestion,
      selectedQuestionSourceContext: input.selectedQuestionSourceContext,
      recentInterviewerContext: input.recentInterviewerContext ?? null,
      responseMode: input.responseMode ?? "answer_then_ask",
      clinicalEvidenceCard: evidenceCard
        ? {
            id: evidenceCard.id,
            title: evidenceCard.title,
            topic: evidenceCard.topic,
            clinicianBrief: evidenceCard.clinicianBrief,
            keyFacts: evidenceCard.keyFacts,
            caveats: evidenceCard.caveats,
            answerDirective: evidenceCard.answerDirective,
            preferredSourceIds: evidenceCard.preferredSourceIds,
            preferredAssetTags: evidenceCard.preferredAssetTags,
          }
        : null,
      sources: chunks.map((chunk, index) => ({
        index: index + 1,
        title: chunk.title,
        url: chunk.url || null,
        // Search metadata is not clinical evidence. Only the selected exact
        // source text may supply facts to the composer.
        description: null,
        tags: [],
        text: compact(chunk.text, 1500),
        evidenceRole: chunk.evidenceRole ?? "direct",
        contribution: chunk.contribution,
      })),
    });

    const usedIndexes = composition.result.usedSourceIndexes ?? chunks.map((_chunk, index) => index + 1);
    // Match the engine's reviewed text, including independently cited limitations.
    // Legacy narration cleanup can change scope or remove a reviewed qualifier.
    const reviewedText = [
      composition.result.answerBody,
      composition.result.limitations?.length ? composition.result.limitations.join("\n") : null,
    ].filter(Boolean).join("\n\n");
    const body = normalizeSourceCitationMarkers(reviewedText.trim(), chunks.length);
    if (!usedIndexes.length || usedIndexes.some((index) => index < 1 || index > chunks.length) ||
      [...body.matchAll(/\[(\d+)\]/g)].some((match) => !usedIndexes.includes(Number(match[1])))) {
      throw new Error("Composer cited evidence outside its selected sources.");
    }
    const answer = ensureCitationMarker(
      body,
      chunks,
      usedIndexes[0],
    );
    const grounding = "groundingReview" in composition ? sourceAnswerGroundingAuditSchema.parse(composition.groundingReview) : null;
    return { available: true, answer, grounding, outcome: sourceTurnOutcome("success", composition) };
  } catch (error) {
    logSyntheticGroundingDiagnostics(input.surveyContext, error);
    const outcome = sourceTurnOutcome("composition_failure", error);
    console.warn(JSON.stringify({ event: "source_answer_composition_failed", outcome }));
    const recovery = recoverSelectedSourceExcerpt(chunks, outcome,
      input.sourceQuestionPlan?.answerApproach === "contextual_explanation" || chunks.some((chunk) => chunk.contribution === "requested_context"));
    if (recovery) return { available: true, answer: recovery.answer, grounding: null, outcome: recovery.outcome, recoveredSource: recovery.source };
    return { available: false, answer: SOURCE_EXPLANATION_UNAVAILABLE, grounding: null, outcome };
  }
}

export async function askControlledRagForSurveyInterviewerTurn(
  input: ControlledRagSurveyTurnInput,
): Promise<ControlledRagSurveyTurnResult> {
  input = { ...input, presentationPlan: sourcePresentationForTurn(input.presentationPlan, input.participantMessage, input.recentTurns) };
  const original = sourceTurnInputs(input);
  const parsedPacket = moderatorEvidencePacketSchema.safeParse(input.evidencePacket);
  const retained = parsedPacket.success && parsedPacket.data.sources.every((source) => source.surveySlug === input.surveySlug)
    ? parsedPacket.data : null;
  const pureClarification = input.responseMode === "answer_only" && isReferentialClarification(input.participantMessage);
  const recentTurns = (input.recentTurns ?? []).slice(-24).map((turn) => ({ ...turn, content: turn.content.slice(0, 12000) }));
  // The moderator already selected and resolved this standalone priority from
  // participant evidence. A second interpretation cannot improve its authority.
  // Participant follow-ups still receive the full contextual planning boundary.
  const sourceQuestionPlan: SourceQuestionPlan | null = input.requestOrigin === "selected_priority"
    ? sourceQuestionPlanSchema.parse({ version: 1, interpretedQuestion: original.retrievalQuery, retrievalQueries: [original.retrievalQuery],
        answerApproach: "direct", usesSourceContext: false, contextBoundary: null,
        rationale: "Use the application-selected priority directly; preserve its participant-derived scope." })
    : input.sourceQuestionPlan
    ? sourceQuestionPlanSchema.parse(input.sourceQuestionPlan)
    : input.responseMode === "answer_only" && !(pureClarification && retained)
    ? await planSourceQuestion({ surveySlug: input.surveySlug, participantMessage: input.participantMessage.slice(0, 12000),
        sourceTopicContext: input.sourceTopicContext?.trim().slice(0, 6000) || null, recentTurns, presentationPlan: input.presentationPlan })
    : null;
  // Search planning can expand retrieval terms, but cannot redefine the
  // application-selected question used for selection, composition or review.
  const resolvedSourceQuestion = original.retrievalQuery;
  const retrievalInput = original.retrievalInput;
  const dependentQuestion = input.responseMode === "answer_only" &&
    (sourceQuestionPlan?.usesSourceContext ?? hasBackwardSourceReference(input.participantMessage));
  const priorSources = dependentQuestion ? retained?.sources ?? [] : [];
  const sourceTopicContext = dependentQuestion
    ? input.sourceTopicContext?.trim() || priorSources.map((source) => source.title).join("; ") || null
    : null;
  const contextualCompositionInput = { ...original.compositionInput, recentTurns, sourceQuestionPlan,
    sourceTopicContext: pureClarification ? input.sourceTopicContext : sourceTopicContext };
  let chunks: ControlledRagChunk[];
  let evidenceCard: ClinicalEvidenceCard | null;
  let websiteAnswer: Awaited<ReturnType<typeof answerFromWebsite>> = null;
  const narrowRetainedPresentation = pureClarification && retained && (input.presentationPlan?.maxFacts ?? Infinity) <= 2;
  if (pureClarification && retained) {
    // Simplification selects useful complete facts from original evidence,
    // rather than asking composition to compress every prior monitoring case.
    // No retrieval or generated interviewer text can supply new facts here.
    const lastSourceAnswer = [...recentTurns].reverse().find((turn) => turn.role === "interviewer" && /\[\d+\]/.test(turn.content))?.content
      ?? [...(input.recentInterviewerContext ?? "").matchAll(/(?:^|\n)interviewer:\s*([\s\S]*?)(?=\n(?:participant|interviewer):|$)/gi)]
        .reverse().find((match) => /\[\d+\]/.test(match[1]))?.[1]?.trim()
      ?? null;
    const requestedContextIds = new Set(retained.sources.filter((source) => source.contribution === "requested_context").map((source) => source.id));
    // A style-only request retains the practical information angle already
    // selected. The original relationship remains in the durable packet, but
    // must not displace the requested detail during this shorter presentation.
    const presentationCandidates = requestedContextIds.size
      ? retained.sources.filter((source) => requestedContextIds.has(source.id) || source.contribution === "essential_qualification")
      : retained.sources;
    websiteAnswer = await answerFromWebsite({ surveySlug: input.surveySlug, query: input.participantMessage.slice(0, 4000),
      candidates: presentationCandidates, sourceTopicContext: resolvedSourceQuestion.slice(0, 6000),
      sourceQuestionPlan, presentationPlan: input.presentationPlan, priorSourceIds: presentationCandidates.map(source => source.id), evidenceFocus: "all",
      presentationContext: { version: 1, kind: "simplify_previous_answer", participantRequest: input.participantMessage.slice(0, 12000), lastSourceAnswer: lastSourceAnswer?.slice(0, 12000) ?? null } });
    chunks = websiteAnswer ? websiteAnswer.chunks : narrowRetainedPresentation ? (await selectFocusedSourceEvidence({
      surveySlug: input.surveySlug, query: input.participantMessage, candidates: presentationCandidates,
      sourceTopicContext: resolvedSourceQuestion, priorSourceIds: presentationCandidates.map((source) => source.id),
      presentationPlan: input.presentationPlan,
      presentationContext: { version: 1, kind: "simplify_previous_answer", participantRequest: input.participantMessage.slice(0, 12000), lastSourceAnswer: lastSourceAnswer?.slice(0, 12000) ?? null },
      fallbackSourceIds: [],
    })).chunks.map((source) => requestedContextIds.has(source.id) ? { ...source, contribution: "requested_context" as const } : source) : retained.sources;
    evidenceCard = null;
  } else {
  const retrievalQueries = sourceQuestionPlan?.retrievalQueries ?? [resolvedSourceQuestion];
  const retrievalGroups = await Promise.all(retrievalQueries.map((query) => retrieveChunks({ ...retrievalInput, participantMessage: query })));
  // Interleave searches so a complementary query has room beside the original
  // relation. Keep the curated catalog and bound the selector input to 24.
  const fullSources = new Map(retrievalGroups.flat().map((chunk) => [chunk.id, chunk]));
  const candidates: ControlledRagChunk[] = [];
  const add = (chunk: ControlledRagChunk) => {
    if (candidates.length < 24 && !candidates.some((candidate) => candidate.id === chunk.id)) candidates.push(chunk);
  };
  for (const source of priorSources) add(fullSources.get(source.id) ?? source);
  const curated = [...fullSources.values()].filter((chunk) => !chunk.id.startsWith("db:"));
  const libraryLimit = Math.max(candidates.length, 24 - curated.filter((chunk) => !candidates.some((candidate) => candidate.id === chunk.id)).length);
  const libraries = retrievalGroups.map((group) => group.filter((chunk) => chunk.id.startsWith("db:")));
  for (let index = 0; index < 24 && candidates.length < libraryLimit; index += 1) {
    for (const group of libraries) { if (group[index] && candidates.length < libraryLimit) add(group[index]); }
  }
  for (const source of curated) add(source);
  const retrievedChunks = candidates;
  // A new dependent question may need additional evidence, but its antecedent
  // must survive retrieval. Preserve exact prior source excerpts as candidates;
  // the selector still decides which evidence actually supports the new ask.
  const initialEvidenceCard = buildClinicalEvidenceCard(retrievalInput, retrievedChunks);
  const orderedCandidates = orderChunksForEvidenceCard(
    retrievedChunks,
    initialEvidenceCard,
  );
  const fallbackMatches = orderedCandidates.filter((chunk) =>
    scoreChunk(chunk, retrievalTokenGroups(retrievalInput)) + displayTopicChunkScore(chunk, displayTopicForTurn(retrievalInput)) + (chunk.id === focusedNubeqaEvidenceId(retrievalInput) ? 6000 : 0) > 0,
  );
  const preferredFallbackIds = (initialEvidenceCard?.preferredSourceIds ?? []).filter((id) => fallbackMatches.some((chunk) => chunk.id === id));
  websiteAnswer = await answerFromWebsite({ surveySlug: input.surveySlug, query: resolvedSourceQuestion.slice(0, 4000), candidates,
    sourceTopicContext, sourceQuestionPlan, presentationPlan: input.presentationPlan, priorSourceIds: priorSources.map(source => source.id), evidenceFocus: "all" });
  const selection = websiteAnswer ? { chunks: websiteAnswer.chunks, mode: "semantic" as const } : await selectFocusedSourceEvidence({
    surveySlug: input.surveySlug,
    query: resolvedSourceQuestion,
    candidates,
    sourceTopicContext,
    sourceQuestionPlan,
    presentationPlan: input.presentationPlan,
    priorSourceIds: priorSources.map((source) => source.id),
    fallbackSourceIds: priorSources.length ? priorSources.map((source) => source.id) : preferredFallbackIds.length ? preferredFallbackIds : fallbackMatches.slice(0, 1).map((chunk) => chunk.id),
  });
  chunks = selection.chunks;
  // Semantic selection owns the evidence scope. Do not reintroduce a broad
  // topic card containing facts from sources that the selector did not choose.
  evidenceCard = selection.mode === "fallback" && !dependentQuestion && !sourceQuestionPlan
    ? buildClinicalEvidenceCard(retrievalInput, chunks)
    : null;
  }

  if (chunks.length === 0) {
    return {
      enabled: false,
      answer: null,
      references: [],
      citationIds: [],
      conversationId: null,
      reason:
        "Controlled RAG did not retrieve a matching curated source chunk.",
      sourceOutcome: sourceTurnOutcome("no_evidence"),
      sourceQuestionPlan,
    };
  }

  // Lead contextual composition with the detail the participant requested,
  // rather than the already-established relationship that prompted the question.
  chunks = [...chunks].sort((left, right) => Number(right.contribution === "requested_context") - Number(left.contribution === "requested_context"));
  const references = referencesForChunks(chunks);
  const responseMode = input.responseMode ?? "answer_then_ask";
  const composition = websiteAnswer
    ? { available: true, answer: renderWebsiteAnswer(websiteAnswer.paragraphs, chunks), grounding: null, outcome: websiteAnswer.outcome }
    : await composeSourceAnswer(contextualCompositionInput, chunks, evidenceCard, resolvedSourceQuestion);
  const extractiveRecovery = composition.outcome.status === "extractive_recovery" ? composition.outcome.recovery : null;
  const composedAnswer = extractiveRecovery ? composition.answer : stripComposerFollowUpQuestions(
    composition.answer,
    input.selectedNextQuestion,
    responseMode,
  );
  let cited: ReturnType<typeof alignCitedSourceReferences>;
  let explanationAvailable = composition.available;
  try {
    // This is a whole source quotation, not a model draft: preserve its exact
    // wording, punctuation, questions, and conditions without rewriting markers.
    cited = extractiveRecovery
      ? { answer: composedAnswer, references: references.filter((reference) => reference.citationId === `rag:${extractiveRecovery.sourceId}`) }
      : alignCitedSourceReferences(composedAnswer, references);
  } catch {
    cited = { answer: SOURCE_EXPLANATION_UNAVAILABLE, references };
    composition.grounding = null;
    explanationAvailable = false;
    composition.outcome = sourceTurnOutcome("composition_failure", new Error("Contextual composition requires individual citations."));
  }
  const answer = [
    cited.answer,
    selectedQuestionLead(input.selectedNextQuestion, responseMode),
  ]
    .join("")
    .trim();
  const recoveredSource = "recoveredSource" in composition ? composition.recoveredSource : null;
  const packet = moderatorEvidencePacketSchema.safeParse({
    sources: extractiveRecovery ? (narrowRetainedPresentation ? retained.sources : chunks).map((source) => ({
      ...source, ...(recoveredSource?.id === source.id ? { text: recoveredSource.text } : {}), assets: source.assets ?? [],
    })) : cited.references.flatMap((reference) => {
      const source = chunks.find((chunk) => `rag:${chunk.id}` === reference.citationId);
      return source ? [{ ...source, assets: source.assets ?? [] }] : [];
    }),
  });

  return {
    enabled: explanationAvailable,
    answer,
    references: cited.references,
    citationIds: cited.references.map((reference) => reference.citationId),
    conversationId: null,
    reason: explanationAvailable ? null : "The source explanation could not be verified.",
    // Narrow only this presentation. Preserve the full prior source context for
    // a subsequent question about a different case within the same discussion.
    evidencePacket: narrowRetainedPresentation && !extractiveRecovery ? retained : packet.success ? packet.data : null,
    sourceQuestionPlan,
    sourceAnswerGrounding: composition.grounding,
    sourceOutcome: composition.outcome,
  };
}

export const controlledRagTestInternals = {
  sourceTurnInputs,
  displayTopicForTurn,
  buildClinicalEvidenceCard,
  cleanClinicalAnswer,
  orderChunksForEvidenceCard,
  rankAssetsForDisplay,
  referencesForChunks,
  databaseChunks,
  retrieveChunks,
  removeInternalSourceNarration,
  removeParticipantVoiceMirror,
  stripComposerFollowUpQuestions,
};
