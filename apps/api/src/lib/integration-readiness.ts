import {
  integrationReadinessResponseSchema,
  integrationVerificationResponseSchema,
} from "@interview/schemas";
import { env } from "../env";
import { askCustomGptForSurveyClarification } from "./customgpt-service";
import { prisma } from "./prisma";
import { createRealtimeVoiceSession } from "./voice-service";

function missingEnv(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function reasonForMissing(missing: string[]) {
  if (missing.length === 0) {
    return null;
  }

  return `Missing ${missing.join(", ")}.`;
}

function customGptProjectIdFromConfig(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const value = (config as Record<string, unknown>).customGptProjectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configHasCustomGptProject(config: unknown) {
  return customGptProjectIdFromConfig(config) !== null;
}

export async function getStudyCustomGptProjectCount() {
  const studies = await prisma.study.findMany({
    select: {
      config: true,
    },
  });

  return studies.filter((study) => configHasCustomGptProject(study.config))
    .length;
}

async function getFirstStudyCustomGptProjectId() {
  const studies = await prisma.study.findMany({
    select: {
      config: true,
    },
  });

  for (const study of studies) {
    const projectId = customGptProjectIdFromConfig(study.config);
    if (projectId) {
      return projectId;
    }
  }

  return null;
}

export function getIntegrationReadiness(
  input: { studyProjectCount?: number } = {},
) {
  const openAiMissing = missingEnv({
    OPENAI_API_KEY: env.OPENAI_API_KEY,
  });
  const customGptMissing = missingEnv({
    CUSTOMGPT_API_KEY: env.CUSTOMGPT_API_KEY,
  });
  const customGptDefaultProjectConfigured = Boolean(env.CUSTOMGPT_PROJECT_ID);
  const studyProjectCount = Math.max(0, input.studyProjectCount ?? 0);
  const customGptProjectConfigured =
    customGptDefaultProjectConfigured || studyProjectCount > 0;
  const setupActions = [
    ...(openAiMissing.length > 0
      ? [
          {
            key: "add_openai_key",
            label: "Add OpenAI API key",
            detail:
              "Paste OPENAI_API_KEY in Local Credentials to enable recorded and realtime voice.",
            href: "/research/setup",
            severity: "blocker" as const,
          },
        ]
      : []),
    ...(customGptMissing.length > 0
      ? [
          {
            key: "add_customgpt_key",
            label: "Add CustomGPT API key",
            detail:
              "Paste CUSTOMGPT_API_KEY in Local Credentials so study questions can use approved source material.",
            href: "/research/setup",
            severity: "blocker" as const,
          },
        ]
      : []),
    ...(!customGptProjectConfigured
      ? [
          {
            key: "set_customgpt_project",
            label: "Set CustomGPT project",
            detail:
              "Add a default CUSTOMGPT_PROJECT_ID or set a per-study project in Study Settings.",
            href: "/research/setup",
            severity:
              customGptMissing.length > 0
                ? ("recommended" as const)
                : ("blocker" as const),
          },
        ]
      : []),
  ];

  return integrationReadinessResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    openaiRealtime: {
      status: openAiMissing.length === 0 ? "ready" : "missing_config",
      configured: openAiMissing.length === 0,
      model: env.OPENAI_MODEL_REALTIME,
      missingEnv: openAiMissing,
      reason: reasonForMissing(openAiMissing),
    },
    customGpt: {
      status: customGptMissing.length === 0 ? "ready" : "missing_config",
      configured: customGptMissing.length === 0,
      projectConfigured: customGptProjectConfigured,
      studyProjectCount,
      baseUrl: env.CUSTOMGPT_API_BASE_URL,
      missingEnv: customGptMissing,
      reason:
        reasonForMissing(customGptMissing) ??
        (customGptDefaultProjectConfigured
          ? null
          : studyProjectCount > 0
            ? `${studyProjectCount} study-specific CustomGPT project ID(s) are configured.`
            : "No default CUSTOMGPT_PROJECT_ID is set; use per-study CustomGPT project IDs in Study Settings."),
    },
    setupActions,
  });
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

export async function verifyIntegrations() {
  const [studyProjectCount, firstStudyProjectId] = await Promise.all([
    getStudyCustomGptProjectCount(),
    getFirstStudyCustomGptProjectId(),
  ]);
  const readiness = getIntegrationReadiness({
    studyProjectCount,
  });
  const generatedAt = new Date().toISOString();

  let openaiRealtime:
    | Awaited<
        ReturnType<typeof integrationVerificationResponseSchema.parse>
      >["openaiRealtime"]
    | null = null;
  const openAiStartedAt = Date.now();
  if (!readiness.openaiRealtime.configured) {
    openaiRealtime = {
      status: "skipped",
      checked: false,
      model: readiness.openaiRealtime.model,
      expiresAt: null,
      latencyMs: null,
      reason: readiness.openaiRealtime.reason,
    };
  } else {
    try {
      const realtimeSession = await createRealtimeVoiceSession();
      openaiRealtime = {
        status: realtimeSession.enabled ? "passed" : "failed",
        checked: true,
        model: readiness.openaiRealtime.model,
        expiresAt: realtimeSession.expiresAt,
        latencyMs: elapsedMs(openAiStartedAt),
        reason: realtimeSession.enabled
          ? null
          : (realtimeSession.reason ?? "Realtime session was not enabled."),
      };
    } catch (error) {
      openaiRealtime = {
        status: "failed",
        checked: true,
        model: readiness.openaiRealtime.model,
        expiresAt: null,
        latencyMs: elapsedMs(openAiStartedAt),
        reason:
          error instanceof Error
            ? error.message
            : "Realtime verification failed.",
      };
    }
  }

  let customGpt:
    | Awaited<
        ReturnType<typeof integrationVerificationResponseSchema.parse>
      >["customGpt"]
    | null = null;
  const customGptStartedAt = Date.now();
  if (
    !readiness.customGpt.configured ||
    !readiness.customGpt.projectConfigured
  ) {
    customGpt = {
      status: "skipped",
      checked: false,
      baseUrl: readiness.customGpt.baseUrl,
      projectConfigured: readiness.customGpt.projectConfigured,
      responseReceived: false,
      latencyMs: null,
      reason:
        readiness.customGpt.reason ??
        "No default CustomGPT project is configured for global verification.",
    };
  } else {
    try {
      const result = await askCustomGptForSurveyClarification({
        projectId: env.CUSTOMGPT_PROJECT_ID ?? firstStudyProjectId,
        question: "What is this survey asking me to react to?",
        surveyContext:
          "This is a medical market research survey with a side-pane concept guide. Answer only from approved survey context and do not provide medical advice.",
        assetTitle: "Medical Concept Guide",
      });

      customGpt = {
        status: result.answer ? "passed" : "failed",
        checked: true,
        baseUrl: readiness.customGpt.baseUrl,
        projectConfigured: readiness.customGpt.projectConfigured,
        responseReceived: Boolean(result.answer),
        latencyMs: elapsedMs(customGptStartedAt),
        reason: result.answer
          ? null
          : (result.reason ?? "CustomGPT did not return an answer."),
      };
    } catch (error) {
      customGpt = {
        status: "failed",
        checked: true,
        baseUrl: readiness.customGpt.baseUrl,
        projectConfigured: readiness.customGpt.projectConfigured,
        responseReceived: false,
        latencyMs: elapsedMs(customGptStartedAt),
        reason:
          error instanceof Error
            ? error.message
            : "CustomGPT verification failed.",
      };
    }
  }

  return integrationVerificationResponseSchema.parse({
    generatedAt,
    openaiRealtime,
    customGpt,
  });
}
