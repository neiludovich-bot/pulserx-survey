import {
  contradictionFlagSchema,
  type ContradictionFlag,
  type FactValue
} from "@interview/schemas";

function stableValue(value: FactValue) {
  if (Array.isArray(value)) {
    return [...value].sort().join("|");
  }

  return JSON.stringify(value);
}

export function detectContradictions(
  existingFacts: Record<string, FactValue>,
  incomingFacts: Record<string, FactValue>
): ContradictionFlag[] {
  const findings: ContradictionFlag[] = [];

  for (const [factKey, nextValue] of Object.entries(incomingFacts)) {
    const previousValue = existingFacts[factKey];
    if (previousValue === undefined) {
      continue;
    }

    if (stableValue(previousValue) === stableValue(nextValue)) {
      continue;
    }

    findings.push(
      contradictionFlagSchema.parse({
        factKey,
        previousValue,
        nextValue,
        reason: `The latest answer conflicts with the previously stored value for "${factKey}".`
      })
    );
  }

  return findings;
}
