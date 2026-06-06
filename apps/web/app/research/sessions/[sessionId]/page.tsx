import type { SessionAuditResponse } from "@interview/schemas";
import Link from "next/link";
import { getSessionAudit } from "../../../../src/api";
import {
  getGroundingAnswerDisplayText,
  getTurnQuestionDisplayText,
  stripInlineReferences,
} from "../../../../src/grounding";

type AuditGrounding = NonNullable<
  SessionAuditResponse["transcript"][number]["grounding"]
>;

type GroundingAttempt = {
  kind: "clinical_study_context";
  required: true;
  status: "succeeded" | "failed";
  source: "approved_source_note" | "customgpt" | "imported_guide" | "none";
  reason: string | null;
  referenceCount: number;
  contextQuestion: string;
  assetTitle: string | null;
  generatedAt: string;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function formatAssetReactionKind(kind: string) {
  switch (kind) {
    case "COMPREHENSION":
      return "Reviewed";
    case "APPEAL":
      return "Helpful";
    case "CONCERN":
      return "Confusing";
    case "OBJECTION":
      return "Objection";
    case "COMPARISON":
      return "Comparison";
    case "OPEN_FEEDBACK":
      return "Open feedback";
    default:
      return kind;
  }
}

function getGroundingAttemptFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as Record<string, unknown>)
    .proactiveGroundingAttempt;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  if (
    value.kind !== "clinical_study_context" ||
    value.required !== true ||
    (value.status !== "succeeded" && value.status !== "failed") ||
    (value.source !== "approved_source_note" &&
      value.source !== "customgpt" &&
      value.source !== "imported_guide" &&
      value.source !== "none") ||
    typeof value.referenceCount !== "number" ||
    typeof value.contextQuestion !== "string" ||
    typeof value.generatedAt !== "string"
  ) {
    return null;
  }

  return {
    kind: value.kind,
    required: value.required,
    status: value.status,
    source: value.source,
    reason: typeof value.reason === "string" ? value.reason : null,
    referenceCount: value.referenceCount,
    contextQuestion: value.contextQuestion,
    assetTitle: typeof value.assetTitle === "string" ? value.assetTitle : null,
    generatedAt: value.generatedAt,
  } satisfies GroundingAttempt;
}

function formatGroundingAttemptSource(source: GroundingAttempt["source"]) {
  switch (source) {
    case "approved_source_note":
      return "Approved source note";
    case "customgpt":
      return "CustomGPT";
    case "imported_guide":
      return "Imported guide";
    case "none":
      return "No source";
  }
}

function groundingAttemptStatusClass(status: GroundingAttempt["status"]) {
  return status === "succeeded"
    ? "status-pill status-pill-good"
    : "status-pill status-pill-bad";
}

function AuditReferenceList({
  references,
}: {
  references: AuditGrounding["references"];
}) {
  if (references.length === 0) {
    return null;
  }

  return (
    <ul className="plain-list audit-reference-list">
      {references.map((reference, index) => (
        <li key={`${reference.citationId}-${index}`}>
          <strong>
            [{index + 1}] {reference.title ?? `Citation ${reference.citationId}`}
          </strong>
          {reference.url ? (
            <a
              className="text-link"
              href={reference.url}
              rel="noreferrer"
              target="_blank"
            >
              {reference.url}
            </a>
          ) : null}
          {reference.description ? (
            <p className="muted-copy">{reference.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AuditGroundingAttemptCard({
  attempt,
  setupHref,
}: {
  attempt: GroundingAttempt;
  setupHref?: string | null;
}) {
  const showSetupAction =
    attempt.status === "failed" &&
    (attempt.source === "none" ||
      attempt.reason?.includes("CUSTOMGPT") ||
      attempt.reason?.includes("CustomGPT"));

  return (
    <div className="audit-block audit-grounding">
      <div className="panel-title-row">
        <h3>Proactive Grounding Attempt</h3>
        <span className={groundingAttemptStatusClass(attempt.status)}>
          {attempt.status === "succeeded" ? "Grounded" : "Not Grounded"}
        </span>
      </div>
      <div className="audit-decision-summary">
        <div>
          <span className="label">Source</span>
          <strong>{formatGroundingAttemptSource(attempt.source)}</strong>
        </div>
        <div>
          <span className="label">References</span>
          <strong>{attempt.referenceCount}</strong>
        </div>
        <div>
          <span className="label">Generated</span>
          <strong>{attempt.generatedAt}</strong>
        </div>
      </div>
      {attempt.assetTitle ? (
        <p className="micro-copy">Asset: {attempt.assetTitle}</p>
      ) : null}
      <p className="muted-copy">{attempt.contextQuestion}</p>
      {attempt.reason ? (
        <p
          className={
            attempt.status === "failed" ? "error-copy" : "muted-copy"
          }
        >
          {attempt.reason}
        </p>
      ) : null}
      {showSetupAction && setupHref ? (
        <Link className="button-secondary" href={setupHref}>
          Open CustomGPT Setup
        </Link>
      ) : null}
    </div>
  );
}

function AuditGroundingAttemptFromPayload({
  payload,
  setupHref,
}: {
  payload: unknown;
  setupHref?: string | null;
}) {
  const attempt = getGroundingAttemptFromPayload(payload);

  return attempt ? (
    <AuditGroundingAttemptCard attempt={attempt} setupHref={setupHref} />
  ) : null;
}

function AuditGroundingCard({ grounding }: { grounding: AuditGrounding }) {
  if (grounding.kind === "clinical_study_context") {
    return (
      <div className="audit-block audit-grounding">
        <h3>Source Context</h3>
        {grounding.assetTitle ? (
          <p className="micro-copy">From {grounding.assetTitle}</p>
        ) : null}
        <p>{getGroundingAnswerDisplayText(grounding)}</p>
        {grounding.references.length > 0 ? (
          <AuditReferenceList references={grounding.references} />
        ) : (
          <p className="micro-copy">No references were returned.</p>
        )}
      </div>
    );
  }

  if (grounding.references.length === 0) {
    return null;
  }

  return (
    <div className="audit-block audit-grounding">
      <h3>Grounded Answer Sources</h3>
      <AuditReferenceList references={grounding.references} />
    </div>
  );
}

export default async function SessionAuditPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const audit = await getSessionAudit(sessionId);
  const setupHref = `/research/setup?returnTo=${encodeURIComponent(
    `/research/studies/${audit.session.studyId}/settings#customgpt-sources`,
  )}`;
  const currentGroundingAttempt = getGroundingAttemptFromPayload(
    audit.currentQuestion?.payload ?? null,
  );

  return (
    <main className="shell">
      <section className="page-header">
        <Link
          className="back-link"
          href={`/research/studies/${audit.session.studyId}`}
        >
          Back to study
        </Link>
        <p className="eyebrow">Session Audit</p>
        <h1>{audit.session.respondentLabel}</h1>
        <p className="lede">
          Review each turn with the transcript, analysis output, and question
          selection decision that followed.
        </p>
      </section>

      <section className="detail-grid">
        <article className="panel stack-sm">
          <span className="label">Session Status</span>
          <strong>{audit.session.status}</strong>
          <p className="muted-copy">
            Current node: {audit.session.currentNodeKey ?? "complete"}
          </p>
        </article>

        <article className="panel stack-sm">
          <span className="label">Transcript Length</span>
          <strong>{audit.transcript.length} turns</strong>
          <p className="muted-copy">{audit.session.studyName}</p>
        </article>

        <article className="panel stack-sm">
          <span className="label">Asset Exposures</span>
          <strong>{audit.sessionAssets.length}</strong>
          <p className="muted-copy">
            Logged staged materials shown during this interview.
          </p>
        </article>

        <article className="panel stack-sm">
          <span className="label">Time Limit</span>
          <strong>
            {formatDuration(audit.guardrails.timing.remainingSeconds)} left
          </strong>
          <p className="muted-copy">
            {formatDuration(audit.guardrails.timing.elapsedSeconds)} elapsed of{" "}
            {formatDuration(audit.guardrails.timing.targetDurationSeconds)}
            {audit.guardrails.timing.isOverTime ? " | over time" : ""}
          </p>
        </article>

        <article className="panel stack-sm">
          <span className="label">No-Fixation Guardrail</span>
          <strong>
            {audit.guardrails.attempts.highestAttemptCount} /{" "}
            {audit.guardrails.attempts.maxAttemptsPerQuestion}
          </strong>
          <p className="muted-copy">
            Highest observed attempts vs. max attempts per question.
          </p>
        </article>

        <article className="panel stack-sm">
          <span className="label">Off-Survey Redirects</span>
          <strong>
            {audit.guardrails.offSurvey.redirectCount} /{" "}
            {audit.guardrails.offSurvey.maxRedirects}
          </strong>
          <p className="muted-copy">
            {audit.guardrails.offSurvey.remainingRedirects} redirect
            {audit.guardrails.offSurvey.remainingRedirects === 1 ? "" : "s"}{" "}
            remaining
            {audit.guardrails.offSurvey.isAtLimit ? " | at limit" : ""}
          </p>
        </article>
      </section>

      <section className="stack-lg">
        {audit.currentQuestion ? (
          <article className="panel stack-md">
            <div className="panel-title-row">
              <div>
                <span className="label">
                  {audit.currentQuestion.nodeKey ?? "current question"}
                </span>
                <h2>Current Question</h2>
              </div>
            </div>
            <p>{audit.currentQuestion.content}</p>
            {currentGroundingAttempt ? (
              <AuditGroundingAttemptCard
                attempt={currentGroundingAttempt}
                setupHref={setupHref}
              />
            ) : null}
            {audit.currentQuestion.grounding ? (
              <AuditGroundingCard grounding={audit.currentQuestion.grounding} />
            ) : null}
          </article>
        ) : null}

        <article className="panel stack-md">
          <h2>Guardrail Evidence</h2>
          {audit.guardrails.attempts.counts.length === 0 ? (
            <p className="muted-copy">
              No participant answer attempts have been recorded yet.
            </p>
          ) : (
            <ul className="plain-list compact-list">
              {audit.guardrails.attempts.counts.map((item) => (
                <li key={item.nodeId}>
                  <strong>{item.title ?? item.nodeKey ?? item.nodeId}</strong>
                  <span className="muted-copy">
                    {item.attemptCount} attempt
                    {item.attemptCount === 1 ? "" : "s"} of{" "}
                    {audit.guardrails.attempts.maxAttemptsPerQuestion}
                  </span>
                  {item.nodeKey ? (
                    <p className="micro-copy">{item.nodeKey}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel stack-md">
          <h2>Asset Exposures</h2>
          {audit.sessionAssets.length === 0 ? (
            <p className="muted-copy">
              No staged assets were shown in this session.
            </p>
          ) : (
            <ul className="plain-list">
              {audit.sessionAssets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.title}</strong>
                  <span className="muted-copy">
                    {asset.assetType}
                    {asset.displayMode ? ` | ${asset.displayMode}` : ""}
                    {asset.sourceActionKey
                      ? ` | from ${asset.sourceActionKey}`
                      : ""}
                  </span>
                  <p className="micro-copy">
                    {asset.shownAt ?? "shown during session"}
                  </p>
                  {asset.reaction ? (
                    <p className="micro-copy">
                      Reaction: {formatAssetReactionKind(asset.reaction.kind)} |{" "}
                      {asset.reaction.status}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel stack-md">
          <h2>Transcript</h2>
          <div className="transcript-stack">
            {audit.transcript.map((turn) => (
              <article
                className={`chat-bubble chat-bubble-${turn.role}`}
                key={turn.id}
              >
                <span className="chat-role">
                  {turn.role === "interviewer" ? "Interviewer" : "Participant"}
                </span>
                {turn.grounding ? (
                  <AuditGroundingCard grounding={turn.grounding} />
                ) : null}
                <p>{getTurnQuestionDisplayText(turn)}</p>
              </article>
            ))}
          </div>
        </article>

        <article className="stack-lg">
          {audit.turnAudit.map((item) => (
            <article className="panel stack-md" key={item.turnId}>
              <div className="audit-heading">
                <div>
                  <span className="label">
                    {item.nodeKey ?? "unknown node"}
                  </span>
                  <h2>Turn Review</h2>
                </div>
              </div>

              <div className="audit-block">
                <h3>Question</h3>
                <p>
                  {item.question?.grounding?.contextQuestion ??
                    item.question?.content ??
                    "Question turn missing"}
                </p>
              </div>

              {item.question?.payload ? (
                <AuditGroundingAttemptFromPayload
                  payload={item.question.payload}
                  setupHref={setupHref}
                />
              ) : null}

              {item.question?.grounding ? (
                <div className="audit-block audit-grounding">
                  <h3>Proactive Source Context</h3>
                  <p>{item.question.grounding.answer}</p>
                  {item.question.grounding.references.length > 0 ? (
                    <AuditReferenceList
                      references={item.question.grounding.references}
                    />
                  ) : (
                    <p className="micro-copy">No references were returned.</p>
                  )}
                </div>
              ) : null}

              <div className="audit-block">
                <h3>Response</h3>
                <p>{item.response.content}</p>
                {item.response.payload ? (
                  <details className="audit-json">
                    <summary>Response Metadata</summary>
                    <pre>{JSON.stringify(item.response.payload, null, 2)}</pre>
                  </details>
                ) : null}
              </div>

              <div className="audit-block audit-decision-block">
                <h3>Turn Decision</h3>
                <div className="audit-decision-summary">
                  <div>
                    <span className="label">Action</span>
                    <strong>{item.decision.action ?? "missing"}</strong>
                  </div>
                  <div>
                    <span className="label">Next Node</span>
                    <strong>
                      {item.decision.selectedNodeTitle ??
                        item.decision.selectedNodeKey ??
                        "none"}
                    </strong>
                    {item.decision.selectedNodeKey ? (
                      <p className="micro-copy">
                        {item.decision.selectedNodeKey}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <span className="label">Source</span>
                    <strong>{item.decision.source ?? "unknown"}</strong>
                  </div>
                </div>
                {item.decision.rationale ? (
                  <p className="muted-copy">{item.decision.rationale}</p>
                ) : (
                  <p className="micro-copy">No rationale was persisted.</p>
                )}
              </div>

              {item.asset ? (
                <div className="audit-block">
                  <h3>Active Asset</h3>
                  <p>
                    <strong>{item.asset.title}</strong>
                  </p>
                  <p className="muted-copy">
                    {item.asset.assetType}
                    {item.asset.displayMode
                      ? ` | ${item.asset.displayMode}`
                      : ""}
                    {item.asset.shownAt ? ` | shown ${item.asset.shownAt}` : ""}
                  </p>
                  {item.asset.reaction ? (
                    <p className="micro-copy">
                      Reaction:{" "}
                      {formatAssetReactionKind(item.asset.reaction.kind)} |{" "}
                      {item.asset.reaction.status}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {item.analysis.groundedResponse ||
              item.analysis.groundedReferences.length > 0 ? (
                <div className="audit-block audit-grounding">
                  <h3>Grounded Answer</h3>
                  {item.analysis.groundedResponse ? (
                    <p>{stripInlineReferences(item.analysis.groundedResponse)}</p>
                  ) : (
                    <p className="muted-copy">
                      No grounded answer was returned for this turn.
                    </p>
                  )}
                  {item.analysis.groundedReferences.length > 0 ? (
                    <AuditReferenceList
                      references={item.analysis.groundedReferences}
                    />
                  ) : (
                    <p className="micro-copy">No references were returned.</p>
                  )}
                </div>
              ) : null}

              <div className="audit-grid">
                <section className="audit-json">
                  <h3>Analysis</h3>
                  <pre>{JSON.stringify(item.analysis.output, null, 2)}</pre>
                </section>
                <section className="audit-json">
                  <h3>Decision</h3>
                  <pre>{JSON.stringify(item.decision.output, null, 2)}</pre>
                </section>
              </div>
            </article>
          ))}
        </article>
      </section>
    </main>
  );
}
