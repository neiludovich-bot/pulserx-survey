const unsupportedScriptPattern =
  /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]/u;

const knownTranscriptionArtifactPatterns = [
  /\bnational did it\b/i,
  /\bnosso estilo\b/i,
  /\bsubtitles? by\b/i,
  /\bthanks for watching\b/i,
];

export function containsUnsupportedTranscriptScript(value: string) {
  return unsupportedScriptPattern.test(value);
}

export function looksLikeTranscriptionArtifact(value: string) {
  return knownTranscriptionArtifactPatterns.some((pattern) =>
    pattern.test(value),
  );
}

export function transcriptLooksNonEnglishOrGarbled(value: string) {
  return (
    containsUnsupportedTranscriptScript(value) ||
    looksLikeTranscriptionArtifact(value)
  );
}
