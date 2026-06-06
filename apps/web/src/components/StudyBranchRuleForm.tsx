"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  StudyRecommendedBranchRouteDryRun,
  StudyBranchRouteSimulationResponse,
  StudyGraphResponse,
} from "@interview/schemas";
import {
  applyRecommendedStudyBranchRules,
  createStudyBranchRule,
  createStudyBranchRules,
  simulateStudyBranchRoute,
} from "../api";

type StudyGraphNode = StudyGraphResponse["nodes"][number];
type BranchSuggestion = StudyGraphResponse["branchSuggestions"][number];
type Props = {
  adaptiveFlow: StudyGraphResponse["adaptiveFlow"];
  branchSuggestions: StudyGraphResponse["branchSuggestions"];
  nodes: StudyGraphNode[];
  studyId: string;
};

const BRANCH_RULE_BATCH_SIZE = 50;

function toBranchRules(suggestions: BranchSuggestion[]) {
  return suggestions.map((suggestion) => ({
    fromNodeId: suggestion.fromNodeId,
    toNodeId: suggestion.toNodeId,
    matchKeywords: suggestion.matchKeywords,
    rationale: suggestion.rationale,
  }));
}

function chunked<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export function StudyBranchRuleForm({
  adaptiveFlow,
  branchSuggestions,
  nodes,
  studyId,
}: Props) {
  const router = useRouter();
  const orderedNodes = useMemo(
    () =>
      [...nodes].sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }

        return left.title.localeCompare(right.title);
      }),
    [nodes],
  );
  const firstSourceNode = orderedNodes.find((node) => !node.isTerminal);
  const firstTargetNode = orderedNodes.find(
    (node) => node.id !== firstSourceNode?.id,
  );
  const [fromNodeId, setFromNodeId] = useState(firstSourceNode?.id ?? "");
  const [toNodeId, setToNodeId] = useState(firstTargetNode?.id ?? "");
  const [keywords, setKeywords] = useState("");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingSelected, setSavingSelected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>(
    [],
  );
  const [suggestionFilter, setSuggestionFilter] = useState<
    "recommended" | "all"
  >("recommended");
  const [suggestionSearch, setSuggestionSearch] = useState("");
  const [routeTestFromNodeId, setRouteTestFromNodeId] = useState(
    firstSourceNode?.id ?? "",
  );
  const [routeTestAnswer, setRouteTestAnswer] = useState("");
  const [routeTestResult, setRouteTestResult] =
    useState<StudyBranchRouteSimulationResponse | null>(null);
  const [recommendedRouteTests, setRecommendedRouteTests] = useState<
    StudyRecommendedBranchRouteDryRun[]
  >([]);
  const [testingRoute, setTestingRoute] = useState(false);
  const orderedBranchSuggestions = useMemo(
    () =>
      [...branchSuggestions].sort((left, right) => {
        if (left.recommended !== right.recommended) {
          return left.recommended ? -1 : 1;
        }

        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        return left.fromNodeTitle.localeCompare(right.fromNodeTitle);
      }),
    [branchSuggestions],
  );
  const selectedSuggestions = orderedBranchSuggestions.filter((suggestion) =>
    selectedSuggestionIds.includes(suggestion.id),
  );
  const recommendedSuggestions = orderedBranchSuggestions.filter(
    (suggestion) => suggestion.recommended,
  );
  const filteredBranchSuggestions = useMemo(() => {
    const search = suggestionSearch.trim().toLowerCase();

    return orderedBranchSuggestions.filter((suggestion) => {
      if (suggestionFilter === "recommended" && !suggestion.recommended) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        suggestion.fromNodeTitle,
        suggestion.toNodeTitle,
        suggestion.matchKeywords.join(" "),
        suggestion.source.replaceAll("_", " "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [orderedBranchSuggestions, suggestionFilter, suggestionSearch]);

  const canSubmit =
    fromNodeId.trim().length > 0 &&
    toNodeId.trim().length > 0 &&
    fromNodeId !== toNodeId &&
    keywords.trim().length > 0 &&
    !saving &&
    !savingSelected;
  const canApplySelected = selectedSuggestions.length > 0 && !savingSelected;
  const canTestRoute =
    routeTestFromNodeId.trim().length > 0 &&
    routeTestAnswer.trim().length > 0 &&
    !testingRoute;

  function handleFromNodeChange(nextFromNodeId: string) {
    setFromNodeId(nextFromNodeId);

    if (toNodeId === nextFromNodeId) {
      const nextTargetNode = orderedNodes.find(
        (node) => node.id !== nextFromNodeId,
      );
      setToNodeId(nextTargetNode?.id ?? "");
    }
  }

  function loadSuggestion(
    suggestion: StudyGraphResponse["branchSuggestions"][number],
  ) {
    setFromNodeId(suggestion.fromNodeId);
    setToNodeId(suggestion.toNodeId);
    setKeywords(suggestion.matchKeywords.join(", "));
    setRationale(suggestion.rationale);
    setRouteTestFromNodeId(suggestion.fromNodeId);
    setRouteTestAnswer(suggestion.sampleAnswer);
    setStatus("Suggestion loaded.");
  }

  function toggleSuggestion(suggestionId: string) {
    setSelectedSuggestionIds((currentIds) =>
      currentIds.includes(suggestionId)
        ? currentIds.filter((currentId) => currentId !== suggestionId)
        : [...currentIds, suggestionId],
    );
  }

  function selectVisibleSuggestions() {
    setSelectedSuggestionIds(
      filteredBranchSuggestions.map((suggestion) => suggestion.id),
    );
  }

  function selectRecommendedSuggestions() {
    setSelectedSuggestionIds(
      recommendedSuggestions.map((suggestion) => suggestion.id),
    );
  }

  async function applySuggestions(suggestions: BranchSuggestion[]) {
    let createdCount = 0;
    let skippedCount = 0;

    for (const rules of chunked(
      toBranchRules(suggestions),
      BRANCH_RULE_BATCH_SIZE,
    )) {
      const response = await createStudyBranchRules(studyId, {
        rules,
      });

      createdCount += response.createdCount;
      skippedCount += response.skippedCount;
    }

    return {
      createdCount,
      skippedCount,
    };
  }

  function setApplyStatus(input: {
    createdCount: number;
    skippedCount: number;
    label?: string;
  }) {
    const labelCopy = input.label ? `${input.label} ` : "";
    const duplicateCopy =
      input.skippedCount > 0
        ? ` ${input.skippedCount} duplicate ${
            input.skippedCount === 1 ? "rule was" : "rules were"
          } skipped.`
        : "";

    setStatus(
      `${input.createdCount} ${labelCopy}conditional ${
        input.createdCount === 1 ? "branch" : "branches"
      } added.${duplicateCopy}`,
    );
  }

  async function handleApplySelectedSuggestions() {
    if (!canApplySelected) {
      setStatus("Select at least one suggested branch.");
      return;
    }

    setSavingSelected(true);
    setStatus(null);

    try {
      const response = await applySuggestions(selectedSuggestions);

      setSelectedSuggestionIds([]);
      setApplyStatus(response);
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to apply suggested branches.",
      );
    } finally {
      setSavingSelected(false);
    }
  }

  async function handleApplyRecommendedSuggestions() {
    if (recommendedSuggestions.length === 0) {
      setStatus("No recommended suggested branches are available.");
      return;
    }

    setSavingSelected(true);
    setStatus(null);
    setRecommendedRouteTests([]);

    try {
      const response = await applyRecommendedStudyBranchRules(studyId);

      setSelectedSuggestionIds([]);
      setRecommendedRouteTests(response.dryRuns);
      setStatus(
        `${response.createdCount} recommended conditional ${
          response.createdCount === 1 ? "branch" : "branches"
        } added. ${
          response.skippedCount > 0
            ? `${response.skippedCount} duplicate ${
                response.skippedCount === 1 ? "rule was" : "rules were"
              } skipped. `
            : ""
        }${response.passedDryRunCount} of ${response.dryRunCount} dry-run sample answers passed after applying.`,
      );
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to apply recommended branches.",
      );
    } finally {
      setSavingSelected(false);
    }
  }

  async function handleTestRoute() {
    if (!canTestRoute) {
      setStatus("Choose a source question and enter a sample answer.");
      return;
    }

    setTestingRoute(true);
    setRouteTestResult(null);
    setStatus(null);

    try {
      const response = await simulateStudyBranchRoute(studyId, {
        fromNodeId: routeTestFromNodeId,
        answer: routeTestAnswer,
      });
      setRouteTestResult(response);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to test this route.",
      );
    } finally {
      setTestingRoute(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setStatus("Choose two different questions and at least one keyword.");
      return;
    }

    setSaving(true);
    setStatus(null);

    try {
      const matchKeywords = keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean);

      await createStudyBranchRule(studyId, {
        fromNodeId,
        toNodeId,
        matchKeywords,
        rationale: rationale.trim() || undefined,
      });

      setKeywords("");
      setRationale("");
      setStatus("Conditional branch added.");
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to add branch rule.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (orderedNodes.length < 2) {
    return null;
  }

  return (
    <form className="stack-md" onSubmit={handleSubmit}>
      {branchSuggestions.length > 0 ? (
        <div className="stack-sm" id="suggested-branches">
          <div className="panel-title-row">
            <h4>Suggested Conditional Branches</h4>
            <span className="status-pill status-pill-muted">
              {branchSuggestions.length}
            </span>
          </div>
          <div className="detail-grid">
            <div className="stack-sm">
              <span className="label">Active Conditional</span>
              <strong>{adaptiveFlow.conditionalRules}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Recommended Inactive</span>
              <strong>{recommendedSuggestions.length}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Visible</span>
              <strong>{filteredBranchSuggestions.length}</strong>
            </div>
          </div>
          {adaptiveFlow.conditionalRules === 0 &&
          recommendedSuggestions.length > 0 ? (
            <p className="muted-copy">
              This study is still sequential-only. Applying recommended
              suggestions creates deterministic keyword routes that the
              researcher can dry-run below.
            </p>
          ) : null}
          <p className="micro-copy">
            {recommendedSuggestions.length} recommended based on stronger
            follow-up keyword clusters. Suggestions are inactive until applied;
            applied routes are deterministic keyword rules owned by the
            researcher.
          </p>
          <div className="form-grid">
            <label className="form-field">
              <span>Suggestion view</span>
              <select
                value={suggestionFilter}
                onChange={(event) =>
                  setSuggestionFilter(
                    event.target.value === "all" ? "all" : "recommended",
                  )
                }
              >
                <option value="recommended">Recommended</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="form-field">
              <span>Search suggestions</span>
              <input
                placeholder="efficacy, safety, access"
                value={suggestionSearch}
                onChange={(event) => setSuggestionSearch(event.target.value)}
              />
            </label>
          </div>
          <ul className="plain-list compact-list">
            {filteredBranchSuggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <div className="stack-sm">
                  <label className="checkbox-row">
                    <input
                      checked={selectedSuggestionIds.includes(suggestion.id)}
                      onChange={() => toggleSuggestion(suggestion.id)}
                      type="checkbox"
                    />
                    <strong>
                      {suggestion.fromNodeTitle} -&gt; {suggestion.toNodeTitle}
                    </strong>
                  </label>
                  <span className="muted-copy">
                    {suggestion.matchKeywords.join(", ")}
                  </span>
                  <span className="micro-copy">
                    Sample answer: {suggestion.sampleAnswer}
                  </span>
                  <span className="micro-copy">
                    confidence {Math.round(suggestion.confidence * 100)}% |{" "}
                    {suggestion.source.replaceAll("_", " ")}
                    {suggestion.recommended ? " | recommended" : ""}
                  </span>
                  {suggestion.recommendedReason ? (
                    <span className="micro-copy">
                      {suggestion.recommendedReason}
                    </span>
                  ) : null}
                </div>
                <button
                  className="button-secondary"
                  onClick={() => loadSuggestion(suggestion)}
                  type="button"
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
          <div className="composer-footer">
            <button
              className="button-secondary"
              disabled={savingSelected || recommendedSuggestions.length === 0}
              onClick={handleApplyRecommendedSuggestions}
              type="button"
            >
              {savingSelected
                ? "Applying and Testing..."
                : `Apply Recommended & Test (${recommendedSuggestions.length})`}
            </button>
            <button
              className="button-secondary"
              disabled={savingSelected || recommendedSuggestions.length === 0}
              onClick={selectRecommendedSuggestions}
              type="button"
            >
              Select Recommended
            </button>
            <button
              className="button-secondary"
              disabled={
                savingSelected || filteredBranchSuggestions.length === 0
              }
              onClick={selectVisibleSuggestions}
              type="button"
            >
              Select Visible
            </button>
            <button
              className="button-secondary"
              disabled={!canApplySelected}
              onClick={handleApplySelectedSuggestions}
              type="button"
            >
              {savingSelected
                ? "Applying..."
                : `Apply Selected (${selectedSuggestions.length})`}
            </button>
          </div>
          {recommendedRouteTests.length === 0 ? (
            <p className="micro-copy">
              After applying recommended routes, the sample-answer dry-run
              results will appear here.
            </p>
          ) : null}
          {recommendedRouteTests.length > 0 ? (
            <div className="route-test-result stack-sm">
              <div className="panel-title-row">
                <div className="stack-sm">
                  <span className="label">Recommended Route Dry Runs</span>
                  <h4>
                    {
                      recommendedRouteTests.filter(
                        (result) => result.status === "pass",
                      ).length
                    }{" "}
                    of {recommendedRouteTests.length} passed
                  </h4>
                </div>
              </div>
              <ul className="plain-list compact-list">
                {recommendedRouteTests.map((result) => (
                  <li key={result.suggestionId}>
                    <div className="panel-title-row">
                      <strong>
                        {result.fromNodeTitle} -&gt; {result.toNodeTitle}
                      </strong>
                      <span
                        className={
                          result.status === "pass"
                            ? "status-pill status-pill-good"
                            : "status-pill status-pill-bad"
                        }
                      >
                        {result.status}
                      </span>
                    </div>
                    <span className="micro-copy">
                      Sample answer: {result.sampleAnswer}
                    </span>
                    <span className="muted-copy">{result.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="stack-sm route-test-panel">
        <div className="panel-title-row">
          <h4>Test Saved Routing</h4>
          <span className="status-pill status-pill-muted">Dry Run</span>
        </div>
        <label className="form-field">
          <span>Source question</span>
          <select
            value={routeTestFromNodeId}
            onChange={(event) => setRouteTestFromNodeId(event.target.value)}
          >
            {orderedNodes
              .filter((node) => !node.isTerminal)
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
          </select>
        </label>
        <label className="form-field">
          <span>Sample answer</span>
          <textarea
            placeholder="Enter the kind of respondent answer you want to test."
            rows={4}
            value={routeTestAnswer}
            onChange={(event) => setRouteTestAnswer(event.target.value)}
          />
        </label>
        <div className="composer-footer">
          <span />
          <button
            className="button-secondary"
            disabled={!canTestRoute}
            onClick={handleTestRoute}
            type="button"
          >
            {testingRoute ? "Testing..." : "Test Route"}
          </button>
        </div>
        {routeTestResult ? (
          <div className="route-test-result stack-sm">
            <span
              className={
                routeTestResult.matchedCondition
                  ? "status-pill status-pill-good"
                  : "status-pill status-pill-muted"
              }
            >
              {routeTestResult.matchedCondition
                ? "Condition Matched"
                : "Fallback"}
            </span>
            <strong>
              {routeTestResult.selectedTargetNode
                ? routeTestResult.selectedTargetNode.title
                : "No route configured"}
            </strong>
            <p className="muted-copy">{routeTestResult.selectedReason}</p>
            {routeTestResult.evaluatedRules.length > 0 ? (
              <ul className="plain-list compact-list">
                {routeTestResult.evaluatedRules.map((evaluation) => (
                  <li key={evaluation.rule.id}>
                    <strong>
                      {evaluation.targetNode.title} -{" "}
                      {evaluation.matched ? "matched" : "not matched"}
                    </strong>
                    <span className="micro-copy">{evaluation.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>From question</span>
          <select
            value={fromNodeId}
            onChange={(event) => handleFromNodeChange(event.target.value)}
          >
            {orderedNodes
              .filter((node) => !node.isTerminal)
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
          </select>
        </label>

        <label className="form-field">
          <span>To question</span>
          <select
            value={toNodeId}
            onChange={(event) => setToNodeId(event.target.value)}
          >
            {orderedNodes.map((node) => (
              <option
                disabled={node.id === fromNodeId}
                key={node.id}
                value={node.id}
              >
                {node.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="form-field">
        <span>Match keywords</span>
        <input
          placeholder="progression, relapsed, refractory"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
        />
      </label>

      <label className="form-field">
        <span>Rationale</span>
        <input
          placeholder="Route participants with this answer pattern to the follow-up."
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>

      <div className="composer-footer">
        {status ? <p className="muted-copy">{status}</p> : <span />}
        <button
          className="button-secondary"
          disabled={!canSubmit}
          type="submit"
        >
          {saving ? "Adding..." : "Add Conditional Branch"}
        </button>
      </div>
    </form>
  );
}
