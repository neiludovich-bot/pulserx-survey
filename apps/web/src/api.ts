import type {
  AbandonStudyOpenSessionsResponse,
  AssetReactionResponse,
  RespondentSessionResponse,
  CreateStudyAsset,
  CreateStudyBranchRule,
  CreateStudyBranchRules,
  AddStudyCustomGptAssetSource,
  AddStudyCustomGptSitemapSource,
  IntegrationReadinessResponse,
  IntegrationVerificationResponse,
  LocalEnvironmentConfigResponse,
  MvpCustomGptSurveyResponse,
  MvpCustomGptSurveySpeechRequest,
  MvpCustomGptSurveySpeechResponse,
  MvpCustomGptSurveyStartRequest,
  MvpCustomGptSurveyVoiceTranscribeRequest,
  MvpCustomGptSurveyVoiceTranscribeResponse,
  MvpCustomGptSurveyVoiceTurnRequest,
  MvpCustomGptSurveyVoiceTurnResponse,
  MvpCustomGptSourcePreviewRequest,
  MvpCustomGptSourcePreviewResponse,
  PreviewSurveyImportRequest,
  PublishSurveyImportResponse,
  RealtimeVoiceSessionResponse,
  SessionAuditResponse,
  SimulateStudyBranchRoute,
  StudyGuideCleanupApplyResponse,
  StudyGuideSourceNoteRetentionResponse,
  StudyCustomGptVerificationResponse,
  StudyCustomGptSourcesResponse,
  StudySettingsResponse,
  StudyAssetDisplayModeResponse,
  StudyAssetMutationResponse,
  StudyBranchRuleBatchMutationResponse,
  StudyBranchRuleMutationResponse,
  StudyBranchRouteSimulationResponse,
  StudyRecommendedBranchRulesApplyResponse,
  StudyGraphResponse,
  StudyLaunchCheckResponse,
  StudyLaunchSmokeTestResponse,
  StartTestSessionRequest,
  StudyQuestionGroundingPreviewResponse,
  StudyQuestionGroundingResponse,
  StudySourceContextPreviewResponse,
  StudySummary,
  UpdateStudySourceContextNotes,
  UpdateStudySourceContextNotesResponse,
  SurveyImportPreview,
  SubmitAssetReaction,
  SubmitRespondentAnswerResponse,
  SubmitRespondentRealtimeAnswer,
  SubmitRespondentVoiceAnswer,
  SubmitRespondentVoiceAnswerResponse,
  UpdateLocalEnvironmentConfig,
  UpdateStudyAssetDisplayMode,
  UpdateStudyQuestionGrounding,
  UpdateStudySettings,
} from "@interview/schemas";
import { webEnv } from "./env";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    let message = `API request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore JSON parse failures and use the default message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getStudies() {
  return apiFetch<StudySummary[]>("/studies");
}

export function getIntegrationReadiness() {
  return apiFetch<IntegrationReadinessResponse>("/integrations/readiness");
}

export function verifyIntegrations() {
  return apiFetch<IntegrationVerificationResponse>("/integrations/verify", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getLocalEnvironmentConfig() {
  return apiFetch<LocalEnvironmentConfigResponse>("/admin/local-env");
}

export function updateLocalEnvironmentConfig(
  input: UpdateLocalEnvironmentConfig,
) {
  return apiFetch<LocalEnvironmentConfigResponse>("/admin/local-env", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getStudyGraph(studyId: string) {
  return apiFetch<StudyGraphResponse>(`/studies/${studyId}/graph`);
}

export function getStudySettings(studyId: string) {
  return apiFetch<StudySettingsResponse>(`/studies/${studyId}/settings`);
}

export function getStudyLaunchCheck(studyId: string) {
  return apiFetch<StudyLaunchCheckResponse>(`/studies/${studyId}/launch-check`);
}

export function runStudyLaunchSmokeTest(studyId: string) {
  return apiFetch<StudyLaunchSmokeTestResponse>(
    `/studies/${studyId}/launch-smoke-test`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function applyStudyGuideCleanup(studyId: string) {
  return apiFetch<StudyGuideCleanupApplyResponse>(
    `/studies/${studyId}/guide-cleanup/apply`,
    {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    },
  );
}

export function retainStudyGuideSourceNotes(studyId: string) {
  return apiFetch<StudyGuideSourceNoteRetentionResponse>(
    `/studies/${studyId}/guide-cleanup/retain-source-notes`,
    {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    },
  );
}

export function updateStudySettings(
  studyId: string,
  input: UpdateStudySettings,
) {
  return apiFetch<StudySettingsResponse>(`/studies/${studyId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function verifyStudyCustomGpt(studyId: string) {
  return apiFetch<StudyCustomGptVerificationResponse>(
    `/studies/${studyId}/customgpt/verify`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function getStudyCustomGptSources(studyId: string) {
  return apiFetch<StudyCustomGptSourcesResponse>(
    `/studies/${studyId}/customgpt/sources`,
  );
}

export function addStudyCustomGptSitemapSource(
  studyId: string,
  input: AddStudyCustomGptSitemapSource,
) {
  return apiFetch<StudyCustomGptSourcesResponse>(
    `/studies/${studyId}/customgpt/sources/sitemap`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function addStudyCustomGptAssetSource(
  studyId: string,
  input: AddStudyCustomGptAssetSource,
) {
  return apiFetch<StudyCustomGptSourcesResponse>(
    `/studies/${studyId}/customgpt/sources/asset`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateStudyQuestionGrounding(
  studyId: string,
  nodeId: string,
  input: UpdateStudyQuestionGrounding,
) {
  return apiFetch<StudyQuestionGroundingResponse>(
    `/studies/${studyId}/questions/${nodeId}/grounding`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function updateStudySourceContextNotes(
  studyId: string,
  input: UpdateStudySourceContextNotes,
) {
  return apiFetch<UpdateStudySourceContextNotesResponse>(
    `/studies/${studyId}/source-context-notes`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function previewStudyQuestionGrounding(studyId: string, nodeId: string) {
  return apiFetch<StudyQuestionGroundingPreviewResponse>(
    `/studies/${studyId}/questions/${nodeId}/grounding-preview`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function previewStudySourceContext(studyId: string) {
  return apiFetch<StudySourceContextPreviewResponse>(
    `/studies/${studyId}/source-context-preview`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function updateStudyAssetDisplayMode(
  studyId: string,
  assetId: string,
  input: UpdateStudyAssetDisplayMode,
) {
  return apiFetch<StudyAssetDisplayModeResponse>(
    `/studies/${studyId}/assets/${assetId}/display-mode`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function createStudyAsset(studyId: string, input: CreateStudyAsset) {
  return apiFetch<StudyAssetMutationResponse>(`/studies/${studyId}/assets`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createStudyBranchRule(
  studyId: string,
  input: CreateStudyBranchRule,
) {
  return apiFetch<StudyBranchRuleMutationResponse>(
    `/studies/${studyId}/branch-rules`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createStudyBranchRules(
  studyId: string,
  input: CreateStudyBranchRules,
) {
  return apiFetch<StudyBranchRuleBatchMutationResponse>(
    `/studies/${studyId}/branch-rules/batch`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function applyRecommendedStudyBranchRules(studyId: string) {
  return apiFetch<StudyRecommendedBranchRulesApplyResponse>(
    `/studies/${studyId}/branch-rules/recommended`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function simulateStudyBranchRoute(
  studyId: string,
  input: SimulateStudyBranchRoute,
) {
  return apiFetch<StudyBranchRouteSimulationResponse>(
    `/studies/${studyId}/branch-routes/simulate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function previewSurveyImport(input: PreviewSurveyImportRequest) {
  return apiFetch<SurveyImportPreview>("/admin/survey-imports/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function publishSurveyImport(preview: SurveyImportPreview) {
  return apiFetch<PublishSurveyImportResponse>(
    "/admin/survey-imports/publish",
    {
      method: "POST",
      body: JSON.stringify({ preview }),
    },
  );
}

export function startTestSession(
  studyId: string,
  input: StartTestSessionRequest = {},
) {
  return apiFetch<RespondentSessionResponse>(
    `/studies/${studyId}/test-sessions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createRespondentSession(studyId: string) {
  return apiFetch<RespondentSessionResponse>(
    `/studies/${studyId}/respondent-sessions`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function abandonStudyOpenSessions(studyId: string) {
  return apiFetch<AbandonStudyOpenSessionsResponse>(
    `/studies/${studyId}/sessions/abandon-open`,
    {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    },
  );
}

export function getRespondentSession(sessionId: string) {
  return apiFetch<RespondentSessionResponse>(
    `/sessions/${sessionId}/respondent`,
  );
}

export function submitRespondentAnswer(
  sessionId: string,
  content: string,
  options: { intent?: "answer" | "skip" } = {},
) {
  return apiFetch<SubmitRespondentAnswerResponse>(
    `/sessions/${sessionId}/respondent/answer`,
    {
      method: "POST",
      body: JSON.stringify({ content, intent: options.intent ?? "answer" }),
    },
  );
}

export function submitAssetReaction(
  sessionId: string,
  assetId: string,
  input: SubmitAssetReaction,
) {
  return apiFetch<AssetReactionResponse>(
    `/sessions/${sessionId}/respondent/assets/${assetId}/reaction`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function submitRespondentRealtimeAnswer(
  sessionId: string,
  input: SubmitRespondentRealtimeAnswer,
) {
  return apiFetch<SubmitRespondentAnswerResponse>(
    `/sessions/${sessionId}/respondent/realtime-answer`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function submitRespondentVoiceAnswer(
  sessionId: string,
  input: SubmitRespondentVoiceAnswer,
) {
  return apiFetch<SubmitRespondentVoiceAnswerResponse>(
    `/sessions/${sessionId}/respondent/voice-answer`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createRealtimeVoiceSession(sessionId?: string) {
  return apiFetch<RealtimeVoiceSessionResponse>(
    sessionId
      ? `/sessions/${sessionId}/respondent/realtime-session`
      : "/voice/realtime-session",
    {
      method: "POST",
    },
  );
}

export function getSessionAudit(sessionId: string) {
  return apiFetch<SessionAuditResponse>(`/sessions/${sessionId}/audit`);
}

export function startMvpCustomGptSurvey(
  input: MvpCustomGptSurveyStartRequest = {},
) {
  return apiFetch<MvpCustomGptSurveyResponse>("/mvp/customgpt-survey/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitMvpCustomGptSurveyTurn(
  sessionId: string,
  content: string,
) {
  return apiFetch<MvpCustomGptSurveyResponse>("/mvp/customgpt-survey/turn", {
    method: "POST",
    body: JSON.stringify({ sessionId, content }),
  });
}

export function submitMvpCustomGptSurveyVoiceTurn(
  input: MvpCustomGptSurveyVoiceTurnRequest,
) {
  return apiFetch<MvpCustomGptSurveyVoiceTurnResponse>(
    "/mvp/customgpt-survey/voice-turn",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function transcribeMvpCustomGptSurveyVoice(
  input: MvpCustomGptSurveyVoiceTranscribeRequest,
) {
  return apiFetch<MvpCustomGptSurveyVoiceTranscribeResponse>(
    "/mvp/customgpt-survey/voice-transcribe",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function synthesizeMvpCustomGptSurveySpeech(
  input: MvpCustomGptSurveySpeechRequest,
) {
  return apiFetch<MvpCustomGptSurveySpeechResponse>(
    "/mvp/customgpt-survey/speech",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function previewMvpCustomGptSource(
  input: MvpCustomGptSourcePreviewRequest,
) {
  return apiFetch<MvpCustomGptSourcePreviewResponse>(
    "/mvp/customgpt-survey/source-preview",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
