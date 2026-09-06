import { sourceTurnOutcomeSchema, type SourceTurnOutcome } from "@interview/schemas";
import { CONTROLLED_RAG_CHUNKS, type ControlledRagChunk } from "./controlled-rag-source-packs";

const localFailures = new Set(["unsupported_claims", "word_budget_exceeded", "citation_mismatch", "unexpected_question", "missing_contextual_citation"]);

export function recoverSelectedSourceExcerpt(
  chunks: ControlledRagChunk[], outcome: SourceTurnOutcome, requiresContext: boolean,
) {
  if (!["grounding_rejected", "composition_failure"].includes(outcome.status)) return null;
  const failures = outcome.attempts.filter(({ code }) => code !== "composed" && code !== "supported");
  // An earlier rejected draft never licenses recovery after an access failure,
  // missing response, unknown error, or invalid grounding verdict.
  if (!failures.length || failures.some(({ code }) => !localFailures.has(code))) return null;
  const source = chunks.find((chunk) => chunk.contribution === "requested_context")
    ?? (!requiresContext ? chunks.find((chunk) => chunk.contribution === "answer") : undefined);
  if (!source || !source.text.trim()) return null;
  // Exact substring selection does not prove a complete instruction: it can
  // omit "Do not" or a necessary condition. Only our complete curated card
  // supplies a known source boundary. Never quote arbitrary/DB fragments here.
  const trusted = CONTROLLED_RAG_CHUNKS.find((card) => card.id === source.id && card.surveySlug === source.surveySlug);
  if (!trusted || trusted.url !== source.url || trusted.title !== source.title ||
    !trusted.text.includes(source.text) || trusted.text.length > 1500) return null;
  // Do not detach an answer from a separately selected essential qualification.
  if (chunks.some((chunk) => chunk.id !== source.id && chunk.contribution === "essential_qualification")) return null;
  // Source-internal numeric citation syntax cannot be remapped without changing
  // the verbatim excerpt or accidentally linking to another selected source.
  if (/\[\s*\d/.test(trusted.text)) return null;
  return {
    sourceId: source.id,
    source: { ...source, text: trusted.text },
    answer: `The source summary for ${trusted.title} states:\n\n“${trusted.text}” [1]`,
    outcome: sourceTurnOutcomeSchema.parse({
      version: 1, status: "extractive_recovery", attempts: outcome.attempts,
      recovery: { method: "verbatim_curated_source_card", sourceId: source.id,
        cause: failures.some(({ code }) => code === "unsupported_claims") ? "grounding_rejected" : "composition_validation" },
    }),
  };
}
