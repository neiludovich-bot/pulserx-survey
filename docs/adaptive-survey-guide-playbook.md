# Adaptive Survey Guide Playbook

This playbook defines the guide style for a source-grounded adaptive medical
market research interview. It is meant to be reusable across product sites,
not specific to BRUKINSA.

The key idea: do not treat the uploaded question list as a flat script. Treat
it as an interview protocol with a question spine, source-context triggers,
adaptive probes, and analyzable outputs.

## Prime Directive

Before asking any question, the controller must ask: **Do we already know this
answer, or can we safely infer it from what the respondent just said?**

If yes, do not ask the redundant question. Persist the inferred answer, mark
the relevant output/topic as covered, and move to the next useful research
step. This is not limited to disease routing. It applies across role, practice
setting, familiarity, disease focus, patient volume, decision drivers,
sentiment, objections, evidence priorities, information needs, and close-out
summaries.

Examples:

- If the respondent says "I am a community oncologist," capture both role and
  practice setting if the schema supports it; do not ask either again unless
  the answer is ambiguous.
- If the respondent names only one disease area, treat it as both active and
  primary disease lane; skip "which of those is most central?"
- If the respondent says "efficacy and tolerability are what matter," capture
  those decision drivers; route to the highest-value evidence or safety module
  rather than asking them to repeat the same factor list.
- If the respondent asks "what does the SEQUOIA data show?" and then reacts to
  the evidence, capture both the source-question intent and the evidence
  reaction; do not ask a generic SEQUOIA reaction question again.
- If the respondent has established a CLL/SLL lane and asks a broad source
  question such as "what's new?", treat that as "what's new in CLL/SLL?" Do
  not answer from WM, MCL, MZL, or FL pages unless the respondent explicitly
  names those areas or the selected research module is intentionally
  cross-disease.

Redundancy suppression should be deterministic where practical and validated by
typed extraction, not left to the interviewer persona to improvise.

## Operating Model

Use two cooperating layers:

1. **Survey controller**
   - Selects the next canonical question.
   - Tracks what has already been asked.
   - Enforces the timebox.
   - Limits follow-up depth.
   - Decides when to answer a reactive question and return to the survey.
   - Owns structured state and auditability.

2. **CustomGPT interviewer persona**
   - Uses the approved source/site material.
   - Provides proactive context before source-dependent questions.
   - Answers participant clarification questions with references.
   - Phrases the selected question naturally.
   - Keeps the tone conversational without changing the research objective.

The controller decides **what** to ask. CustomGPT helps decide **how** to say it
and supplies source-grounded context.

## Replicable Survey Strategy

Define the interview around intentions, not only a list of questions. A good
adaptive medical survey should carry one primary intent and several branch
intents that depend on respondent state.

Example primary intent:

```yaml
primary_intent: >
  Understand whether source-grounded product evidence changes HCP perception,
  barriers, confidence, likely use cases, and information needs.
```

Example branch intents:

```yaml
branch_intents:
  negative_sentiment:
    intent: >
      Identify the objection, show the most relevant source-grounded evidence,
      and learn what still prevents confidence or consideration.
    route_to:
      - objection_type
      - evidence_card
      - remaining_barrier

  neutral_sentiment:
    intent: >
      Identify what information could move the respondent from neutral to a
      clearer position, then test the most relevant evidence or practical
      attribute.
    route_to:
      - information_need
      - evidence_card
      - perception_shift

  positive_sentiment:
    intent: >
      Deepen the respondent's reasoning, identify the specific drivers of
      confidence, and test whether less familiar evidence or use cases could
      broaden appropriate consideration.
    route_to:
      - confidence_driver
      - adjacent_evidence_area
      - expanded_use_case

  high_familiarity_or_current_user:
    intent: >
      Avoid basic education. Probe actual decision rules, edge cases, barriers
      to broader use, and which evidence they use when explaining the product
      to peers or patients.
    route_to:
      - real_world_decision_rule
      - edge_case
      - evidence_used_in_discussion
```

Keep these intentions in controller state. The model may help phrase them, but
the app should not rely on a free-form model call to remember the strategy.

## Controller State To Track

The controller should maintain a compact respondent state object that can be
reused across products and therapeutic areas.

```yaml
respondent_state:
  role: null
  practice_setting: null
  active_disease_areas: []
  primary_disease_lane: null
  familiarity: unknown | low | moderate | high | current_user
  sentiment: unknown | negative | neutral | positive | mixed
  objection_type: null
  evidence_priorities: []
  covered_modules: []
  covered_outputs: []
  inferred_answers: []
  asked_question_ids: []
  followup_depth_by_module: {}
  remaining_seconds: 600
```

Two state rules matter most:

1. **Disease-lane continuity:** once the respondent establishes a primary
   disease lane, do not automatically pivot into a different disease module
   simply because it is next in the static guide. Switch lanes only when the
   participant mentions that disease, asks to discuss it, or the survey plan
   explicitly calls for a cross-disease comparison.
2. **Sentiment-aware routing:** negative, neutral, positive, and high-familiarity
   respondents should not receive the same next question. The canonical question
   can be the same research topic, but the route and probe should adapt to the
   state.
3. **Inference before interrogation:** every turn should extract structured
   facts and coverage signals from the respondent's answer before selecting the
   next question. Any question whose analyzable output is already answered
   should be skipped or rephrased into a deeper probe only if that deeper probe
   has a distinct research objective.

## Guide Shape

Each guide should have this structure.

```yaml
study:
  name: Example HCP Website Adaptive Survey
  target_duration_seconds: 600
  audience: HCPs
  source_system: CustomGPT
  source_material: Product website, PDFs, ISI, labels, study pages

persona:
  tone: Warm, concise, neutral, medically literate
  behavior:
    - Run a market research interview, not a general chat.
    - Ask one question at a time.
    - Before source-dependent questions, summarize the relevant source context.
    - If the respondent asks a source question, answer it with references, then return to the selected survey question.
    - Do not give patient-specific medical advice.
    - Do not repeat a question unless the participant did not understand it.

questions:
  - id: q_fit
    objective: Understand unaided positioning/perception.
    canonical_question: Where does this product fit in your current treatment thinking?
    source_context_required: false
    ask_if:
      - start_of_interview
    completion_signals:
      - respondent states initial fit, role, or lack of familiarity
    adaptive_probes:
      - If vague: What makes you say that?
      - If unfamiliar: What would you need to know to form an initial view?
    max_followups: 1
    analyzable_outputs:
      - perceived_fit
      - familiarity_level
      - initial_barriers
```

## Question Fields

- `id`: Stable question identifier.
- `objective`: Research reason for asking.
- `canonical_question`: The researcher's intended question.
- `source_context_required`: Whether the respondent needs source detail before answering.
- `source_context_requirement`: What CustomGPT must explain first.
- `ask_if`: Signals or conditions that make this question the right next step.
- `skip_if`: Signals that make the question redundant. Include both explicit
  prior answers and inferable answers from earlier turns.
- `completion_signals`: What counts as a real answer.
- `adaptive_probes`: Allowed follow-ups, not unlimited improvisation.
- `max_followups`: Usually 0-2.
- `analyzable_outputs`: Structured fields to extract after the answer.

Every question should have at least one `analyzable_output`. The controller
should use those outputs as a coverage ledger. A question is eligible only when
its objective is still uncovered or when the next probe adds materially new
research value.

## BRUKINSA-Style MVP Example

```yaml
questions:
  - id: q_initial_fit
    objective: Establish baseline perception and current mental placement.
    canonical_question: When you think about BTK inhibitors for adult patients with CLL/SLL, where does BRUKINSA fit today?
    source_context_required: false
    ask_if:
      - start_of_interview
    completion_signals:
      - mentions role, familiarity, perceived strengths, uncertainty, or barriers
    adaptive_probes:
      - What is driving that view most strongly?
      - What would make BRUKINSA feel more or less relevant?
    max_followups: 1
    analyzable_outputs:
      - unaided_fit
      - familiarity
      - initial_driver

  - id: q_sequoia
    objective: Understand reaction to frontline CLL/SLL evidence.
    canonical_question: What stands out to you from the SEQUOIA data, and how does it affect your perception of BRUKINSA in treatment-naive CLL/SLL?
    source_context_required: true
    source_context_requirement: Briefly summarize what SEQUOIA is, the CLL/SLL setting or population described by the approved source, comparator or cohort structure if available, key endpoint/result context, and any caveat needed for fair interpretation.
    ask_if:
      - respondent mentions evidence strength
      - respondent mentions frontline, 1L, treatment-naive, PFS, or SEQUOIA
      - q_initial_fit completed and no stronger branch is active
    skip_if:
      - respondent already gave a clear reaction to SEQUOIA
    adaptive_probes:
      - What part of that evidence matters most in real-world decision-making?
      - Does anything in the study context limit how persuasive it feels?
    max_followups: 1
    analyzable_outputs:
      - sequoia_reaction
      - evidence_driver
      - evidence_concern

  - id: q_alpine
    objective: Understand reaction to comparative relapsed/refractory evidence.
    canonical_question: What stands out to you from the ALPINE data, and how does it affect your perception of BRUKINSA versus ibrutinib in relapsed or refractory CLL/SLL?
    source_context_required: true
    source_context_requirement: Briefly summarize what ALPINE is, the relapsed/refractory CLL/SLL setting, the head-to-head comparison with ibrutinib if supported by the approved source, key endpoint/result context, and any caveat needed for fair interpretation.
    ask_if:
      - respondent mentions comparative data
      - respondent mentions ibrutinib, relapsed/refractory, head-to-head, or ALPINE
      - q_sequoia completed and comparative evidence remains uncovered
    skip_if:
      - respondent already gave a clear reaction to ALPINE
    adaptive_probes:
      - Does the comparison change your confidence, or does it simply confirm what you already thought?
      - What would you want to know beyond the headline result?
    max_followups: 1
    analyzable_outputs:
      - alpine_reaction
      - comparative_confidence
      - remaining_comparison_questions

  - id: q_safety
    objective: Identify safety/tolerability factors that affect consideration.
    canonical_question: Which safety or tolerability details would most influence whether BRUKINSA feels appropriate for a patient?
    source_context_required: true
    source_context_requirement: Briefly summarize source-supported safety, tolerability, warning, and adverse-event considerations at a high level without giving patient-specific advice.
    ask_if:
      - respondent mentions safety, tolerability, adverse events, warnings, cardiac, bleeding, infection, discontinuation, or patient selection
      - evidence questions completed and safety remains uncovered
    adaptive_probes:
      - Which concern would be most likely to slow adoption?
      - What safety information would make you more comfortable?
    max_followups: 1
    analyzable_outputs:
      - safety_driver
      - safety_barrier
      - information_need

  - id: q_source_clarity
    objective: Learn what source/site information is still unclear or missing.
    canonical_question: What information from the HCP site would you want clarified before feeling confident in your view?
    source_context_required: true
    source_context_requirement: Orient the respondent to the relevant source areas already discussed, such as efficacy, comparative evidence, safety, dosing, or study design, then ask what still needs clarification.
    ask_if:
      - respondent expresses uncertainty
      - respondent asks multiple clarification questions
      - core evidence and safety coverage is adequate
    adaptive_probes:
      - Is that a content gap, a credibility gap, or a presentation gap?
    max_followups: 1
    analyzable_outputs:
      - unresolved_questions
      - site_clarity_gap
      - confidence_barrier

  - id: q_close
    objective: Capture final summary for analysis.
    canonical_question: To close, what is the strongest reason you would consider BRUKINSA and the strongest remaining concern?
    source_context_required: false
    ask_if:
      - time_remaining_under_90_seconds
      - all_core_topics_covered
    max_followups: 0
    analyzable_outputs:
      - strongest_positive
      - strongest_concern
      - final_consideration_level
```

## Adaptation Rules

Use participant signals to choose the next canonical question.

```yaml
routes:
  - if_mentions:
      - frontline
      - treatment-naive
      - evidence strength
      - PFS
      - SEQUOIA
    next_question: q_sequoia

  - if_mentions:
      - ibrutinib
      - head-to-head
      - comparative
      - relapsed
      - refractory
      - ALPINE
    next_question: q_alpine

  - if_mentions:
      - safety
      - tolerability
      - adverse event
      - cardiac
      - bleeding
      - warnings
    next_question: q_safety

  - if_asks_source_question: answer_with_customgpt_then_return_to_selected_question

  - if_broad_source_question_and_active_lane_exists:
      source_scope: active_disease_lane
      off_lane_sources_allowed: only_if_explicitly_requested_or_cross_disease_module

  - if_answer_is_vague: ask_one_probe_then_continue

  - if_answer_already_covers_next_question:
      persist_inferred_answer: true
      mark_output_covered: true
      choose_next_uncovered_question: true

  - if_time_remaining_under_90_seconds: q_close
```

## Redundancy And Coverage Rules

Do not advance by static order alone. After each respondent answer:

1. Extract structured facts from the full answer, including unsolicited details.
2. Update respondent state and covered outputs.
3. Mark a question covered if its analyzable output is directly answered or
   safely inferred.
4. Skip any question whose only purpose is to collect an already-covered output.
5. If the answer is partial, ask a narrower clarification instead of repeating
   the full question.
6. If confidence is low, ask a concise confirmation, not a full repeated
   question.

Reusable skip examples:

```yaml
skip_patterns:
  single_choice_implied_primary:
    example: Respondent lists only CLL when asked disease areas.
    action: Set active_disease_areas=[CLL], primary_disease_lane=CLL, skip primary focus question.

  compound_context_answer:
    example: Respondent says "I'm a community hematologist-oncologist."
    action: Capture role/specialty/practice setting if schema confidence is high; skip redundant intake prompts.

  driver_already_named:
    example: Respondent says "PFS and tolerability matter most."
    action: Capture evidence_priorities=[PFS, tolerability], route to evidence/safety module rather than asking top factors again.

  multi_factor_priority_queue:
    example: Respondent says "Overall survival, NCCN category, and side-effect profile."
    action: Queue all named priorities in mention order, map endpoint synonyms such as OS/overall survival/PFS/progression-free survival to the evidence module, then work through each mapped module before closing or moving to unrelated topics.

  reactive_answer_also_reaction:
    example: Respondent asks for SEQUOIA data, receives it, then says it is persuasive but wants peer-reviewed confirmation.
    action: Capture sequoia_reaction and evidence_concern; route to credibility/publication caveat, not generic SEQUOIA reaction.

  broad_source_question_in_active_lane:
    example: Respondent says they treat CLL/SLL, then asks "what's new?"
    action: Answer only from CLL/SLL source material unless another disease is explicitly named or the controller selected a cross-disease breadth module.

  active_lane_citation_filter:
    example: Active lane is CLL/SLL, but the source agent returns WM, MCL, MZL, or FL references for a broad CLL/SLL follow-up.
    action: Drop clearly off-lane references before rendering, remove or renumber their inline markers, and log the dropped citation titles for QA.
```

## Option-To-Route Contract

Any question that offers answer options must define a route for every option.
Do not ask, "Which matters most: efficacy, safety, dosing, or guidelines?" unless
efficacy, safety, dosing, and guidelines each map to a valid next module, source
context requirement, or terminal capture action.

Reusable rules:

- Accept short option answers such as "Guidelines," "Safety," or "Dosing" when
  they match the active question's route keywords.
- Treat the selected option as a routing signal, not as a failed open-ended
  answer.
- If the selected option requires source grounding, proactively retrieve and
  summarize that source context before asking the next reaction question.
- If a respondent gives multiple options or priorities, store them as a
  deterministic follow-up queue and iterate through the mapped modules. Do not
  fixate on the highest-scoring keyword while dropping the rest.
- If a future bot includes different options, each option must be represented in
  the guide as typed route keywords plus a concrete follow-up module.
- Never list a response option only because it sounds plausible. If the
  interview cannot act on it, remove the option or add the missing route.

## Evidence-Card Rule For HCPs

When an HCP asks "what does the data show?" or a question requires study
context, do not answer with vague framing such as "flagship study," "anchor
evidence," or "strong data." Use a compact evidence-card format.

```yaml
evidence_card:
  study_or_source: Study name or source section
  setting_population: Disease setting and patient population
  design_comparator: Phase/design/cohorts/comparator when supported
  endpoint: Primary/key endpoint or claim context
  key_results: Exact source-supported numeric results when available
  safety_or_caveat: Safety/tolerability context, limitations, accelerated approval caveats, exploratory/descriptive caveats
  citation_marker: Inline numbered marker immediately after the supported claim
```

After the evidence card, ask one reaction question. Do not continue listing
facts unless the respondent asks for more detail.

## Citation Rules

The UI should make citations feel attached to the claims they support.

- Ask the source agent to place inline citation markers such as `[1]` immediately
  after source-supported claims.
- Render those markers as small circular clickable chips.
- Open citation URLs in a side source panel when possible so the survey stays
  alive. Keep an "open in new tab" escape hatch for sites that block embedding.
- Assume many external HCP/brand sites block iframe embedding. For those URLs,
  show a clean source card in the side panel with title, host, and an "open in
  new tab" action instead of rendering a broken iframe. Reserve true embedded
  previews for owned assets, local files, PDFs, and URLs known to allow
  embedding.
- Allow the respondent to close the source panel. A later citation click should
  replace the panel content.
- For source-heavy answers, proactively open the first returned source/asset in
  the side panel unless the respondent closed the panel for that message.
- Still show a compact reference list below the message for scanability.
- If the source system returns only citation IDs, resolve them to title/URL
  server-side before rendering.
- Cache citation metadata by project and citation ID during a session to avoid
  repeated lookups.
- If the source agent emits marker numbers that do not map to returned
  references, normalize them to the returned reference order so the UI never
  shows orphan citation markers.
- When a source page exposes relevant figures, charts, graphs, or screenshots,
  show them in the side source panel when the respondent clicks the citation.
  Rank assets by nearby source context and clinical terms, not just by page
  order, so clinical figures beat logos and generic artwork.
- Suppress lifestyle/brand/hero photography and product-only pack shots such
  as pill, tablet, bottle, capsule, or splash-campaign images. These are usually
  marketing atmosphere, not useful respondent stimulus. Keep charts, tables,
  study figures, guide/brochure/form/document assets, and clinically meaningful
  screenshots.
- When a source page exposes a `srcset`, prefer the highest-resolution useful
  candidate rather than a thumbnail. Do not upscale low-resolution PDF/resource
  cover images in the side panel or expanded modal; show the crispest available
  asset and preserve the source link for full-size viewing.
- If a low-resolution image is only a cover/thumbnail for a linked PDF or other
  document, prefer surfacing the linked document as the primary asset in the
  side panel or as a clear "open document" action. The thumbnail can remain as
  a cue, but it should not be treated as the detailed review asset.
- Preserve the full source link and "open in new tab" action even when figures
  are shown in-panel.
- Provide an expand control for source figures so detailed charts can open in a
  larger modal without losing the survey state.
- Keep the actual respondent-facing ask visually distinct even when citation
  markers trail the question. The UI should identify the final question mark
  before trailing references and bold only the ask, not the whole evidence card.

If inline markers are missing, the message should still show references, but
the transcript should be flagged during QA because it is weaker than claim-level
citation behavior.

## Performance Rules

For a fast-feeling MVP:

- Do not send routine intake or plain survey-navigation turns to CustomGPT.
  Deterministically ask the selected canonical question when no source context
  or reactive clarification is needed.
- Add a short minimum response pacing delay for very fast deterministic turns
  so the interview feels human, especially once voice is added. Roughly
  0.5-1.0 seconds is enough; do not add delay to already-slow source calls.
- Keep the per-turn prompt compact: selected question, current question, active
  lane, recent questions, source-context requirement, and participant message.
- Give source API calls a timeout so the UI never spins forever.
- Resolve citation metadata only when needed; skip the extra citation fetch when
  title and URL are already present.
- Cache citation metadata during the API process.
- Avoid asking CustomGPT to decide the entire survey path; deterministic
  controller selection is faster and easier to debug.

## Voice Rollout

Roll voice out in layers so the interview logic remains testable.

```yaml
voice_increment_1_recorded_push_to_talk:
  behavior:
    - respondent clicks Record
    - browser records a short audio clip
    - server transcribes the clip
    - transcript fills the response box for respondent review
    - respondent clicks Send to submit the reviewed transcript
  guardrail: Voice is transport only; it does not choose questions.

voice_increment_2_spoken_pacing:
  behavior:
    - keep deterministic turns slightly paced
    - strip citation markers from spoken audio
    - keep full evidence and citations in chat/source panel
    - provide an explicit Read/Stop control for the latest interviewer message
    - once readback is enabled, continue reading subsequent interviewer turns
      after the respondent submits a reviewed answer

voice_increment_3_realtime:
  behavior:
    - use realtime voice transport
    - stream partial transcription
    - support interruption/barge-in
    - still submit final respondent meaning to the server-controlled survey loop
```

For medical evidence turns, the spoken answer should usually be shorter than
the written answer. The chat and side panel can carry the detailed study data,
citations, and assets while the voice gives a concise interviewer version.

Voice tone and sentiment can be extracted for post-interview analysis, but they
should not drive live routing in V1. The live interviewer should route from the
validated transcript and structured semantic extraction. Audio-derived tone can
later enrich analysis fields such as hesitation, confidence, frustration, or
enthusiasm, with clear disclosure and consent.

## Per-Turn Persona Prompt

Pass this kind of instruction with each turn.

```text
You are running a structured medical market research interview.

Your job is to help phrase the selected canonical question and provide
approved-source context when needed. The controller has already selected the
next research step.

Rules:
- Ask one question only.
- If source_context_requirement is present, explain that source context first,
  cite it, then ask the selected question.
- For HCP evidence questions, use compact evidence cards with exact
  source-supported numeric results when available.
- For patient-population questions, stay in the active disease lane and include
  source-supported inclusion/exclusion, mutation/subgroup, and safety-risk
  caveats only when supported by that lane's source material or general ISI.
- Put inline citation markers immediately after the specific claims they
  support.
- If the participant asks a source or clarification question, answer it using
  approved CustomGPT material with citations, then return to the selected
  survey question in the same response.
- Broad source questions inherit the active disease lane. For example, "what's
  new?" after a CLL/SLL lane means "what's new for CLL/SLL?" Do not cite or
  summarize off-lane disease pages unless the participant explicitly asks for
  them or the controller selected a cross-disease module.
- Do not provide patient-specific medical advice.
- Do not over-probe. If the answer is adequate, move forward.
- Do not repeat already asked questions.
- Do not pivot into a different disease lane unless the participant asks or the
  controller selected a cross-disease module.
- Keep the tone natural, medically literate, neutral, and concise.
```

## MVP Turn Capture

Until the MVP bridge stores these events in Postgres, capture an append-only
local JSONL audit file per session. Each turn audit should include:

- participant message
- current question before the turn
- selected canonical question
- actual rendered question
- active disease lane and primary disease lane
- source-context requirement
- CustomGPT status and failure reason, when applicable
- dropped reference titles/URLs
- final rendered references
- interviewer message

This makes bad turns replayable and lets QA answer: **Why did the interviewer
ask this next, and why did those sources appear?**

## Import Workflow For A New Site

1. Load the website, PDF, label, study pages, and related approved assets into
   CustomGPT.
2. Create a site evidence map:
   - product positioning
   - major studies/trials
   - indications/settings
   - efficacy claims
   - safety/tolerability topics
   - dosing/administration topics
   - access/support topics, if relevant
3. Convert the researcher's draft questions into guide objects.
4. For every question that names or implies source material, add a
   `source_context_requirement`.
5. Add adaptive routes based on likely respondent language.
6. Add completion signals and `max_followups`.
7. Add `skip_if` and inferred-coverage rules for every intake and branch
   question that could be answered incidentally.
8. Test with 3-5 simulated respondents:
   - unfamiliar respondent
   - skeptical respondent
   - highly familiar respondent
   - off-topic/detail-seeking respondent
   - time-constrained respondent
9. Review transcripts for:
   - skipped required topics
   - repeated questions
   - questions asked after the answer was already inferable
   - source context missing before reaction questions
   - weak or missing citations
   - missing source figures or unreadable clinical charts
   - excessive probing
   - timebox failure

## Adding A New Brand Survey

Use a survey slug instead of creating a separate app when the same interview
shell, citation UI, source panel, voice behavior, and audit capture are
appropriate.

1. Create a dedicated CustomGPT project for the brand/source universe.
2. Add a product-specific API environment variable such as
   `CUSTOMGPT_PADCEV_PROJECT_ID`. Do not let a new product fall back to another
   brand's CustomGPT project.
3. Add a typed guide file under `apps/api/src/lib/` with canonical questions,
   route keywords, completion signals, analyzable outputs, and
   `sourceContextRequirement` text for every source-dependent question.
4. Register the guide in the MVP survey definitions with:
   - slug
   - default study name
   - source brand
   - guide
   - project-id resolver
5. Add a public web route such as `/surveys/padcev/` that passes `surveySlug`
   and `studyName` into the reusable MVP modal.
6. Add the route to the Hostinger static-copy script so the deployed static
   folder includes the page.
7. Add brand-specific keyword hooks only where they support routing and
   non-repetition. Keep generic interview control in the shared controller.
8. Deploy the web branch and the API branch, then verify:
   - public route loads
   - `/health` works on the API host
   - start returns the correct `studyName`
   - missing CustomGPT configuration names the new project variable
   - source turns cite the correct brand/project

### PADCEV MVP Setup

The PADCEV MVP uses `/surveys/padcev/` and the `padcev` survey slug. Its guide
focuses on:

- role and practice context
- urothelial cancer/bladder cancer exposure
- baseline familiarity
- pre-PADCEV systemic therapy decision drivers
- current indication/positioning
- EV-302/KEYNOTE-A39 first-line evidence
- patient fit and caution areas
- later-line monotherapy evidence, including EV-301/EV-201 when supported
- safety/tolerability
- dosing and administration
- implementation barriers
- overall reaction and close

The PADCEV CustomGPT project should be loaded with the official PADCEV HCP site
and approved assets before live testing. Source-dependent questions deliberately
ask CustomGPT to retrieve and summarize the current HCP material rather than
hardcoding clinical claims into the app.

For fast MVP testing, the public PADCEV route starts with an intent picker and
skips early intake questions such as respondent role, practice setting, disease
exposure, and patient volume. Those questions can be restored later for
production research runs, but they are intentionally excluded from the current
intent-specific PADCEV paths so test turns reach source-backed content quickly.

Current PADCEV intent options:

- **General PADCEV Reaction**: balanced coverage across positioning, EV-302,
  patient fit, safety, dosing/admin, and overall perception.
- **EV-302 / First-Line Evidence**: prioritizes EV-302/KEYNOTE-A39 design,
  concrete outcomes, first-line implications, patient fit, and evidence gaps.
- **Side Effect Management**: prioritizes adverse-event monitoring,
  mitigation, dose modification confidence, counseling, and implementation
  barriers.
- **Patient Selection & Barriers**: prioritizes appropriate patient types,
  caution segments, adoption barriers, access/support needs, and confidence
  gaps.
- **Already Familiar: What's New**: assumes basic familiarity and focuses on
  current positioning, newer or underappreciated evidence, and what might
  change behavior.

Each intent should define:

- public picker label
- internal slug
- primary objective
- required coverage
- steering rule
- ordered question path

The controller should include the selected intent in the CustomGPT context and
audit log. The intent changes prioritization and steering, but factual answers
must still come from the configured CustomGPT source project.

## Why This Style

This style preserves the strongest parts of CustomGPT, especially source
retrieval and citation-rich explanation, while adding what CustomGPT alone does
not reliably enforce:

- time limit
- no fixation
- no repeated question loops
- structured coverage
- auditable decisions
- analyzable outputs
- proactive source context before reaction questions

The result should feel like a simple chat interview to the participant, but run
like a controlled research instrument under the hood.
