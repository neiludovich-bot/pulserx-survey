import { evidenceTokenRangeSchema, participantTokensSchema, type EvidenceTokenRange } from "@interview/schemas";

export class ParticipantEvidenceRangeError extends Error {
  readonly code = "invalid_evidence_range";
  constructor() { super("Participant evidence token range is outside the current message or reversed."); }
}

export function tokenizeParticipantMessage(message: string) {
  return Array.from(message.matchAll(/\S+/gu), (match, index) => ({ index, text: match[0], start: match.index!, end: match.index! + match[0].length }));
}

export function participantTokensForModel(message: string) {
  return participantTokensSchema.parse(tokenizeParticipantMessage(message).map(({ index, text }) => ({ index, text })));
}

export function evidenceFromTokenRange(message: string, range: EvidenceTokenRange) {
  const parsed = evidenceTokenRangeSchema.parse(range);
  const tokens = tokenizeParticipantMessage(message);
  const start = tokens[parsed.startToken];
  const end = tokens[parsed.endToken];
  if (!start || !end || parsed.startToken > parsed.endToken) throw new ParticipantEvidenceRangeError();
  return message.slice(start.start, end.end);
}
