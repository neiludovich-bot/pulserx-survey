import { moderatorPlanModelResultSchema, moderatorPlanTokenModelResultSchema, moderatorPlanRepairContextSchema, type ModeratorPlanInput, type ModeratorPlanModelResult } from "@interview/schemas";
import { evidenceFromTokenRange } from "./evidence-ranges";
import { normalizeModeratorPlanWithRepair } from "./moderator-planning";

/** Reconstruct exact participant text before any canonical credit/state logic. */
export function normalizeModeratorPlanTokenResult(input: ModeratorPlanInput, output: unknown) {
  const candidate = moderatorPlanTokenModelResultSchema.parse(output);
  let canonical: ModeratorPlanModelResult;
  try {
    const { schemaVersion: _version, reactionEvidenceRanges, priorityMentions, sourceRequest, ...plan } = candidate;
    canonical = moderatorPlanModelResultSchema.parse({
      ...plan,
      sourceRequest: sourceRequest ? {
        kind: sourceRequest.kind, resolvedQuestion: sourceRequest.resolvedQuestion,
        participantEvidence: evidenceFromTokenRange(input.participantMessage, sourceRequest.participantEvidenceRange),
      } : null,
      reactionEvidence: reactionEvidenceRanges.map((range) => evidenceFromTokenRange(input.participantMessage, range)),
      priorityMentions: priorityMentions.map(({ participantEvidenceRange, additionEvidenceRange, ...mention }) => ({
        ...mention,
        participantEvidence: evidenceFromTokenRange(input.participantMessage, participantEvidenceRange),
        additionEvidence: additionEvidenceRange ? evidenceFromTokenRange(input.participantMessage, additionEvidenceRange) : null,
      })),
    });
  } catch {
    throw Object.assign(new Error("Moderator evidence ranges must identify valid bounded excerpts in the current participant message."), {
      code: "invalid_evidence_range",
      repairContext: moderatorPlanRepairContextSchema.parse({ version: 1, candidate, feedback: "invalid_evidence_range" }),
    });
  }
  try { return normalizeModeratorPlanWithRepair(input, canonical); }
  catch (error) {
    // Repair the actual indexed wire candidate, including for state/action errors.
    const repair = moderatorPlanRepairContextSchema.safeParse(error && typeof error === "object" && "repairContext" in error ? error.repairContext : undefined);
    if (repair.success && error instanceof Error) {
      throw Object.assign(error, { repairContext: { ...repair.data, candidate } });
    }
    throw error;
  }
}
