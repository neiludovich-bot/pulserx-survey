import { shouldProactivelyGroundClinicalStudyQuestion } from "./study-grounding";

export type GuideCleanupNodeInput = {
  id: string;
  key: string;
  moduleId: string | null;
  title: string;
  prompt: string;
};

export type GuideCleanupModuleInput = {
  id: string;
  title: string;
};

export function isScriptedResponseSectionTitle(
  value: string | null | undefined,
) {
  return Boolean(
    value &&
    /^\s*(?:correct\s+next\s+response|suggested\s+(?:next\s+)?response|expected\s+(?:next\s+)?response|sample\s+(?:interviewer\s+)?response|example\s+(?:interviewer\s+)?response)\s*:?\s*$/i.test(
      value,
    ),
  );
}

export function isSampleRespondentPrompt(value: string) {
  return /^\s*(?:respondent|participant|hcp|user)\s*:/i.test(value);
}

function cleanScriptedContextSentence(value: string) {
  return value
    .replace(/^["\u201c\u201d]|["\u201c\u201d]$/g, "")
    .replace(
      /^(?:absolutely|got it|sure|okay|ok|let me summarize that part|let me separate that|before reviewing this)\.?\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isSourceContextSentence(value: string) {
  if (!value || isSampleRespondentPrompt(value) || /\?\s*$/u.test(value)) {
    return false;
  }

  return (
    shouldProactivelyGroundClinicalStudyQuestion(value) ||
    /\b(study|trial|evidence|data|endpoint|comparator|PFS|OS|ORR|response rate|safety|tolerability|follow-up|result|caveat|limitation|head-to-head|phase\s*[123]|AFib|cardiac|hemorrhage|infection|cytopenia|CYP3A|anticoagulant|antiplatelet|bleeding|dose modification|hepatic impairment|resources section)\b/i.test(
      value,
    )
  );
}

export function extractSourceContextHintFromScriptedResponsePrompt(
  prompt: string,
) {
  if (isSampleRespondentPrompt(prompt)) {
    return null;
  }

  const sentences = prompt
    .replace(/\r\n/gu, "\n")
    .split(/\n+|(?<=[.!?])\s+/u)
    .map(cleanScriptedContextSentence)
    .filter((sentence) => sentence.length >= 12)
    .filter(isSourceContextSentence);

  const uniqueSentences = Array.from(new Set(sentences));
  if (uniqueSentences.length === 0) {
    return null;
  }

  return uniqueSentences.join(" ");
}

function isDefaultWrapUpNode(node: GuideCleanupNodeInput) {
  return (
    node.key === "wrap_up" ||
    /^before we finish, is there anything important that this survey has not covered\??$/i.test(
      node.prompt.trim(),
    )
  );
}

export function findScriptedResponseImportNodes<
  TModule extends GuideCleanupModuleInput,
  TNode extends GuideCleanupNodeInput,
>(input: { modules: TModule[]; questionNodes: TNode[] }) {
  const moduleById = new Map(
    input.modules.map((module) => [module.id, module]),
  );
  const scriptedModuleIds = new Set(
    input.modules
      .filter((module) => isScriptedResponseSectionTitle(module.title))
      .map((module) => module.id),
  );

  return input.questionNodes.flatMap((node) => {
    if (isDefaultWrapUpNode(node)) {
      return [];
    }

    const module = node.moduleId ? moduleById.get(node.moduleId) : null;
    const inScriptedModule =
      node.moduleId !== null && scriptedModuleIds.has(node.moduleId);
    const titleLooksScripted = isScriptedResponseSectionTitle(node.title);
    const promptLooksLikeQuote = isSampleRespondentPrompt(node.prompt);

    if (!inScriptedModule && !titleLooksScripted && !promptLooksLikeQuote) {
      return [];
    }

    return [
      {
        node,
        module: module ?? null,
        reason: inScriptedModule
          ? `Module "${module?.title ?? node.moduleId}" is a scripted response section.`
          : titleLooksScripted
            ? "Node title is a scripted response heading."
            : "Prompt appears to be a respondent/example quote.",
      },
    ];
  });
}
