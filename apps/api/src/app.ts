import cors from "@fastify/cors";
import { InterviewEngine } from "@interview/engine";
import {
  abandonStudyOpenSessionsSchema,
  addStudyCustomGptAssetSourceSchema,
  addStudyCustomGptSitemapSourceSchema,
  applyStudyGuideCleanupSchema,
  createStudyAssetSchema,
  createStudyBranchRuleSchema,
  createStudyBranchRulesSchema,
  healthResponseSchema,
  mvpCustomGptSurveyStartRequestSchema,
  mvpCustomGptSurveySpeechRequestSchema,
  mvpCustomGptSurveyTurnRequestSchema,
  mvpCustomGptSurveyVoiceTranscribeRequestSchema,
  mvpCustomGptSurveyVoiceTurnRequestSchema,
  mvpCustomGptSourcePreviewRequestSchema,
  previewSurveyImportRequestSchema,
  publishSurveyImportRequestSchema,
  retainStudyGuideSourceNotesSchema,
  simulateStudyBranchRouteSchema,
  startTestSessionRequestSchema,
  submitAssetReactionSchema,
  submitRespondentAnswerSchema,
  submitRespondentRealtimeAnswerSchema,
  submitRespondentVoiceAnswerSchema,
  updateLocalEnvironmentConfigSchema,
  updateStudyAssetDisplayModeSchema,
  updateStudyQuestionGroundingSchema,
  updateStudySourceContextNotesSchema,
  updateStudySettingsSchema,
} from "@interview/schemas";
import Fastify from "fastify";
import { env } from "./env";
import {
  getIntegrationReadiness,
  getStudyCustomGptProjectCount,
  verifyIntegrations,
} from "./lib/integration-readiness";
import {
  getRespondentSession,
  getSessionAudit,
  getStudyGraph,
  listStudies,
  runStudyLaunchSmokeTest,
  abandonStudyOpenSessions,
  startRespondentSession,
  startTestSession,
  submitAssetReaction,
  submitRespondentAnswer,
} from "./lib/interview-service";
import {
  getLocalEnvironmentConfig,
  updateLocalEnvironmentConfig,
} from "./lib/local-env-service";
import {
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
  submitMvpCustomGptSurveyVoiceTurn,
  synthesizeMvpCustomGptSurveyLatestInterviewer,
  transcribeMvpCustomGptSurveyVoice,
} from "./lib/mvp-customgpt-survey-service";
import {
  getMvpSurveyAuditSession,
  listMvpSurveyAuditSessions,
} from "./lib/mvp-survey-audit-service";
import { previewSourceImages } from "./lib/source-preview-service";
import {
  applyStudyGuideCleanup,
  applyRecommendedStudyBranchRules,
  createStudyAsset,
  createStudyBranchRule,
  createStudyBranchRules,
  addStudyCustomGptAssetSource,
  addStudyCustomGptSitemapSource,
  getStudyLaunchCheck,
  getStudySettings,
  getStudyCustomGptSources,
  previewStudySourceContext,
  previewStudyQuestionGrounding,
  retainStudyGuideSourceNotes,
  simulateStudyBranchRoute,
  updateStudyQuestionGrounding,
  updateStudyAssetDisplayMode,
  updateStudySourceContextNotes,
  updateStudySettings,
  verifyStudyCustomGpt,
} from "./lib/study-admin-service";
import {
  getImportedStudyAssetContent,
  previewSurveyImport,
  publishSurveyImport,
} from "./lib/survey-import-service";
import {
  createRealtimeVoiceSession,
  submitRespondentVoiceAnswer,
} from "./lib/voice-service";

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    bodyLimit: 32 * 1024 * 1024,
  });
  const corsOrigins = Array.from(
    new Set([env.CORS_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"]),
  );

  app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
  });

  app.get("/health", async () =>
    healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/", async () => {
    const engine = new InterviewEngine();

    return {
      name: engine.productName,
      version: "v1",
    };
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/start", async (request, reply) => {
    const body = mvpCustomGptSurveyStartRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT survey start payload.",
        issues: body.error.flatten(),
      });
    }

    return startMvpCustomGptSurvey(body.data);
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/turn", async (request, reply) => {
    const body = mvpCustomGptSurveyTurnRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT survey turn payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await submitMvpCustomGptSurveyTurn(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit MVP CustomGPT survey turn.",
      });
    }
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/voice-turn", async (request, reply) => {
    const body = mvpCustomGptSurveyVoiceTurnRequestSchema.safeParse(
      request.body,
    );
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT survey voice payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await submitMvpCustomGptSurveyVoiceTurn(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit MVP CustomGPT survey voice turn.",
      });
    }
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/voice-transcribe", async (request, reply) => {
    const body = mvpCustomGptSurveyVoiceTranscribeRequestSchema.safeParse(
      request.body,
    );
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT survey voice transcription payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await transcribeMvpCustomGptSurveyVoice(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to transcribe MVP CustomGPT survey voice.",
      });
    }
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/speech", async (request, reply) => {
    const body = mvpCustomGptSurveySpeechRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT survey speech payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await synthesizeMvpCustomGptSurveyLatestInterviewer(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to synthesize MVP CustomGPT survey speech.",
      });
    }
  });

  app.post<{
    Body: unknown;
  }>("/mvp/customgpt-survey/source-preview", async (request, reply) => {
    const body = mvpCustomGptSourcePreviewRequestSchema.safeParse(
      request.body,
    );
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid MVP CustomGPT source preview payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await previewSourceImages(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to preview source images.",
      });
    }
  });

  app.get<{
    Querystring: { limit?: string };
  }>("/mvp/customgpt-survey/audit/sessions", async (request) => {
    const limit = Number.parseInt(request.query.limit ?? "50", 10);
    return listMvpSurveyAuditSessions(Number.isFinite(limit) ? limit : 50);
  });

  app.get<{
    Params: { sessionId: string };
  }>("/mvp/customgpt-survey/audit/sessions/:sessionId", async (request, reply) => {
    const audit = await getMvpSurveyAuditSession(request.params.sessionId);
    if (!audit) {
      return reply.status(404).send({
        message: "MVP survey audit session was not found.",
      });
    }

    return audit;
  });

  app.get("/studies", async () => {
    return listStudies();
  });

  app.post<{
    Body: unknown;
  }>("/admin/survey-imports/preview", async (request, reply) => {
    const body = previewSurveyImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid survey import preview payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return previewSurveyImport(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to preview survey import.",
      });
    }
  });

  app.post<{
    Body: unknown;
  }>("/admin/survey-imports/publish", async (request, reply) => {
    const body = publishSurveyImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid survey import publish payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await publishSurveyImport(body.data.preview);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to publish survey import.",
      });
    }
  });

  app.get("/integrations/readiness", async () => {
    return getIntegrationReadiness({
      studyProjectCount: await getStudyCustomGptProjectCount(),
    });
  });

  app.post("/integrations/verify", async () => {
    return verifyIntegrations();
  });

  app.get("/admin/local-env", async () => {
    return getLocalEnvironmentConfig();
  });

  app.patch<{
    Body: unknown;
  }>("/admin/local-env", async (request, reply) => {
    const body = updateLocalEnvironmentConfigSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid local environment payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await updateLocalEnvironmentConfig(body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to update local environment.",
      });
    }
  });

  app.get<{
    Params: {
      assetId: string;
    };
  }>("/assets/:assetId/content", async (request, reply) => {
    try {
      const assetContent = await getImportedStudyAssetContent(
        request.params.assetId,
      );

      return reply
        .header("Content-Type", assetContent.mimeType)
        .header(
          "Content-Disposition",
          `inline; filename="${assetContent.fileName.replace(/"/g, "")}"`,
        )
        .send(assetContent.bytes);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Asset not found.",
      });
    }
  });

  app.get<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/graph", async (request, reply) => {
    try {
      return await getStudyGraph(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Study not found.",
      });
    }
  });

  app.get<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/settings", async (request, reply) => {
    try {
      return await getStudySettings(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Study not found.",
      });
    }
  });

  app.get<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/launch-check", async (request, reply) => {
    try {
      return await getStudyLaunchCheck(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to run launch check.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/guide-cleanup/apply", async (request, reply) => {
    const body = applyStudyGuideCleanupSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid guide cleanup payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await applyStudyGuideCleanup(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to apply guide cleanup.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/customgpt/sources/asset", async (request, reply) => {
    const body = addStudyCustomGptAssetSourceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid CustomGPT asset source payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await addStudyCustomGptAssetSource(
        request.params.studyId,
        body.data,
      );
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to add study asset to CustomGPT.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>(
    "/studies/:studyId/guide-cleanup/retain-source-notes",
    async (request, reply) => {
      const body = retainStudyGuideSourceNotesSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: "Invalid source-note retention payload.",
          issues: body.error.flatten(),
        });
      }

      try {
        return await retainStudyGuideSourceNotes(
          request.params.studyId,
          body.data,
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to retain source-context notes.",
        });
      }
    },
  );

  app.post<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/respondent-sessions", async (request, reply) => {
    try {
      const launchCheck = await getStudyLaunchCheck(request.params.studyId);
      if (launchCheck.blockingItemCount > 0) {
        const blockers = launchCheck.recommendedActions
          .filter((action) => action.severity === "blocker")
          .map((action) => action.label)
          .join(", ");

        return reply.status(409).send({
          message: `Cannot create a respondent session until launch blockers are cleared: ${
            blockers || `${launchCheck.blockingItemCount} blocker(s)`
          }.`,
          blockingItemCount: launchCheck.blockingItemCount,
          recommendedActions: launchCheck.recommendedActions.filter(
            (action) => action.severity === "blocker",
          ),
        });
      }

      return await startRespondentSession(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to create respondent session.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/launch-smoke-test", async (request, reply) => {
    try {
      return await runStudyLaunchSmokeTest(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to run launch smoke test.",
      });
    }
  });

  app.patch<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/settings", async (request, reply) => {
    const body = updateStudySettingsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid study settings payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await updateStudySettings(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error ? error.message : "Unable to update settings.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/assets", async (request, reply) => {
    const body = createStudyAssetSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid study asset payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await createStudyAsset(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to create study asset.",
      });
    }
  });

  app.patch<{
    Params: {
      studyId: string;
      assetId: string;
    };
    Body: unknown;
  }>(
    "/studies/:studyId/assets/:assetId/display-mode",
    async (request, reply) => {
      const body = updateStudyAssetDisplayModeSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: "Invalid asset display-mode payload.",
          issues: body.error.flatten(),
        });
      }

      try {
        return await updateStudyAssetDisplayMode(
          request.params.studyId,
          request.params.assetId,
          body.data,
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(404).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to update asset display mode.",
        });
      }
    },
  );

  app.patch<{
    Params: {
      studyId: string;
      nodeId: string;
    };
    Body: unknown;
  }>(
    "/studies/:studyId/questions/:nodeId/grounding",
    async (request, reply) => {
      const body = updateStudyQuestionGroundingSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: "Invalid question grounding payload.",
          issues: body.error.flatten(),
        });
      }

      try {
        return await updateStudyQuestionGrounding(
          request.params.studyId,
          request.params.nodeId,
          body.data,
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(404).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to update question grounding.",
        });
      }
    },
  );

  app.patch<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/source-context-notes", async (request, reply) => {
    const body = updateStudySourceContextNotesSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid source-context notes payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await updateStudySourceContextNotes(
        request.params.studyId,
        body.data,
      );
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to update source-context notes.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
      nodeId: string;
    };
  }>(
    "/studies/:studyId/questions/:nodeId/grounding-preview",
    async (request, reply) => {
      try {
        return await previewStudyQuestionGrounding(
          request.params.studyId,
          request.params.nodeId,
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(404).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to preview source context.",
        });
      }
    },
  );

  app.post<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/source-context-preview", async (request, reply) => {
    try {
      return await previewStudySourceContext(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to preview study source context.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/branch-routes/simulate", async (request, reply) => {
    const body = simulateStudyBranchRouteSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid branch route simulation payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await simulateStudyBranchRoute(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to simulate branch route.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/branch-rules/batch", async (request, reply) => {
    const body = createStudyBranchRulesSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid branch rule batch payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await createStudyBranchRules(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to create branch rules.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/branch-rules/recommended", async (request, reply) => {
    try {
      return await applyRecommendedStudyBranchRules(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to apply recommended branch rules.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/branch-rules", async (request, reply) => {
    const body = createStudyBranchRuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid branch rule payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await createStudyBranchRule(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to create branch rule.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/customgpt/verify", async (request, reply) => {
    try {
      return await verifyStudyCustomGpt(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to verify study CustomGPT project.",
      });
    }
  });

  app.get<{
    Params: {
      studyId: string;
    };
  }>("/studies/:studyId/customgpt/sources", async (request, reply) => {
    try {
      return await getStudyCustomGptSources(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to list study CustomGPT sources.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/customgpt/sources/sitemap", async (request, reply) => {
    const body = addStudyCustomGptSitemapSourceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid CustomGPT source payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await addStudyCustomGptSitemapSource(
        request.params.studyId,
        body.data,
      );
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to add study CustomGPT source.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/test-sessions", async (request, reply) => {
    const body = startTestSessionRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid test session payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await startTestSession(request.params.studyId, body.data);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to start test session.",
      });
    }
  });

  app.post<{
    Params: {
      studyId: string;
    };
    Body: unknown;
  }>("/studies/:studyId/sessions/abandon-open", async (request, reply) => {
    const body = abandonStudyOpenSessionsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid abandon sessions payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await abandonStudyOpenSessions(request.params.studyId);
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to abandon open sessions.",
      });
    }
  });

  app.get<{
    Params: {
      sessionId: string;
    };
  }>("/sessions/:sessionId/respondent", async (request, reply) => {
    try {
      return await getRespondentSession(request.params.sessionId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Session not found.",
      });
    }
  });

  app.post<{
    Params: {
      sessionId: string;
    };
    Body: {
      content: string;
      intent?: "answer" | "skip";
    };
  }>("/sessions/:sessionId/respondent/answer", async (request, reply) => {
    const body = submitRespondentAnswerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid answer payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await submitRespondentAnswer(
        request.params.sessionId,
        body.data.content,
        {
          answerIntent: body.data.intent,
        },
      );
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error ? error.message : "Unable to process answer.",
      });
    }
  });

  app.post<{
    Params: {
      sessionId: string;
      assetId: string;
    };
    Body: unknown;
  }>(
    "/sessions/:sessionId/respondent/assets/:assetId/reaction",
    async (request, reply) => {
      const body = submitAssetReactionSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: "Invalid asset reaction payload.",
          issues: body.error.flatten(),
        });
      }

      try {
        return await submitAssetReaction(
          request.params.sessionId,
          request.params.assetId,
          body.data,
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to capture asset reaction.",
        });
      }
    },
  );

  app.post<{
    Params: {
      sessionId: string;
    };
    Body: {
      content: string;
      sourceEventType?: string;
      transcriptItemId?: string | null;
      realtimeSessionExpiresAt?: string | null;
      transport?: string;
    };
  }>(
    "/sessions/:sessionId/respondent/realtime-answer",
    async (request, reply) => {
      const body = submitRespondentRealtimeAnswerSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: "Invalid realtime answer payload.",
          issues: body.error.flatten(),
        });
      }

      try {
        return await submitRespondentAnswer(
          request.params.sessionId,
          body.data.content,
          {
            participantPayload: {
              inputMode: "realtime_voice",
              transport: body.data.transport,
              realtime: {
                sourceEventType: body.data.sourceEventType,
                transcriptItemId: body.data.transcriptItemId ?? null,
                sessionExpiresAt: body.data.realtimeSessionExpiresAt ?? null,
                submittedAt: new Date().toISOString(),
              },
            },
          },
        );
      } catch (error) {
        request.log.error(error);
        return reply.status(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to process realtime answer.",
        });
      }
    },
  );

  app.post<{
    Params: {
      sessionId: string;
    };
    Body: {
      audioBase64: string;
      mimeType: string;
      voice?: string;
    };
  }>("/sessions/:sessionId/respondent/voice-answer", async (request, reply) => {
    const body = submitRespondentVoiceAnswerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        message: "Invalid voice answer payload.",
        issues: body.error.flatten(),
      });
    }

    try {
      return await submitRespondentVoiceAnswer(
        request.params.sessionId,
        body.data,
      );
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to process voice answer.",
      });
    }
  });

  app.post("/voice/realtime-session", async (request, reply) => {
    try {
      return await createRealtimeVoiceSession();
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Unable to create realtime voice session.",
      });
    }
  });

  app.post<{
    Params: {
      sessionId: string;
    };
  }>(
    "/sessions/:sessionId/respondent/realtime-session",
    async (request, reply) => {
      try {
        return await createRealtimeVoiceSession({
          sessionId: request.params.sessionId,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to create realtime voice session.",
        });
      }
    },
  );

  app.get<{
    Params: {
      sessionId: string;
    };
  }>("/sessions/:sessionId/audit", async (request, reply) => {
    try {
      return await getSessionAudit(request.params.sessionId);
    } catch (error) {
      request.log.error(error);
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Session not found.",
      });
    }
  });

  return app;
}
