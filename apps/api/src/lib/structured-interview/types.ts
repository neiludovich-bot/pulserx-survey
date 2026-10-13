/**
 * Structured interview: a fixed, ordered guide with tappable answer options.
 * The guide is data; the engine (engine.ts) is a pure state machine over it,
 * and the service (service.ts) adds the AI steps: interpreting typed or spoken
 * answers, and answering participant questions from the brand's indexed site.
 */

export type StructuredOption = {
  id: string;
  label: string;
  /** Follow-up asked when this option is tapped with nothing else said. */
  followUp?: string;
  /** Selecting it clears other selections (e.g. "None of these"). */
  exclusive?: boolean;
  /** Kept in place when the option list is shuffled (e.g. "Other", "None"). */
  anchored?: boolean;
  /** Ends the interview when chosen (e.g. declining consent). */
  ends?: boolean;
  /** Links an option to another question, so its position can follow that question's rotated order. */
  ref?: string;
};

export type EvidenceFigure = { url: string; alt: string; caption?: string };

export type EvidenceCard = {
  id: string;
  title: string;
  /** Short line naming the population and comparison. */
  subtitle: string;
  /** Pre-approved stimulus text. Never rewritten by a model. */
  body: string;
  figures: EvidenceFigure[];
  /** Short notes shown under the figure: design, supporting results, limitations. */
  context: string[];
  sourceUrl: string;
  sourceLabel: string;
};

export type StructuredQuestion = {
  id: string;
  section: string;
  prompt: string;
  /** rank: every option is chosen, in the participant's order of importance. */
  kind: "single" | "multi" | "rank";
  options: StructuredOption[];
  /** For multi: the most options a participant may pick. */
  maxSelect?: number;
  /** Asked only when an earlier answer included one of these options; otherwise skipped. */
  showIf?: { questionId: string; anyOf: string[] };
  /** Shuffle the non-anchored options per participant to remove order bias. */
  shuffleOptions?: boolean;
  /** Order options to match the rotated order of the questions they reference. */
  optionsFollowRotation?: boolean;
  card?: EvidenceCard;
  /** What the interviewer says before asking: plain spoken sentences, pre-approved, never generated. */
  intro?: string;
  /** Names the study and population, so each trial in a rotation block opens with a clear signpost. */
  transition?: string;
  /** Question-level follow-up, used when the chosen option has none. */
  followUp?: string;
  /** Ask the follow-up only when exactly this many options were chosen bare (multi). */
  followUpOnlyIfSingleChoice?: boolean;
  /** A tap on one of these options leads to an open question that is answered from the website. */
  detourOnOptions?: string[];
  detourPrompt?: string;
  /** Short label used in exports. */
  exportLabel: string;
};

export type StructuredSurvey = {
  slug: "nubeqa" | "brukinsa" | "padcev" | "enhertu";
  version: string;
  brand: string;
  title: string;
  targetMinutes: number;
  welcome: string;
  closing: string;
  declined: string;
  /** Shown when the participant ends early. */
  stopped: string;
  questions: StructuredQuestion[];
  /** Said when the interview moves into a new section. */
  sectionLeads: Record<string, string>;
  /** Question ids shown in a random order per participant (a rotation block). */
  rotationBlocks: string[][];
  /** Detours answered per question before further ones are parked for the end. */
  maxDetoursPerQuestion: number;
  /** Short, neutral acknowledgments said before the next question; rotated for variety. */
  acknowledgments: string[];
};

export type AnswerSource = "tap" | "text" | "voice";

export type RecordedAnswer = {
  questionId: string;
  optionIds: string[];
  /** The participant's own words, when they typed or spoke. */
  verbatim: string | null;
  source: AnswerSource;
  /** Interpreted from free text by the model rather than tapped. */
  inferred: boolean;
  followUp: { prompt: string; response: string | null; source: AnswerSource | null; skipped: boolean } | null;
  presentedAt: string;
  answeredAt: string;
  /** Order the options were shown in, for order-bias analysis. */
  displayedOptionIds: string[];
};

export type DetourRecord = {
  questionId: string | null;
  question: string;
  answer: string | null;
  sourceIds: string[];
  answered: boolean;
  parked: boolean;
  at: string;
};

export type InterviewPhase = "question" | "follow_up" | "detour_open" | "after_detour" | "complete" | "declined";

export type InterviewState = {
  version: 1;
  sessionId: string;
  surveySlug: StructuredSurvey["slug"];
  surveyVersion: string;
  order: string[];
  optionOrder: Record<string, string[]>;
  index: number;
  phase: InterviewPhase;
  pendingFollowUp: { questionId: string; prompt: string } | null;
  presentedAt: string | null;
  answers: Record<string, RecordedAnswer>;
  detours: DetourRecord[];
  startedAt: string;
  completedAt: string | null;
  endReason: "completed" | "declined" | "stopped" | null;
  /** A text answer that could not be mapped confidently; the options are re-shown. */
  clarifying: boolean;
  /** The words from that unmapped answer, kept so the confirming tap carries them. */
  pendingVerbatim: string | null;
};

/** What the model concluded about a typed or spoken reply. */
export type ReplyInterpretation = {
  intent: "answer" | "question" | "answer_and_question" | "unclear" | "stop";
  optionIds: string[];
  question: string | null;
  /** The reply already explains a reason, so no follow-up is needed. */
  givesReason: boolean;
};
