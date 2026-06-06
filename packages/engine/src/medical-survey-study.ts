import type { FactValue } from "@interview/schemas";
import type { StudyDefinition } from "./study-compiler";
import type { StudySeed } from "./demo-study";

export const medicalSurveyDefinition: StudyDefinition = {
  study: {
    id: "study_adaptive_medical_survey",
    slug: "adaptive-medical-survey",
    name: "Adaptive Medical Experience Survey",
    description:
      "MVP study for a time-boxed, adaptive medical research survey with safety guardrails and asset review.",
    config: {
      targetDurationSeconds: 480,
      closingReserveSeconds: 75,
      maxAttemptsPerQuestion: 2,
      maxOffTopicRedirects: 2,
      realtimeVoiceEnabled: true,
      medicalSafetyMessage:
        "I cannot provide medical advice, diagnosis, or treatment guidance in this survey. If you may be having an emergency or severe symptoms, contact emergency services or a clinician right away.",
    },
  },
  modules: [
    {
      id: "module_medical_intro",
      key: "intro",
      title: "Context",
      position: 1,
    },
    {
      id: "module_medical_experience",
      key: "experience",
      title: "Experience",
      position: 2,
    },
    {
      id: "module_medical_asset",
      key: "asset_review",
      title: "Asset Review",
      position: 3,
    },
    {
      id: "module_medical_close",
      key: "close",
      title: "Close",
      position: 4,
    },
  ],
  questionNodes: [
    {
      id: "node_medical_context",
      key: "medical_context",
      moduleId: "module_medical_intro",
      title: "Medical Context",
      prompt:
        "To start, what perspective are you answering from today, and what healthcare experience should we keep in mind for this survey?",
      nodeType: "OPEN_TEXT",
      isEntry: true,
      position: 1,
      config: {
        factKeys: ["participant_perspective", "condition_context"],
        mustAsk: true,
        estimatedSeconds: 70,
        maxAttempts: 2,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_care_journey",
      key: "care_journey",
      moduleId: "module_medical_experience",
      title: "Care Journey",
      prompt:
        "Thinking about that experience, what has mattered most in the care journey so far?",
      nodeType: "OPEN_TEXT",
      position: 2,
      config: {
        factKeys: ["care_journey_priorities"],
        mustAsk: true,
        estimatedSeconds: 80,
        maxAttempts: 2,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_information_needs",
      key: "information_needs",
      moduleId: "module_medical_experience",
      title: "Information Needs",
      prompt:
        "When you review medical information, what questions or concerns do you most need answered clearly?",
      nodeType: "OPEN_TEXT",
      position: 3,
      config: {
        factKeys: ["information_needs"],
        mustAsk: true,
        estimatedSeconds: 75,
        maxAttempts: 2,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_asset_reaction",
      key: "asset_reaction",
      moduleId: "module_medical_asset",
      title: "Asset Reaction",
      prompt:
        "After reviewing the material in the side pane, what feels clear, unclear, or concerning?",
      nodeType: "OPEN_TEXT",
      position: 4,
      config: {
        factKeys: ["asset_reaction", "clarity_gaps"],
        estimatedSeconds: 90,
        maxAttempts: 2,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_access_barriers",
      key: "access_barriers",
      moduleId: "module_medical_experience",
      title: "Access Barriers",
      prompt:
        "What would make it easier or harder for someone to act on this kind of medical information?",
      nodeType: "OPEN_TEXT",
      position: 5,
      config: {
        factKeys: ["access_barriers"],
        mustAsk: true,
        estimatedSeconds: 75,
        maxAttempts: 2,
        responseFormat: "long_text",
      },
    },
    {
      id: "node_medical_wrap_up",
      key: "medical_wrap_up",
      moduleId: "module_medical_close",
      title: "Wrap Up",
      prompt:
        "Before we finish, is there anything important about this medical experience that the survey has not covered?",
      nodeType: "CLOSE",
      isTerminal: true,
      position: 6,
      config: {
        factKeys: ["closing_feedback"],
        estimatedSeconds: 45,
        maxAttempts: 1,
        responseFormat: "long_text",
      },
    },
  ],
  branchRules: [
    {
      id: "rule_medical_001",
      fromNodeId: "node_medical_context",
      toNodeId: "node_care_journey",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Move from respondent context into lived care priorities.",
    },
    {
      id: "rule_medical_002",
      fromNodeId: "node_care_journey",
      toNodeId: "node_information_needs",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Capture information needs before showing the asset.",
    },
    {
      id: "rule_medical_003",
      fromNodeId: "node_information_needs",
      toNodeId: "node_asset_reaction",
      conditionType: "ALWAYS",
      priority: 1,
      rationale:
        "Ask for reaction after the medical information asset is staged.",
    },
    {
      id: "rule_medical_004",
      fromNodeId: "node_asset_reaction",
      toNodeId: "node_access_barriers",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Move from comprehension into practical access barriers.",
    },
    {
      id: "rule_medical_005",
      fromNodeId: "node_access_barriers",
      toNodeId: "node_medical_wrap_up",
      conditionType: "ALWAYS",
      priority: 1,
      rationale: "Close with an opportunity to add missing context.",
    },
  ],
};

export const medicalSurveySeed: StudySeed = {
  study: {
    ...medicalSurveyDefinition.study,
    status: "ACTIVE",
    version: 1,
  },
  modules: medicalSurveyDefinition.modules.map((module) => ({
    ...module,
    studyId: medicalSurveyDefinition.study.id,
    description: `${module.title} module for the adaptive medical survey.`,
    status: "ACTIVE",
  })),
  studyAssets: [
    {
      id: "asset_medical_concept_guide",
      studyId: medicalSurveyDefinition.study.id,
      key: "medical-concept-guide",
      title: "Medical Concept Guide",
      description:
        "Example medical information asset for side-by-side survey review.",
      assetType: "PDF",
      storageKey: "seed://assets/medical-concept-guide.pdf",
      mimeType: "application/pdf",
      metadata: {
        pageCount: 3,
        source: "seeded-mvp",
        customGptReady: true,
      },
      status: "ACTIVE",
      position: 1,
    },
  ],
  questionNodes: medicalSurveyDefinition.questionNodes.map((node) => ({
    ...node,
    studyId: medicalSurveyDefinition.study.id,
  })),
  branchRules: medicalSurveyDefinition.branchRules.map((rule) => ({
    ...rule,
    studyId: medicalSurveyDefinition.study.id,
  })),
  studyActions: [
    {
      id: "action_medical_context",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_intro",
      nodeId: "node_medical_context",
      assetId: null,
      key: "ask-medical-context",
      actionType: "ASK_QUESTION",
      goal: "Establish respondent perspective and healthcare context",
      mustComplete: true,
      priority: 1,
      config: {},
    },
    {
      id: "action_care_journey",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_experience",
      nodeId: "node_care_journey",
      assetId: null,
      key: "ask-care-journey",
      actionType: "ASK_QUESTION",
      goal: "Understand the care journey priorities",
      mustComplete: true,
      priority: 2,
      config: {},
    },
    {
      id: "action_information_needs",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_experience",
      nodeId: "node_information_needs",
      assetId: null,
      key: "ask-information-needs",
      actionType: "ASK_QUESTION",
      goal: "Capture questions and concerns that medical information must answer",
      mustComplete: true,
      priority: 3,
      config: {},
    },
    {
      id: "action_show_medical_concept_guide",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_asset",
      nodeId: null,
      assetId: "asset_medical_concept_guide",
      key: "show-medical-concept-guide",
      actionType: "SHOW_ASSET",
      goal: "Stage the medical information asset before reaction capture",
      mustComplete: true,
      priority: 4,
      config: {
        displayMode: "INLINE_PANE",
        customGptProjectId: "env:CUSTOMGPT_PROJECT_ID",
      },
    },
    {
      id: "action_asset_reaction",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_asset",
      nodeId: "node_asset_reaction",
      assetId: null,
      key: "ask-asset-reaction",
      actionType: "ASK_ASSET_REACTION",
      goal: "Capture clarity, concerns, and gaps after asset review",
      mustComplete: false,
      priority: 5,
      config: {
        referencesAsset: true,
      },
    },
    {
      id: "action_access_barriers",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_experience",
      nodeId: "node_access_barriers",
      assetId: null,
      key: "ask-access-barriers",
      actionType: "ASK_QUESTION",
      goal: "Understand practical barriers to acting on medical information",
      mustComplete: true,
      priority: 6,
      config: {},
    },
    {
      id: "action_medical_wrap_up",
      studyId: medicalSurveyDefinition.study.id,
      moduleId: "module_medical_close",
      nodeId: "node_medical_wrap_up",
      assetId: null,
      key: "close-medical-survey",
      actionType: "CLOSE",
      goal: "Close the survey within the target duration",
      mustComplete: false,
      priority: 7,
      config: {},
    },
  ],
  actionRules: [
    {
      id: "action_rule_medical_001",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: null,
      toActionId: "action_medical_context",
      ruleType: "ALWAYS",
      priority: 1,
      conditionJson: null,
      rationale: "Enter through respondent medical context.",
    },
    {
      id: "action_rule_medical_002",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_medical_context",
      toActionId: "action_care_journey",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Move from context to experience.",
    },
    {
      id: "action_rule_medical_003",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_care_journey",
      toActionId: "action_information_needs",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Capture information needs before asset exposure.",
    },
    {
      id: "action_rule_medical_004",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_information_needs",
      toActionId: "action_show_medical_concept_guide",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Stage the medical concept guide before asking for reaction.",
    },
    {
      id: "action_rule_medical_005",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_show_medical_concept_guide",
      toActionId: "action_asset_reaction",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Ask for reaction after the asset is visible.",
    },
    {
      id: "action_rule_medical_006",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_asset_reaction",
      toActionId: "action_access_barriers",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Return to research questions after asset reaction.",
    },
    {
      id: "action_rule_medical_007",
      studyId: medicalSurveyDefinition.study.id,
      fromActionId: "action_access_barriers",
      toActionId: "action_medical_wrap_up",
      ruleType: "AFTER_ACTION",
      priority: 1,
      conditionJson: null,
      rationale: "Finish with a wrap-up question.",
    },
  ],
  assetStageRules: [
    {
      id: "asset_stage_rule_medical_001",
      studyId: medicalSurveyDefinition.study.id,
      assetId: "asset_medical_concept_guide",
      moduleId: "module_medical_asset",
      triggerActionId: "action_information_needs",
      triggerType: "AFTER_ACTION",
      displayMode: "INLINE_PANE",
      required: true,
      priority: 1,
      conditionJson: null,
      rationale:
        "Reveal the medical information asset before collecting clarity and concern reactions.",
    },
  ],
  respondent: {
    id: "respondent_medical_demo_001",
    studyId: medicalSurveyDefinition.study.id,
    externalRef: "medical-demo-respondent-001",
    status: "ACTIVE",
    profile: {
      mode: "seed",
    },
    attributes: {
      studyType: "medical-experience",
    },
  },
  session: {
    id: "session_medical_demo_001",
    studyId: medicalSurveyDefinition.study.id,
    respondentId: "respondent_medical_demo_001",
    channel: "BROWSER_CHAT",
    status: "ACTIVE",
    startedAt: "2026-04-10T15:00:00.000Z",
    metadata: {
      source: "seed",
      entryNodeKey: "medical_context",
    },
  },
  turns: [],
  analyses: [],
  decisions: [],
  artifacts: [],
  sessionAssets: [],
  candidateActions: [],
  assetReactions: [],
  evalCases: [
    {
      id: "eval_case_medical_off_survey_return",
      studyId: medicalSurveyDefinition.study.id,
      key: "medical_off_survey_return",
      name: "Off-Survey Return",
      description:
        "Ensures an off-survey question redirects without advancing or repeating indefinitely.",
      status: "ACTIVE",
      input: {
        turnIntent: "clarification_question",
        currentNodeKey: "medical_context",
      },
      expected: {
        action: "redirect",
        selectedNodeKey: "medical_context",
      },
    },
  ],
  evalRuns: [],
  replayParticipantTurns: [
    {
      nodeKey: "medical_context",
      content:
        "I am answering as a caregiver, thinking about a family member managing a chronic condition.",
      extractedFacts: {
        participant_perspective: "caregiver",
        condition_context: "family member managing a chronic condition",
      },
    },
    {
      nodeKey: "care_journey",
      content:
        "The most important thing has been understanding what to expect between appointments.",
      extractedFacts: {
        care_journey_priorities:
          "understanding what to expect between appointments",
      },
    },
    {
      nodeKey: "information_needs",
      content:
        "I need plain-language explanations of risks, side effects, and when to call the doctor.",
      extractedFacts: {
        information_needs:
          "plain-language risks, side effects, and when to call the doctor",
      },
    },
    {
      nodeKey: "asset_reaction",
      content:
        "The guide is easy to scan, but the safety language needs clearer next steps.",
      extractedFacts: {
        asset_reaction: "easy to scan",
        clarity_gaps: "safety language needs clearer next steps",
      },
    },
    {
      nodeKey: "access_barriers",
      content:
        "Insurance steps and not knowing who to call would make it harder to act.",
      extractedFacts: {
        access_barriers: "insurance steps and unclear contact paths",
      },
    },
    {
      nodeKey: "medical_wrap_up",
      content: "No, that covers the main points.",
      extractedFacts: {
        closing_feedback: "no additional feedback",
      },
    },
  ] satisfies Array<{
    nodeKey: string;
    content: string;
    extractedFacts: Record<string, FactValue>;
  }>,
};
