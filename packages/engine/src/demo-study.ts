import type { FactValue } from "@interview/schemas";
import type { StudyDefinition } from "./study-compiler";

export type StudySeed = {
  study: StudyDefinition["study"] & {
    status: "ACTIVE";
    version: number;
  };
  modules: Array<{
    id: string;
    studyId: string;
    key: string;
    title: string;
    description: string;
    status: "ACTIVE";
    position: number;
  }>;
  studyAssets: Array<{
    id: string;
    studyId: string;
    key: string;
    title: string;
    description: string;
    assetType: "PDF" | "SLIDE_DECK" | "IMAGE" | "PI_LABEL" | "VIDEO" | "TEXT";
    storageKey: string;
    mimeType: string;
    metadata: Record<string, string | number | boolean>;
    status: "ACTIVE";
    position: number;
  }>;
  questionNodes: Array<
    StudyDefinition["questionNodes"][number] & {
      studyId: string;
    }
  >;
  branchRules: Array<
    StudyDefinition["branchRules"][number] & {
      studyId: string;
    }
  >;
  studyActions: Array<{
    id: string;
    studyId: string;
    moduleId: string | null;
    nodeId: string | null;
    assetId: string | null;
    key: string;
    actionType: "ASK_QUESTION" | "SHOW_ASSET" | "ASK_ASSET_REACTION" | "CLOSE";
    goal: string | null;
    mustComplete: boolean;
    priority: number;
    config: Record<string, string | number | boolean>;
  }>;
  actionRules: Array<{
    id: string;
    studyId: string;
    fromActionId: string | null;
    toActionId: string;
    ruleType: "ALWAYS" | "AFTER_ACTION";
    priority: number;
    conditionJson: Record<string, string | number | boolean> | null;
    rationale: string;
  }>;
  assetStageRules: Array<{
    id: string;
    studyId: string;
    assetId: string;
    moduleId: string | null;
    triggerActionId: string | null;
    triggerType: "AFTER_ACTION";
    displayMode: "INLINE_PANE";
    required: boolean;
    priority: number;
    conditionJson: Record<string, string | number | boolean> | null;
    rationale: string;
  }>;
  respondent: {
    id: string;
    studyId: string;
    externalRef: string;
    status: "ACTIVE";
    profile: Record<string, string>;
    attributes: Record<string, string>;
  };
  session: {
    id: string;
    studyId: string;
    respondentId: string;
    channel: "BROWSER_CHAT";
    status: "ACTIVE";
    startedAt: string;
    metadata: Record<string, unknown>;
  };
  turns: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    nodeId: string;
    sequence: number;
    role: "INTERVIEWER" | "PARTICIPANT";
    content: string;
    payload: Record<string, string | number | boolean>;
  }>;
  analyses: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    turnId: string;
    kind: "ANSWER_EXTRACTION";
    status: "COMPLETED";
    input: Record<string, string>;
    output: Record<string, FactValue>;
  }>;
  decisions: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    turnId: string;
    fromNodeId: string;
    selectedNodeId: string;
    kind: "SELECT_NEXT_QUESTION";
    status: "COMPLETED";
    rationale: string;
    input: Record<string, string>;
    output: Record<string, string>;
  }>;
  artifacts: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    turnId: string;
    type: "TRANSCRIPT_SNAPSHOT";
    storageKey: string;
    mimeType: string;
    payload: Record<string, string | number | boolean>;
  }>;
  sessionAssets: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    assetId: string;
    sourceActionId: string;
    turnId: string;
    displayMode: "INLINE_PANE";
    shownAt: string;
    dismissedAt: string | null;
    exposureMetadata: Record<string, string | number | boolean>;
  }>;
  candidateActions: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    turnId: string;
    studyActionId: string;
    nodeId: string | null;
    assetId: string | null;
    actionType: "ASK_QUESTION" | "SHOW_ASSET" | "ASK_ASSET_REACTION" | "CLOSE";
    priority: number;
    allowed: boolean;
    reasonCode: "BRANCH_PRIORITY" | "ASSET_STAGE" | "ENTRY";
    input: Record<string, string | number | boolean>;
  }>;
  assetReactions: Array<{
    id: string;
    studyId: string;
    sessionId: string;
    turnId: string;
    assetId: string;
    kind: "OPEN_FEEDBACK";
    status: "COMPLETED";
    input: Record<string, string>;
    output: Record<string, FactValue>;
  }>;
  evalCases: Array<{
    id: string;
    studyId: string;
    key: string;
    name: string;
    description: string;
    status: "ACTIVE";
    input: Record<string, unknown>;
    expected: Record<string, string>;
  }>;
  evalRuns: Array<{
    id: string;
    studyId: string;
    evalCaseId: string;
    status: "PASSED";
    score: number;
    startedAt: string;
    finishedAt: string;
    summary: Record<string, string | number | boolean>;
  }>;
  replayParticipantTurns: Array<{
    nodeKey: string;
    content: string;
    extractedFacts: Record<string, FactValue>;
  }>;
};

export const demoStudyDefinition: StudyDefinition = {
  study: {
    id: "study_b2b_pricing_interview",
    slug: "b2b-pricing-interview",
    name: "B2B Pricing Interview",
    description:
      "Demo study for adaptive browser-based interviews about B2B pricing workflows.",
  },
  modules: [
    {
      id: "module_intro",
      key: "introduction",
      title: "Introduction",
      position: 1,
    },
    {
      id: "module_pricing",
      key: "pricing",
      title: "Pricing Workflow",
      position: 2,
    },
  ],
  questionNodes: [
    {
      id: "node_company_context",
      key: "company_context",
      moduleId: "module_intro",
      title: "Company Context",
      prompt:
        "To start, tell me a bit about your company and who is involved in pricing decisions today.",
      nodeType: "OPEN_TEXT",
      isEntry: true,
      position: 1,
      config: {
        factKeys: ["company_type", "pricing_stakeholders"],
        mustAsk: true,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_current_pricing",
      key: "current_pricing_process",
      moduleId: "module_pricing",
      title: "Current Pricing Process",
      prompt:
        "How do you currently set or update pricing for this product or service?",
      nodeType: "OPEN_TEXT",
      position: 2,
      config: {
        factKeys: ["pricing_process"],
        mustAsk: true,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_value_metric",
      key: "value_metric",
      moduleId: "module_pricing",
      title: "Value Metric",
      prompt:
        "What signals tell you a pricing model is working well for your business?",
      nodeType: "OPEN_TEXT",
      position: 3,
      config: {
        factKeys: ["value_metric"],
        responseFormat: "long_text",
      },
    },
    {
      id: "node_budget_sensitivity",
      key: "budget_sensitivity",
      moduleId: "module_pricing",
      title: "Budget Sensitivity",
      prompt:
        "When price changes come up, what kinds of budget limits or approval thresholds matter most?",
      nodeType: "OPEN_TEXT",
      position: 4,
      config: {
        factKeys: ["budget_constraints"],
        mustAsk: true,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_wrap_up",
      key: "wrap_up",
      moduleId: "module_pricing",
      title: "Wrap Up",
      prompt:
        "Is there anything else about pricing decisions at your company that we should have asked about today?",
      nodeType: "CLOSE",
      isTerminal: true,
      position: 5,
      config: {
        responseFormat: "long_text",
      },
    },
  ],
  branchRules: [
    {
      id: "rule_demo_001",
      fromNodeId: "node_company_context",
      toNodeId: "node_current_pricing",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Move from qualification into the current pricing process.",
    },
    {
      id: "rule_demo_002",
      fromNodeId: "node_current_pricing",
      toNodeId: "node_value_metric",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "After process understanding, explore success metrics.",
    },
    {
      id: "rule_demo_003",
      fromNodeId: "node_value_metric",
      toNodeId: "node_budget_sensitivity",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Move from value perception into budget sensitivity.",
    },
    {
      id: "rule_demo_004",
      fromNodeId: "node_budget_sensitivity",
      toNodeId: "node_wrap_up",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Close the interview after budget sensitivity.",
    },
  ],
};

export const demoStudySeed: StudySeed = {
  study: {
    ...demoStudyDefinition.study,
    status: "ACTIVE",
    version: 1,
  },
  modules: [
    {
      id: "module_intro",
      studyId: demoStudyDefinition.study.id,
      key: "introduction",
      title: "Introduction",
      description: "Opening context and qualification questions.",
      status: "ACTIVE",
      position: 1,
    },
    {
      id: "module_pricing",
      studyId: demoStudyDefinition.study.id,
      key: "pricing",
      title: "Pricing Workflow",
      description: "Current process, value metrics, and willingness to pay.",
      status: "ACTIVE",
      position: 2,
    },
  ],
  studyAssets: [
    {
      id: "asset_pricing_storyboard",
      studyId: demoStudyDefinition.study.id,
      key: "pricing-storyboard",
      title: "Pricing Storyboard",
      description:
        "A short concept deck showing the proposed pricing narrative.",
      assetType: "SLIDE_DECK",
      storageKey: "seed://assets/pricing-storyboard.pdf",
      mimeType: "application/pdf",
      metadata: {
        pageCount: 6,
        focalFrame: "slide-03",
      },
      status: "ACTIVE",
      position: 1,
    },
  ],
  questionNodes: demoStudyDefinition.questionNodes.map((node) => ({
    ...node,
    studyId: demoStudyDefinition.study.id,
  })),
  branchRules: demoStudyDefinition.branchRules.map((rule) => ({
    ...rule,
    studyId: demoStudyDefinition.study.id,
  })),
  studyActions: [
    {
      id: "action_company_context",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_intro",
      nodeId: "node_company_context",
      assetId: null,
      key: "ask-company-context",
      actionType: "ASK_QUESTION",
      goal: "Establish company context and pricing stakeholders",
      mustComplete: true,
      priority: 1,
      config: {
        responseFormat: "long_text",
      },
    },
    {
      id: "action_current_pricing",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_pricing",
      nodeId: "node_current_pricing",
      assetId: null,
      key: "ask-current-pricing",
      actionType: "ASK_QUESTION",
      goal: "Understand the current pricing process",
      mustComplete: true,
      priority: 2,
      config: {
        responseFormat: "long_text",
      },
    },
    {
      id: "action_show_pricing_storyboard",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_pricing",
      nodeId: null,
      assetId: "asset_pricing_storyboard",
      key: "show-pricing-storyboard",
      actionType: "SHOW_ASSET",
      goal: "Stage the pricing concept asset before reaction capture",
      mustComplete: true,
      priority: 3,
      config: {
        displayMode: "INLINE_PANE",
      },
    },
    {
      id: "action_value_metric",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_pricing",
      nodeId: "node_value_metric",
      assetId: null,
      key: "ask-value-metric",
      actionType: "ASK_ASSET_REACTION",
      goal: "Capture reaction to the staged pricing concept and value metric",
      mustComplete: false,
      priority: 4,
      config: {
        referencesAsset: true,
      },
    },
    {
      id: "action_budget_sensitivity",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_pricing",
      nodeId: "node_budget_sensitivity",
      assetId: null,
      key: "ask-budget-sensitivity",
      actionType: "ASK_QUESTION",
      goal: "Understand approval thresholds and budget sensitivity",
      mustComplete: true,
      priority: 5,
      config: {
        responseFormat: "long_text",
      },
    },
    {
      id: "action_wrap_up",
      studyId: demoStudyDefinition.study.id,
      moduleId: "module_pricing",
      nodeId: "node_wrap_up",
      assetId: null,
      key: "close-interview",
      actionType: "CLOSE",
      goal: "Wrap the interview cleanly",
      mustComplete: false,
      priority: 6,
      config: {},
    },
  ],
  actionRules: [
    {
      id: "action_rule_001",
      studyId: demoStudyDefinition.study.id,
      fromActionId: null,
      toActionId: "action_company_context",
      ruleType: "ALWAYS",
      priority: 1,
      conditionJson: null,
      rationale: "Enter the interview through company context.",
    },
    {
      id: "action_rule_002",
      studyId: demoStudyDefinition.study.id,
      fromActionId: "action_company_context",
      toActionId: "action_current_pricing",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Move into current pricing once company context is captured.",
    },
    {
      id: "action_rule_003",
      studyId: demoStudyDefinition.study.id,
      fromActionId: "action_current_pricing",
      toActionId: "action_show_pricing_storyboard",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Show the concept asset before asking for reaction.",
    },
    {
      id: "action_rule_004",
      studyId: demoStudyDefinition.study.id,
      fromActionId: "action_show_pricing_storyboard",
      toActionId: "action_value_metric",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Collect reaction immediately after the asset is shown.",
    },
    {
      id: "action_rule_005",
      studyId: demoStudyDefinition.study.id,
      fromActionId: "action_value_metric",
      toActionId: "action_budget_sensitivity",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Return to budget sensitivity after the asset reaction.",
    },
    {
      id: "action_rule_006",
      studyId: demoStudyDefinition.study.id,
      fromActionId: "action_budget_sensitivity",
      toActionId: "action_wrap_up",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Close the interview after budget sensitivity.",
    },
  ],
  assetStageRules: [
    {
      id: "asset_stage_rule_001",
      studyId: demoStudyDefinition.study.id,
      assetId: "asset_pricing_storyboard",
      moduleId: "module_pricing",
      triggerActionId: "action_current_pricing",
      triggerType: "AFTER_ACTION",
      displayMode: "INLINE_PANE",
      required: true,
      priority: 1,
      conditionJson: null,
      rationale:
        "Reveal the pricing storyboard before the concept reaction prompt.",
    },
  ],
  respondent: {
    id: "respondent_demo_001",
    studyId: demoStudyDefinition.study.id,
    externalRef: "demo-respondent-001",
    status: "ACTIVE",
    profile: {
      role: "VP of Revenue Operations",
      companySize: "201-500 employees",
      industry: "B2B SaaS",
    },
    attributes: {
      region: "North America",
      segment: "Mid-market",
    },
  },
  session: {
    id: "session_demo_001",
    studyId: demoStudyDefinition.study.id,
    respondentId: "respondent_demo_001",
    channel: "BROWSER_CHAT",
    status: "ACTIVE",
    startedAt: "2026-04-10T15:00:00.000Z",
    metadata: {
      source: "seed",
      entryNodeKey: "company_context",
      sessionState: {
        sessionId: "session_demo_001",
        studyId: demoStudyDefinition.study.id,
        status: "active",
        currentActionId: "action_current_pricing",
        currentActionKey: "ask-current-pricing",
        currentNodeId: "node_current_pricing",
        currentNodeKey: "current_pricing_process",
        currentAssetId: null,
        askedNodeIds: ["node_company_context"],
        completedNodeIds: ["node_company_context"],
        completedActionIds: ["action_company_context"],
        pendingMustAskNodeIds: [
          "node_current_pricing",
          "node_budget_sensitivity",
        ],
        shownAssetIds: [],
        coverageByGoal: {
          "Establish company context and pricing stakeholders": 1,
        },
        facts: {
          company_type: "B2B SaaS",
          pricing_stakeholders: ["finance", "product marketing", "cro"],
        },
        contradictionFlags: [],
        offTopicRedirectCount: 0,
        history: [
          {
            turnId: "turn_demo_002",
            nodeId: "node_company_context",
            nodeKey: "company_context",
            role: "participant",
            content:
              "We are a B2B SaaS company. Pricing decisions are shared between finance, product marketing, and our CRO.",
          },
        ],
      },
    },
  },
  turns: [
    {
      id: "turn_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      nodeId: "node_company_context",
      sequence: 1,
      role: "INTERVIEWER",
      content:
        "To start, tell me a bit about your company and who is involved in pricing decisions today.",
      payload: {
        nodeKey: "company_context",
      },
    },
    {
      id: "turn_demo_002",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      nodeId: "node_company_context",
      sequence: 2,
      role: "PARTICIPANT",
      content:
        "We are a B2B SaaS company. Pricing decisions are shared between finance, product marketing, and our CRO.",
      payload: {
        sentiment: "neutral",
      },
    },
  ],
  analyses: [
    {
      id: "analysis_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      kind: "ANSWER_EXTRACTION",
      status: "COMPLETED",
      input: {
        turnId: "turn_demo_002",
      },
      output: {
        stakeholders: ["finance", "product marketing", "cro"],
        companyType: "B2B SaaS",
      },
    },
  ],
  decisions: [
    {
      id: "decision_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      fromNodeId: "node_company_context",
      selectedNodeId: "node_current_pricing",
      kind: "SELECT_NEXT_QUESTION",
      status: "COMPLETED",
      rationale:
        "The respondent established pricing stakeholders, so the next question should explore the current pricing workflow.",
      input: {
        completedNodeKey: "company_context",
      },
      output: {
        selectedNodeKey: "current_pricing_process",
      },
    },
  ],
  artifacts: [
    {
      id: "artifact_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      type: "TRANSCRIPT_SNAPSHOT",
      storageKey: "seed://transcripts/demo-session-001",
      mimeType: "application/json",
      payload: {
        turns: 2,
        lastNodeKey: "company_context",
      },
    },
  ],
  sessionAssets: [
    {
      id: "session_asset_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      assetId: "asset_pricing_storyboard",
      sourceActionId: "action_show_pricing_storyboard",
      turnId: "turn_demo_002",
      displayMode: "INLINE_PANE",
      shownAt: "2026-04-10T15:00:30.000Z",
      dismissedAt: null,
      exposureMetadata: {
        source: "seed",
        visibleSlides: 6,
      },
    },
  ],
  candidateActions: [
    {
      id: "candidate_action_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      studyActionId: "action_current_pricing",
      nodeId: "node_current_pricing",
      assetId: null,
      actionType: "ASK_QUESTION",
      priority: 1,
      allowed: true,
      reasonCode: "BRANCH_PRIORITY",
      input: {
        fromNodeKey: "company_context",
      },
    },
    {
      id: "candidate_action_demo_002",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      studyActionId: "action_show_pricing_storyboard",
      nodeId: null,
      assetId: "asset_pricing_storyboard",
      actionType: "SHOW_ASSET",
      priority: 2,
      allowed: true,
      reasonCode: "ASSET_STAGE",
      input: {
        triggerActionKey: "ask-current-pricing",
      },
    },
  ],
  assetReactions: [
    {
      id: "asset_reaction_demo_001",
      studyId: demoStudyDefinition.study.id,
      sessionId: "session_demo_001",
      turnId: "turn_demo_002",
      assetId: "asset_pricing_storyboard",
      kind: "OPEN_FEEDBACK",
      status: "COMPLETED",
      input: {
        assetKey: "pricing-storyboard",
      },
      output: {
        appeal:
          "The storyline feels credible for a mid-market pricing conversation.",
        concern:
          "Enterprise buyers may want more proof before agreeing to the packaging shift.",
      },
    },
  ],
  evalCases: [
    {
      id: "eval_case_demo_001",
      studyId: demoStudyDefinition.study.id,
      key: "pricing_stakeholder_followup",
      name: "Pricing Stakeholder Follow-Up",
      description:
        "Ensures the selector moves from company context into pricing workflow once stakeholders are identified.",
      status: "ACTIVE",
      input: {
        sessionState: {
          lastNodeKey: "company_context",
          extractedStakeholders: ["finance", "product marketing", "cro"],
        },
      },
      expected: {
        selectedNodeKey: "current_pricing_process",
      },
    },
  ],
  evalRuns: [
    {
      id: "eval_run_demo_001",
      studyId: demoStudyDefinition.study.id,
      evalCaseId: "eval_case_demo_001",
      status: "PASSED",
      score: 1,
      startedAt: "2026-04-10T15:05:00.000Z",
      finishedAt: "2026-04-10T15:05:02.000Z",
      summary: {
        selectedNodeKey: "current_pricing_process",
        matchedExpectation: true,
      },
    },
  ],
  replayParticipantTurns: [
    {
      nodeKey: "company_context",
      content:
        "We are a B2B SaaS company, and finance plus product marketing usually make pricing calls together.",
      extractedFacts: {
        company_type: "B2B SaaS",
        pricing_stakeholders: ["finance", "product marketing"],
      },
    },
    {
      nodeKey: "current_pricing_process",
      content:
        "We review pricing each quarter and usually benchmark against win rates and competitor packaging.",
      extractedFacts: {
        pricing_process: "quarterly pricing reviews",
      },
    },
    {
      nodeKey: "value_metric",
      content:
        "We look at expansion revenue and gross retention to judge whether pricing is working.",
      extractedFacts: {
        value_metric: "expansion revenue and gross retention",
      },
    },
    {
      nodeKey: "budget_sensitivity",
      content:
        "Anything above a ten percent increase usually needs CFO approval and a customer communication plan.",
      extractedFacts: {
        budget_constraints: "10 percent increase requires CFO approval",
      },
    },
    {
      nodeKey: "wrap_up",
      content:
        "The main thing is that legal review can slow pricing updates for enterprise contracts.",
      extractedFacts: {},
    },
  ],
};
