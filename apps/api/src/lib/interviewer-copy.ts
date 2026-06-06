import {
  type AnalysisResult,
  type GroundedReference,
  type PhrasingInput,
} from "@interview/schemas";

type BuildInterviewerPhrasingInputParams = {
  sessionId: string;
  selectedQuestion: {
    id: string;
    title: string;
    prompt: string;
    tags?: string[];
    isTerminal?: boolean;
  };
  selectionAction: "ask" | "probe" | "redirect" | "close";
  analysis?: AnalysisResult | null;
  assetTitle?: string | null;
};

type InterviewerDeliveryContext = {
  interactionType: "ask" | "probe" | "redirect" | "close";
  answerQuality?: AnalysisResult["answerQuality"];
  turnIntent?: AnalysisResult["turnIntent"];
  safetyFlag?: boolean;
  participantQuestion?: string | null;
  groundedResponse?: string | null;
  groundedReferences?: GroundedReference[];
  acknowledgement?: string;
  missingTopics?: string[];
  assetTitle?: string;
};

export type InterviewerPhrasingInput = PhrasingInput & {
  deliveryContext?: InterviewerDeliveryContext;
};

const FACT_LABELS: Record<string, string> = {
  company_type: "what kind of company this is",
  pricing_stakeholders: "who is involved in pricing decisions",
  pricing_process: "how pricing is currently set or updated",
  value_metric: "what tells you the pricing model is working",
  budget_sensitivity: "what budget limits or approval thresholds matter",
  participant_perspective: "what perspective you are answering from",
  condition_context: "what healthcare experience we should keep in mind",
  care_journey_priorities: "what has mattered most in the care journey",
  information_needs: "what medical information needs to answer clearly",
  asset_reaction: "what felt clear or concerning in the material",
  clarity_gaps: "what still felt unclear in the material",
  access_barriers: "what would make it easier or harder to act",
  closing_feedback: "anything important we have not covered",
};

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickDeterministically(seed: string, values: string[]) {
  if (values.length === 0) {
    return "";
  }

  return values[hashText(seed) % values.length]!;
}

function joinLabels(values: string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0]!;
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function describeMissingTopics(missingTopics: string[]) {
  const labels = missingTopics.map(
    (topic) => FACT_LABELS[topic] ?? "a bit more detail",
  );
  const uniqueLabels = [...new Set(labels)];

  if (uniqueLabels.length === 0) {
    return null;
  }

  return joinLabels(uniqueLabels);
}

function stripInlineReferences(answer: string) {
  const referencesIndex = answer.search(/\n\nReferences:\s*\[\d+\]/);

  if (referencesIndex < 0) {
    return answer.trim();
  }

  return answer.slice(0, referencesIndex).trim();
}

function buildAcknowledgement(
  seed: string,
  interactionType: PhrasingInput["deliveryContext"]["interactionType"],
  analysis?: AnalysisResult | null,
) {
  if (!analysis) {
    return undefined;
  }

  if (interactionType === "ask" && analysis.shouldAdvance) {
    return pickDeterministically(seed, [
      "Thanks, that's helpful.",
      "Got it.",
      "That helps.",
      "Okay, that gives me a good picture.",
    ]);
  }

  if (interactionType === "probe" && analysis.answerQuality === "partial") {
    return pickDeterministically(seed, [
      "That helps, but I need one more piece.",
      "I have the broad outline.",
      "That's useful context.",
    ]);
  }

  if (interactionType === "probe" && analysis.answerQuality === "nonsense") {
    return pickDeterministically(seed, [
      "I may have missed that.",
      "I don't think I caught the detail I need yet.",
      "I still need a clearer answer there.",
    ]);
  }

  if (interactionType === "redirect") {
    if (analysis.turnIntent === "medical_safety") {
      return pickDeterministically(seed, [
        "I need to pause on that for safety.",
        "I can't assess that in this survey.",
        "That sounds important, but this survey cannot handle medical guidance.",
      ]);
    }

    if (analysis.turnIntent === "clarification_question") {
      return pickDeterministically(seed, [
        "Good question.",
        "I can orient briefly.",
        "That is a fair question.",
      ]);
    }

    return pickDeterministically(seed, [
      "Let me bring us back to the pricing discussion.",
      "Let's stay with this interview topic for a moment.",
      "I want to come back to the question I asked.",
    ]);
  }

  return undefined;
}

function buildQuestionLead(input: PhrasingInput) {
  const prompt = input.selectedQuestion.promptSeed.trim();
  const { assetTitle } = input.deliveryContext;

  if (!assetTitle) {
    return prompt;
  }

  return `I'd like to show you something before the next question. Please take a moment to review "${assetTitle}" in the pane, then answer this: ${prompt}`;
}

export function buildInterviewerPhrasingInput(
  input: BuildInterviewerPhrasingInputParams,
) {
  const seed = [
    input.sessionId,
    input.selectedQuestion.id,
    input.selectionAction,
    input.analysis?.summary ?? "",
  ].join(":");

  return {
    sessionId: input.sessionId,
    selectedQuestion: {
      id: input.selectedQuestion.id,
      kind:
        input.selectionAction === "close"
          ? "close"
          : input.selectionAction === "probe" ||
              input.selectionAction === "redirect"
            ? "probe"
            : input.selectedQuestion.isTerminal
              ? "close"
              : "primary",
      objective: input.selectedQuestion.title,
      promptSeed: input.selectedQuestion.prompt,
      tags: input.selectedQuestion.tags ?? [],
    },
    participantContext: {
      tone: "warm",
      lastAnswerSummary: input.analysis?.summary,
    },
    deliveryContext: {
      interactionType: input.selectionAction,
      answerQuality: input.analysis?.answerQuality,
      turnIntent: input.analysis?.turnIntent,
      safetyFlag: input.analysis?.safetyFlag,
      participantQuestion: input.analysis?.participantQuestion,
      groundedResponse: input.analysis?.groundedResponse,
      groundedReferences: input.analysis?.groundedReferences ?? [],
      acknowledgement: buildAcknowledgement(
        seed,
        input.selectionAction,
        input.analysis,
      ),
      missingTopics: input.analysis?.missingTopics ?? [],
      assetTitle: input.assetTitle ?? undefined,
    },
  } satisfies InterviewerPhrasingInput;
}

export function buildFallbackInterviewerUtterance(
  input: InterviewerPhrasingInput,
) {
  const phrasingInput = input;
  const deliveryContext: InterviewerDeliveryContext = {
    interactionType: input.deliveryContext?.interactionType ?? "ask",
    answerQuality: input.deliveryContext?.answerQuality,
    turnIntent: input.deliveryContext?.turnIntent,
    safetyFlag: input.deliveryContext?.safetyFlag,
    participantQuestion: input.deliveryContext?.participantQuestion,
    groundedResponse: input.deliveryContext?.groundedResponse,
    groundedReferences: input.deliveryContext?.groundedReferences ?? [],
    acknowledgement: input.deliveryContext?.acknowledgement,
    missingTopics: input.deliveryContext?.missingTopics ?? [],
    assetTitle: input.deliveryContext?.assetTitle,
  };
  const { interactionType, acknowledgement, answerQuality } = deliveryContext;
  const missingTopics = deliveryContext.missingTopics ?? [];
  const questionLead = buildQuestionLead(phrasingInput);
  const missingTopicsText = describeMissingTopics(missingTopics);

  if (interactionType === "close") {
    return questionLead;
  }

  if (interactionType === "redirect") {
    if (
      deliveryContext.safetyFlag ||
      deliveryContext.turnIntent === "medical_safety"
    ) {
      return `${acknowledgement ?? "I cannot assess that in this survey."} I cannot provide medical advice, diagnosis, or treatment guidance. If this may be urgent, contact emergency services or a clinician right away. To continue the survey: ${questionLead}`;
    }

    if (deliveryContext.turnIntent === "clarification_question") {
      if (deliveryContext.groundedResponse) {
        return `${acknowledgement ?? "Good question."} ${stripInlineReferences(
          deliveryContext.groundedResponse,
        )} Coming back to the survey: ${questionLead}`;
      }

      return `${acknowledgement ?? "Good question."} Please answer from your own experience or reaction; this survey will not provide medical advice. Coming back to the survey: ${questionLead}`;
    }

    return `${acknowledgement ?? "Let's come back to the interview topic."} ${questionLead}`;
  }

  if (interactionType === "probe") {
    if (answerQuality === "nonsense") {
      return `${acknowledgement ?? "I may have missed that."} ${questionLead}`;
    }

    if (missingTopicsText) {
      return `${acknowledgement ?? "That helps."} I still need a bit more on ${missingTopicsText}. ${questionLead}`;
    }

    return `${acknowledgement ?? "That helps."} Could you say a little more about that? ${questionLead}`;
  }

  if (acknowledgement) {
    return `${acknowledgement} ${questionLead}`;
  }

  return questionLead;
}
