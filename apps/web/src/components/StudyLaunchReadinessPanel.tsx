import Link from "next/link";
import type { StudyLaunchCheckResponse } from "@interview/schemas";
import { StudyLaunchQuickFixes } from "./StudyLaunchQuickFixes";

type Props = {
  launchCheck: StudyLaunchCheckResponse;
};

function launchStatusClass(launchCheck: StudyLaunchCheckResponse) {
  if (launchCheck.blockingItemCount > 0) {
    return "status-pill status-pill-bad";
  }

  return launchCheck.warningItemCount > 0
    ? "status-pill status-pill-muted"
    : "status-pill status-pill-good";
}

function severityClass(
  severity: StudyLaunchCheckResponse["recommendedActions"][number]["severity"],
) {
  return severity === "blocker"
    ? "status-pill status-pill-bad"
    : "status-pill status-pill-muted";
}

export function StudyLaunchReadinessPanel({ launchCheck }: Props) {
  const statusLabel =
    launchCheck.blockingItemCount > 0
      ? "Needs Setup"
      : launchCheck.warningItemCount > 0
        ? "Review"
        : "Ready";

  return (
    <article className="panel stack-md" id="launch-readiness">
      <div className="panel-title-row">
        <div className="stack-sm">
          <span className="label">Launch Readiness</span>
          <h2>{statusLabel}</h2>
        </div>
        <span className={launchStatusClass(launchCheck)}>{statusLabel}</span>
      </div>

      <div className="detail-grid">
        <div className="stack-sm">
          <span className="label">Blockers</span>
          <strong>{launchCheck.blockingItemCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Warnings</span>
          <strong>{launchCheck.warningItemCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Next Steps</span>
          <strong>{launchCheck.recommendedActions.length}</strong>
        </div>
      </div>

      {launchCheck.recommendedActions.length > 0 ? (
        <ol className="plain-list compact-list">
          {launchCheck.recommendedActions.map((item, index) => (
            <li key={item.key}>
              <div className="panel-title-row">
                <div className="stack-sm">
                  <span className="label">
                    Step {index + 1} | {item.category.replace("_", " ")}
                  </span>
                  <strong>{item.label}</strong>
                </div>
                <span className={severityClass(item.severity)}>
                  {item.severity}
                </span>
              </div>
              <span className="muted-copy">{item.action}</span>
              {item.actionHref ? (
                <p className="micro-copy">
                  <Link className="text-link" href={item.actionHref}>
                    {item.actionLabel ?? "Open"}
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted-copy">
          No launch actions are currently recommended.
        </p>
      )}
      <StudyLaunchQuickFixes launchCheck={launchCheck} />
    </article>
  );
}
