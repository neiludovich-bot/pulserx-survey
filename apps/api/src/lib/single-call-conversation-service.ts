import { moderatorEvidencePacketSchema, type ConversationInterpretationInput } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { retrieveWebsiteCandidates } from "./controlled-rag-service";
import { websiteAnswerChunks, websiteCandidatesForModel, renderWebsiteAnswer } from "./website-answer-service";
import { presentationFor } from "./mvp-presentation";
import { withExplicitSourceAssets } from "./focused-source-evidence";
import type { SourceAnswerProviderResult } from "./source-answer-service";

/** One model boundary for speech acts and a current-request answer. Selection stays in the engine. */
export async function interpretWithWebsite(input: Omit<ConversationInterpretationInput, "version" | "participantTokens">) {
  if (input.surveySlug === "data") throw new Error("Website conversation runtime requires a medical website bot.");
  const gateway = getOptionalOpenAIGateway();
  if (!gateway) throw new Error("Conversation model unavailable.");
  const candidates = await retrieveWebsiteCandidates({ surveySlug: input.surveySlug,
    participantMessage: input.participantMessage, surveyContext: input.recentInterviewerContext ?? "",
    currentQuestion: input.currentQuestion, selectedNextQuestion: null, selectedQuestionSourceContext: null,
    sourceTopicContext: input.state.sourceDiscussion?.query ?? null, responseMode: "answer_only" });
  if (candidates.some(source => source.surveySlug !== input.surveySlug)) throw new Error("Conversation catalog crossed bot boundaries.");
  const call = await gateway.interpretAndAnswerConversation(input, {
    surveySlug: input.surveySlug, query: input.participantMessage.slice(0, 4000),
    candidates: websiteCandidatesForModel(candidates), sourceTopicContext: input.state.sourceDiscussion?.query?.slice(0, 6000) ?? null,
    sourceQuestionPlan: null, priorSourceIds: input.state.sourceDiscussion?.evidencePacket?.sources.map(s => s.id) ?? [],
    evidenceFocus: "all", presentationPlan: presentationFor(input.state, "source_answer"),
  });
  let preparedSourceAnswer: SourceAnswerProviderResult | undefined;
  if (call.answer) {
    const chunks = websiteAnswerChunks(candidates, call.answer);
    const references = chunks.map(chunk => withExplicitSourceAssets({ citationId: `rag:${chunk.id}`, title: chunk.title,
      url: chunk.url || null, description: chunk.description || null, assets: chunk.assets ?? [] }));
    preparedSourceAnswer = { provider: "controlled_rag", enabled: !call.answer.unavailableReason,
      answer: call.answer.unavailableReason ? null : renderWebsiteAnswer(call.answer.paragraphs, chunks), references,
      citationIds: references.map(r => r.citationId), conversationId: null, reason: call.answer.unavailableReason,
      sourceQuestionPlan: call.interpretation.sourceQuestionPlan,
      ...(chunks.length ? { evidencePacket: moderatorEvidencePacketSchema.parse({ sources: chunks.map(({ id, surveySlug, title, url, description, text, tags, assets, evidenceRole, contribution }) => ({ id, surveySlug, title, url, description, text, tags, assets: assets ?? [], evidenceRole, contribution })) }) } : {}),
      sourceOutcome: { version: 1, status: call.answer.unavailableReason ? "no_evidence" : "success", attempts: [{ stage: "composition", code: "source_linked", model: call.trace.response.model, responseId: call.trace.response.id }] },
    };
  }
  return { ...call, preparedSourceAnswer };
}
