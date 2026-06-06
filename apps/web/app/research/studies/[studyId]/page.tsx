import Link from "next/link";
import { getStudyGraph, getStudyLaunchCheck } from "../../../../src/api";
import { StartSessionButton } from "../../../../src/components/StartSessionButton";
import { StudyAssetForm } from "../../../../src/components/StudyAssetForm";
import { StudyAssetList } from "../../../../src/components/StudyAssetList";
import { StudyBranchRuleForm } from "../../../../src/components/StudyBranchRuleForm";
import { StudyGuideCleanupPanel } from "../../../../src/components/StudyGuideCleanupPanel";
import { StudyLaunchReadinessPanel } from "../../../../src/components/StudyLaunchReadinessPanel";
import { StudyQuestionNodeList } from "../../../../src/components/StudyQuestionNodeList";
import { StudySessionPanel } from "../../../../src/components/StudySessionPanel";
import { StudySourceContextPanel } from "../../../../src/components/StudySourceContextPanel";

function formatComparisonValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

export default async function StudyDetailPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const [graph, launchCheck] = await Promise.all([
    getStudyGraph(studyId),
    getStudyLaunchCheck(studyId),
  ]);

  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href="/research">
          Back to studies
        </Link>
        <p className="eyebrow">Study Graph</p>
        <h1>{graph.study.name}</h1>
        <p className="lede">{graph.study.description}</p>
        <Link
          className="button-secondary"
          href={`/research/studies/${studyId}/settings`}
        >
          Study Settings
        </Link>
      </section>

      <section className="detail-grid">
        <StudyLaunchReadinessPanel launchCheck={launchCheck} />

        <article className="panel stack-md" id="test-session">
          <div className="stack-sm">
            <span className="label">Browser Interview Launch</span>
            <StartSessionButton
              launchCheck={launchCheck}
              nodes={graph.nodes}
              studyId={graph.study.id}
            />
          </div>

          <div className="stack-sm">
            <h2>Modules</h2>
            <ul className="plain-list">
              {graph.modules.map((module) => (
                <li key={module.id}>
                  <strong>{module.title}</strong>
                  <span className="muted-copy">Module {module.position}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel stack-md" id="adaptive-flow">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Adaptive Flow</span>
              <h2>{graph.adaptiveFlow.totalRules} rules</h2>
            </div>
            <span
              className={
                graph.adaptiveFlow.warnings.length === 0
                  ? "status-pill status-pill-good"
                  : "status-pill status-pill-muted"
              }
            >
              {graph.adaptiveFlow.warnings.length === 0 ? "Ready" : "Review"}
            </span>
          </div>
          <div className="detail-grid">
            <div className="stack-sm">
              <span className="label">Conditional</span>
              <strong>{graph.adaptiveFlow.conditionalRules}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Fallback</span>
              <strong>{graph.adaptiveFlow.fallbackRules}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Wrap-Up</span>
              <strong>{graph.adaptiveFlow.terminalNodeCount}</strong>
            </div>
          </div>
          {graph.adaptiveFlow.warnings.length > 0 ? (
            <ul className="plain-list">
              {graph.adaptiveFlow.warnings.map((warning) => (
                <li key={warning}>
                  <span className="muted-copy">{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">
              Conditional routes, fallback routes, and wrap-up nodes are
              present.
            </p>
          )}
          <div className="stack-sm" id="suggested-branches">
            <h3>Add Conditional Branch</h3>
            <StudyBranchRuleForm
              adaptiveFlow={graph.adaptiveFlow}
              branchSuggestions={graph.branchSuggestions}
              nodes={graph.nodes}
              studyId={graph.study.id}
            />
          </div>

          <div className="stack-sm" id="route-review">
            <div className="panel-title-row">
              <h3>Adaptive Routing Review</h3>
              <span className="status-pill status-pill-muted">
                {graph.routeReview.length}
              </span>
            </div>
            {graph.routeReview.length === 0 ? (
              <p className="muted-copy">
                No saved conditional routes yet. Apply selected suggestions,
                then review the grouped routing map here.
              </p>
            ) : (
              <ul className="plain-list compact-list">
                {graph.routeReview.map((group) => (
                  <li key={group.fromNodeId}>
                    <div className="stack-sm">
                      <strong>{group.fromNodeTitle}</strong>
                      <span className="muted-copy">
                        {group.dryRunnableConditionalCount} of{" "}
                        {group.conditionalRoutes.length} conditional route(s)
                        ready for dry runs
                        {group.hasFallback ? " | fallback configured" : ""}
                      </span>
                      {group.warning ? (
                        <span className="micro-copy">{group.warning}</span>
                      ) : null}
                    </div>
                    <ul className="plain-list compact-list">
                      {group.conditionalRoutes.map((route) => {
                        const comparisonValue = formatComparisonValue(
                          route.comparisonValue,
                        );

                        return (
                          <li key={route.ruleId}>
                            <strong>
                              {route.toNodeTitle} | {route.conditionType}
                            </strong>
                            <span className="micro-copy">
                              priority {route.priority}
                              {route.factKey ? ` | fact ${route.factKey}` : ""}
                              {comparisonValue
                                ? ` | contains ${comparisonValue}`
                                : ""}
                            </span>
                            <span className="muted-copy">
                              {route.dryRunnable
                                ? "Dry-run ready"
                                : "Needs criteria"}{" "}
                              | {route.dryRunReason}
                            </span>
                          </li>
                        );
                      })}
                      {group.fallbackRoute ? (
                        <li>
                          <strong>
                            Fallback -&gt; {group.fallbackRoute.toNodeTitle}
                          </strong>
                          <span className="micro-copy">
                            priority {group.fallbackRoute.priority}
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        <StudyGuideCleanupPanel
          guideCleanup={graph.guideCleanup}
          openSessionCount={graph.sessionSummary.openSessionCount}
          studyId={graph.study.id}
        />

        <StudySourceContextPanel
          launchCheck={launchCheck}
          sourceContext={graph.sourceContext}
          studyId={graph.study.id}
        />

        <StudySessionPanel
          recentSessions={graph.recentSessions}
          sessionSummary={graph.sessionSummary}
          studyId={graph.study.id}
        />
      </section>

      <section className="stack-lg">
        <article className="panel stack-md" id="question-nodes">
          <h2>Question Nodes</h2>
          <StudyQuestionNodeList
            initialNodes={graph.nodes}
            studyId={graph.study.id}
          />
        </article>

        <article className="panel stack-md" id="staged-assets">
          <h2>Staged Assets</h2>
          <StudyAssetForm nodes={graph.nodes} studyId={graph.study.id} />
          <StudyAssetList
            assetStageRules={graph.assetStageRules}
            assets={graph.assets}
            studyId={graph.study.id}
          />
        </article>

        <article className="panel stack-md">
          <h2>Study Actions</h2>
          {graph.actions.length === 0 ? (
            <p className="muted-copy">
              No explicit actions are configured yet.
            </p>
          ) : (
            <ul className="plain-list">
              {graph.actions.map((action) => (
                <li key={action.id}>
                  <strong>{action.key}</strong>
                  <span className="muted-copy">
                    {action.actionType}
                    {action.nodeKey ? ` | node ${action.nodeKey}` : ""}
                    {action.assetKey ? ` | asset ${action.assetKey}` : ""}
                  </span>
                  <p className="micro-copy">
                    priority {action.priority}
                    {action.mustComplete ? " | required" : " | optional"}
                    {action.goal ? ` | ${action.goal}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel stack-md">
          <h2>Asset Stage Rules</h2>
          {graph.assetStageRules.length === 0 ? (
            <p className="muted-copy">
              No asset stage rules are configured yet.
            </p>
          ) : (
            <ul className="plain-list">
              {graph.assetStageRules.map((rule) => (
                <li key={rule.id}>
                  <strong>
                    {rule.assetKey} after{" "}
                    {rule.triggerActionKey ?? "unassigned action"}
                  </strong>
                  <span className="muted-copy">
                    {rule.triggerType} | {rule.displayMode} | priority{" "}
                    {rule.priority}
                  </span>
                  <p className="micro-copy">
                    {rule.required ? "required exposure" : "optional exposure"}
                    {rule.rationale ? ` | ${rule.rationale}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel stack-md">
          <h2>Branch Rules</h2>
          <ul className="plain-list">
            {graph.edges.map((edge) => {
              const fromNode = graph.nodes.find(
                (node) => node.id === edge.fromNodeId,
              );
              const toNode = graph.nodes.find(
                (node) => node.id === edge.toNodeId,
              );
              const comparisonValue = formatComparisonValue(
                edge.comparisonValue,
              );

              return (
                <li key={edge.id}>
                  <strong>
                    {fromNode?.title ?? edge.fromNodeId} -&gt;{" "}
                    {toNode?.title ?? edge.toNodeId}
                  </strong>
                  <span className="muted-copy">
                    {edge.conditionType} | priority {edge.priority}
                  </span>
                  {edge.factKey || comparisonValue ? (
                    <p className="micro-copy">
                      {edge.factKey ? `fact ${edge.factKey}` : "condition"}
                      {comparisonValue ? ` contains ${comparisonValue}` : ""}
                    </p>
                  ) : null}
                  {edge.rationale ? <p>{edge.rationale}</p> : null}
                </li>
              );
            })}
          </ul>
        </article>
      </section>
    </main>
  );
}
