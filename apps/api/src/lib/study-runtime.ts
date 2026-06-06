import type { Prisma, Session, Study } from "@prisma/client";
import {
  createSessionState,
  compileStudy,
  type CompiledStudy,
  type StudyDefinition,
} from "@interview/engine";
import {
  groundedReferenceSchema,
  sessionStateJsonSchema,
  type SessionStateJson,
} from "@interview/schemas";
import { prisma } from "./prisma";

type StudyWithGraph = Prisma.StudyGetPayload<{
  include: {
    modules: true;
    assets: true;
    questionNodes: true;
    branchRules: true;
    actions: true;
    actionRules: true;
    assetStageRules: true;
  };
}>;

export function asObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Prisma.JsonObject;
}

function sourceContextReferencesFromConfig(config: Prisma.JsonObject) {
  const parsed = groundedReferenceSchema
    .array()
    .safeParse(config.sourceContextReferences);

  return parsed.success ? parsed.data : [];
}

export function getSessionStateFromMetadata(
  session: Pick<Session, "id" | "studyId" | "metadata">,
  compiledStudy?: CompiledStudy,
): SessionStateJson {
  const metadata = asObject(session.metadata);
  const sessionState = metadata.sessionState;

  if (
    sessionState &&
    typeof sessionState === "object" &&
    !Array.isArray(sessionState)
  ) {
    return sessionStateJsonSchema.parse(sessionState);
  }

  if (!compiledStudy) {
    return sessionStateJsonSchema.parse({
      sessionId: session.id,
      studyId: session.studyId,
      status: "active",
    });
  }

  return createSessionState(compiledStudy, session.id);
}

export function withSessionStateMetadata(
  metadata: Prisma.JsonValue | null | undefined,
  sessionState: SessionStateJson,
) {
  return {
    ...asObject(metadata),
    sessionState,
  };
}

export async function getStudyOrThrow(studyId: string) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  return study;
}

export function toStudySummary(study: Study, sessionCount: number) {
  return {
    id: study.id,
    slug: study.slug,
    name: study.name,
    description: study.description ?? null,
    status: study.status,
    sessionCount,
  };
}

export async function loadCompiledStudy(studyId: string): Promise<{
  study: StudyWithGraph;
  compiledStudy: CompiledStudy;
}> {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      modules: {
        orderBy: { position: "asc" },
      },
      assets: {
        orderBy: [{ position: "asc" }],
      },
      questionNodes: {
        orderBy: [{ position: "asc" }],
      },
      branchRules: {
        orderBy: [{ priority: "asc" }],
      },
      actions: {
        orderBy: [{ priority: "asc" }],
      },
      actionRules: {
        orderBy: [{ priority: "asc" }],
      },
      assetStageRules: {
        orderBy: [{ priority: "asc" }],
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const definition: StudyDefinition = {
    study: {
      id: study.id,
      slug: study.slug,
      name: study.name,
      description: study.description ?? undefined,
      config: asObject(study.config),
    },
    modules: study.modules.map((module) => ({
      id: module.id,
      key: module.key,
      title: module.title,
      position: module.position,
    })),
    questionNodes: study.questionNodes.map((node) => {
      const config = asObject(node.config);

      return {
        id: node.id,
        key: node.key,
        moduleId: node.moduleId ?? undefined,
        title: node.title,
        prompt: node.prompt,
        nodeType: node.nodeType,
        isEntry: node.isEntry,
        isTerminal: node.isTerminal,
        position: node.position,
        config: {
          factKeys: Array.isArray(config.factKeys)
            ? config.factKeys.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          mustAsk: config.mustAsk === true,
          responseFormat:
            config.responseFormat === "short_text" ? "short_text" : "long_text",
          estimatedSeconds:
            typeof config.estimatedSeconds === "number"
              ? config.estimatedSeconds
              : undefined,
          maxAttempts:
            typeof config.maxAttempts === "number"
              ? config.maxAttempts
              : undefined,
          allowForceAdvance: config.allowForceAdvance !== false,
          importSource:
            typeof config.importSource === "string"
              ? config.importSource
              : undefined,
          sourceLine:
            typeof config.sourceLine === "number" ? config.sourceLine : null,
          minUsefulWords:
            typeof config.minUsefulWords === "number"
              ? config.minUsefulWords
              : undefined,
          requiresGroundedStudyContext:
            typeof config.requiresGroundedStudyContext === "boolean"
              ? config.requiresGroundedStudyContext
              : undefined,
          sourceContextHint:
            typeof config.sourceContextHint === "string" &&
            config.sourceContextHint.trim()
              ? config.sourceContextHint.trim()
              : undefined,
          sourceContextReferences: sourceContextReferencesFromConfig(config),
        },
      };
    }),
    branchRules: study.branchRules.map((rule) => ({
      id: rule.id,
      fromNodeId: rule.fromNodeId,
      toNodeId: rule.toNodeId,
      conditionType: rule.conditionType,
      factKey: rule.factKey ?? null,
      comparisonValue: rule.comparisonValue ?? null,
      priority: rule.priority,
      rationale: rule.rationale ?? undefined,
    })),
  };

  return {
    study,
    compiledStudy: compileStudy(definition),
  };
}
