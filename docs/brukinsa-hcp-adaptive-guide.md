# BRUKINSA HCP Adaptive Interview Guide

Source document: `BRUKINSA HCP WEBSITE QUESTION LIST.docx`

This is the runnable guide shape for the MVP bridge. It preserves the intent of
the DOCX workflow, but turns it into structured objects: canonical questions,
source-context requirements, route keywords, adaptive probes, and analyzable
outputs.

## Study Setup

```yaml
study:
  name: BRUKINSA HCP Adaptive Drug-Perception Survey
  audience: U.S. HCPs involved in adult B-cell malignancies
  source_material: BRUKINSAHCP.com and approved indexed assets in CustomGPT
  target_duration: 15-25 minutes for full study; shorter if timeboxed by the app
  mode: browser chat MVP
```

## Operating Rules

- Ask one respondent-facing question at a time.
- Do not start with a scientific overview.
- First learn role, setting, disease involvement, primary disease focus,
  BRUKINSA familiarity, and baseline BTKi decision framework.
- Route first to the respondent's primary disease area.
- For scientific modules, retrieve/summarize the relevant website content first,
  include caveats, cite references, then ask the reaction question.
- If the respondent asks a valid source or evidence question, answer it with
  references before moving on.
- Maintain coverage of efficacy, safety/tolerability, dosing/medication
  management, patient fit, support/resources, and overall perception.
- Maintain the active disease lane. If a respondent establishes CLL/SLL as the
  active lane, do not automatically pivot to WM, MCL, MZL, or FL unless the
  respondent mentions that disease area or the controller intentionally selects
  a cross-disease comparison.
- Track sentiment and familiarity as routing state. Negative, neutral, positive,
  and high-familiarity respondents should receive different probes even when
  the evidence topic is the same.
- For evidence requests from HCPs, answer with concrete study highlights:
  setting/population, design/comparator or cohorts, endpoint, exact
  source-supported numeric results when available, safety/tolerability context,
  caveats, and inline citations.
- Do not display internal labels, routes, modules, or source maps.

## Intent And Sentiment Strategy

```yaml
primary_intent: >
  Understand whether BRUKINSA HCP site evidence, especially SEQUOIA in CLL/SLL,
  changes HCP perception, barriers, confidence, likely use cases, and
  information needs.

sentiment_routes:
  negative:
    goal: Identify what prevents confidence or championing appropriate use.
    next_best_moves:
      - classify barrier: efficacy, comparator relevance, safety, patient fit, access, guidelines, or disease-specific caveat
      - show the most relevant evidence card
      - ask what remains unresolved

  neutral:
    goal: Identify what information could move the respondent from neutral to a clearer view.
    next_best_moves:
      - ask what evidence or attribute would matter most
      - show source-grounded detail for that attribute
      - ask whether it changes consideration

  positive:
    goal: Deepen the reason for confidence and test whether less familiar data or use cases broaden appropriate consideration.
    next_best_moves:
      - ask what specifically drives confidence
      - probe patient types or settings where use could expand
      - introduce adjacent evidence if the respondent has not reacted to it yet

  high_familiarity_or_user:
    goal: Avoid basics and learn real-world decision rules.
    next_best_moves:
      - ask when BRUKINSA wins or does not win
      - probe edge cases and barriers to broader use
      - ask which evidence the respondent would cite to others
```

## Disease-Lane Rules

```yaml
disease_lane_state:
  active_disease_areas: []
  primary_disease_lane: null

rules:
  - Capture all disease areas mentioned during intake.
  - Set primary_disease_lane when the respondent answers the primary disease focus question.
  - Route automatically within the primary lane first.
  - Allow explicit lane switches when the respondent mentions another disease area.
  - Do not fall through from CLL/SLL modules into WM solely because WM is next in the guide.
  - For broad safety, dosing, support, patient-fit, and overall perception modules, keep the context anchored to the active lane unless the source question is intentionally cross-disease.
```

## Evidence Overview Module

Use this when the respondent asks broad questions like "what does the data
show?" before choosing a disease-specific evidence path.

```yaml
module: Evidence Overview
canonical_question: >
  Which part of this evidence is most relevant to your view: CLL/SLL SEQUOIA
  first-line data, CLL/SLL ALPINE head-to-head data, MCL/MZL/FL
  response-focused data, safety/tolerability, or something else?
source_context_requirement: >
  Do not give a vague brand story or website outline. Retrieve concrete
  BRUKINSA HCP evidence highlights for the disease areas already mentioned by
  the respondent. Include SEQUOIA and ALPINE when CLL/SLL is relevant. For each
  relevant study, include study name, setting/population, design/comparator or
  cohorts, endpoint(s), exact source-supported numeric result(s) when available,
  safety/tolerability context if relevant, and caveats such as accelerated
  approval or exploratory/descriptive analyses.
outputs:
  - evidence_overview_reaction
  - highest_priority_evidence_area
  - evidence_gap
```

## Citation And Speed SOP For This MVP

- Ask CustomGPT to use inline citation markers such as `[1]` immediately after
  source-supported claims.
- Render those markers as circular clickable chips and open source URLs in a
  separate tab/window.
- Keep a compact reference list below each sourced answer.
- Do not call CustomGPT for routine intake turns such as role, practice setting,
  or ordinary non-source navigation. Ask the selected canonical question
  directly.
- Apply a timeout to CustomGPT source calls so the chat cannot remain stuck in a
  sending state indefinitely.
- Cache citation metadata and skip citation-detail calls when the message
  already contains a usable title and URL.

## Guide Objects

### `intro_consent`

```yaml
module: Introduction
objective: Confirm permission and set neutral market research context.
canonical_question: >
  Thank you for participating. We're conducting market research about BRUKINSA
  and how healthcare professionals react to clinical information about the
  drug. This is not a test of knowledge, and there are no right or wrong
  answers. Please don't include patient-identifying information. Is it okay to
  begin?
source_context_required: false
outputs: [consent_to_begin]
```

### `role`

```yaml
module: Context
objective: Understand respondent role so later probes can adapt.
canonical_question: What is your clinical role?
adaptive_probes:
  - If physician: What is your specialty?
  - If NP/PA: What parts of care are you most involved in?
  - If pharmacist: What parts of medication management or access are you most involved in?
outputs: [role, specialty, care_responsibility]
```

### `practice_setting`

```yaml
module: Context
canonical_question: What type of practice setting do you work in?
outputs: [practice_setting]
```

### `disease_involvement`

```yaml
module: Context
canonical_question: Which B-cell malignancies do you personally treat, manage, counsel, monitor, or support?
route_keywords: [CLL, SLL, WM, Waldenstrom, MCL, MZL, FL, follicular]
outputs: [disease_areas]
```

### `primary_disease_focus`

```yaml
module: Context
canonical_question: Which of those disease areas is most central to your day-to-day practice?
adaptive_probes:
  - If multiple or unclear: Which disease area would be most useful to focus on first for this discussion?
outputs: [primary_disease_focus]
```

### `patient_volume`

```yaml
module: Context
canonical_question: About how many patients in that primary disease area do you personally see or support in a typical month?
outputs: [primary_disease_patient_volume]
```

### `familiarity`

```yaml
module: Context
canonical_question: How familiar are you with BRUKINSA today?
adaptive_probes:
  - If current/regular user: What has most shaped your view of BRUKINSA so far?
  - If occasional user: What types of patients or situations tend to bring BRUKINSA to mind?
  - If aware non-user: What has kept BRUKINSA from being more prominent in your thinking?
  - If low familiarity: What would you need to understand first: efficacy, safety, patient fit, dosing, guidelines, or access?
outputs: [brukinsa_familiarity, baseline_driver, baseline_barrier]
```

### `btki_decision_framework`

```yaml
module: Baseline BTKi Decision Framework
canonical_question: >
  Before we get into BRUKINSA-specific information, when you evaluate or
  support use of a BTK inhibitor for an appropriate patient, what are the top
  two or three factors that matter most?
adaptive_probes:
  - If efficacy: What kind of efficacy evidence matters most?
  - If safety: Which safety concerns matter most?
  - If patient fit: What patient factors most affect BTKi choice?
  - If practical/logistical: What practical issues matter most?
outputs: [btki_decision_factors, evidence_preferences, safety_priorities]
```

### `breadth`

```yaml
module: BRUKINSA Breadth
canonical_question: Clinically, what does BRUKINSA's breadth across five B-cell malignancies suggest to you about the drug?
source_context_requirement: >
  Retrieve and summarize the current BRUKINSA HCP homepage or indication
  section. Include that BRUKINSA is presented as approved across CLL/SLL, WM,
  MCL, MZL, and FL, and include the accelerated approval caveats for MCL, MZL,
  and FL when supported by the source.
adaptive_probes:
  - If positive: Does the breadth make BRUKINSA feel more established, more familiar across diseases, or more useful in practice?
  - If skeptical: Do you need disease-specific evidence before the breadth message matters?
  - If mixed: Which part of the breadth story is meaningful, and which part needs proof?
outputs: [breadth_reaction, accelerated_approval_reaction]
```

### `cll_baseline_perception`

```yaml
module: CLL/SLL Primary Route
canonical_question: Before reviewing the BRUKINSA CLL/SLL information, what is your current perception of BRUKINSA in CLL/SLL?
route_keywords: [CLL, SLL, first line, frontline, treatment naive, relapsed, refractory]
adaptive_probes:
  - If positive: What has shaped that positive view?
  - If negative: What is the main concern or barrier?
  - If mixed: What is positive, and what still gives you pause?
  - If unfamiliar: What would you need to understand first?
outputs: [cll_baseline_perception, cll_baseline_driver, cll_barrier]
```

### `cll_orientation`

```yaml
module: CLL/SLL Evidence Orientation
canonical_question: >
  Based on that high-level CLL/SLL story, what part matters most for your view
  of BRUKINSA: first-line efficacy, relapsed/refractory head-to-head data,
  safety/tolerability, patient fit, dosing, or guidelines?
source_context_requirement: >
  Retrieve and summarize the current BRUKINSA CLL/SLL main page and efficacy
  page. Include the CLL/SLL positioning, SEQUOIA as the first-line evidence
  anchor, ALPINE as the relapsed/refractory head-to-head evidence anchor, and
  note that the section also covers safety/tolerability, NCCN preferred
  positioning, dosing, and resources if supported by the source.
outputs: [cll_priority_topic]
```

### `sequoia`

```yaml
module: CLL/SLL - SEQUOIA First-Line Efficacy
canonical_question: How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?
source_context_requirement: >
  Retrieve and summarize the current BRUKINSA CLL/SLL efficacy page, SEQUOIA
  section. Include trial design, treatment-naive CLL/SLL setting, Cohort 1
  BRUKINSA versus bendamustine plus rituximab in patients without del(17p),
  Cohort 2 BRUKINSA-only del(17p) context if available, primary endpoint PFS by
  IRC in the ITT population, current key PFS result, longer-term results if
  current on site, and exploratory/descriptive caveats.
adaptive_probes:
  - If positive: What most drives confidence?
  - If skeptical: What limits confidence?
  - If mixed: What part supports consideration, and what still needs more context?
outputs: [sequoia_reaction, first_line_evidence_driver, sequoia_concern]
```

### `sequoia_patient_fit`

```yaml
module: CLL/SLL - SEQUOIA Patient Fit
canonical_question: For which first-line CLL/SLL patient types, if any, would this evidence make BRUKINSA more attractive?
source_context_requirement: Use the SEQUOIA context already retrieved. If needed, briefly restate source-supported setting, patient population, and caveats before asking about patient fit.
outputs: [first_line_patient_fit, patient_fit_caveat]
```

### `alpine`

```yaml
module: CLL/SLL - ALPINE Relapsed/Refractory Efficacy
canonical_question: How does the ALPINE head-to-head evidence affect your view of BRUKINSA relative to ibrutinib or other BTK inhibitors?
source_context_requirement: >
  Retrieve and summarize the current BRUKINSA CLL/SLL efficacy page, ALPINE
  section. Include global Phase 3 randomized open-label R/R CLL/SLL setting
  after at least one prior systemic therapy, BRUKINSA versus ibrutinib
  comparison, ORR primary endpoint assessed for noninferiority, PFS key
  secondary endpoint, superiority testing after noninferiority, current key PFS
  and ORR information, and longer-term/subgroup caveats where applicable.
outputs: [alpine_reaction, comparative_confidence, alpine_concern]
```

### `cll_safety_tolerability`

```yaml
module: CLL/SLL - Safety and Tolerability
canonical_question: How does the CLL/SLL safety and tolerability information affect your risk-benefit view of BRUKINSA?
source_context_requirement: >
  Retrieve and summarize the current BRUKINSA CLL/SLL safety page, tolerability
  page, and Important Safety Information. Include source-supported CLL/SLL
  safety/tolerability framing, low AFib/flutter and discontinuation context if
  current, and broader risks including hemorrhage, infections, cytopenias,
  second primary malignancies, cardiac arrhythmias, hepatotoxicity including
  DILI, embryo-fetal toxicity, drug interactions, and common adverse
  reactions/lab abnormalities.
outputs: [cll_safety_reaction, safety_driver, safety_barrier]
```

### `wm_aspen`

```yaml
module: WM Primary Route
canonical_question: How does the WM evidence story affect your perception of BRUKINSA for appropriate patients with Waldenstrom macroglobulinemia?
source_context_requirement: Retrieve and summarize the current BRUKINSA WM pages, including ASPEN head-to-head BTKi framing and source-supported efficacy/safety context.
outputs: [wm_reaction, wm_evidence_driver]
```

### `accelerated_approval_indolent`

```yaml
module: MCL/MZL/FL Routes
canonical_question: How do the response-focused evidence and accelerated approval caveats in MCL, MZL, or FL affect your perception of BRUKINSA in those settings?
source_context_requirement: Retrieve and summarize the current BRUKINSA MCL, MZL, and/or FL page most relevant to the respondent, including disease-specific indication, response-focused evidence, line-of-therapy context, and accelerated approval caveat.
outputs: [accelerated_approval_concern, noncll_evidence_reaction]
```

### `general_safety_isi`

```yaml
module: General Safety / ISI
canonical_question: Which safety issue would most affect patient selection or monitoring in your practice?
source_context_requirement: Retrieve and summarize the current Important Safety Information from the relevant BRUKINSA HCP page.
outputs: [most_important_safety_issue, safety_monitoring_concern]
```

### `dosing_formulation`

```yaml
module: Dosing / Formulation / Dose Modification
canonical_question: From a real-world practice perspective, how does the dosing and formulation profile affect your view of BRUKINSA?
source_context_requirement: Retrieve and summarize the current BRUKINSA dosing page, including tablet formulation, QD/BID dosing if current, scored tablets, dose modification by reducing tablet count, no dose exchanges, food guidance, missed-dose guidance, and dose-modification guidance.
outputs: [dosing_reaction, formulation_driver, practical_barrier]
```

### `medication_management`

```yaml
module: Medication Management / Comorbidities
canonical_question: How well does this medication-management profile fit the kinds of patients you see or support?
source_context_requirement: Retrieve and summarize the current dosing page and ISI drug-interaction sections, including acid reducers, anticoagulant/antiplatelet information, CYP3A guidance, severe hepatic impairment dosing, and relevant safety caveats.
outputs: [medication_management_fit, interaction_concern, comorbidity_caution]
```

### `patient_fit`

```yaml
module: Patient Fit
canonical_question: For which patient types does BRUKINSA seem most attractive, and for which patient types would you be more cautious?
source_context_requirement: Briefly synthesize the efficacy, safety/tolerability, dosing, and medication-management information already discussed, then ask about patient fit.
outputs: [attractive_patient_types, caution_patient_types, patient_fit_driver]
```

### `support_resources`

```yaml
module: Support and Resources
canonical_question: Would these support resources remove any real-world barrier to using or supporting BRUKINSA, or would access and logistics remain a concern?
source_context_requirement: Retrieve and summarize the current BRUKINSA resources page and myBeOne Support references.
outputs: [support_resource_reaction, resource_value_driver, access_barrier]
```

### `overall_perception`

```yaml
module: Overall Drug Perception
canonical_question: Thinking across the clinical evidence, safety and tolerability, disease indications, dosing, medication-management information, patient fit, and support resources, what is your overall perception of BRUKINSA after reviewing this information?
outputs: [overall_perception, sentiment, top_positive_drivers, top_barriers]
```

### `behavioral_implication`

```yaml
module: Overall Drug Perception
canonical_question: What action, if any, would you be more likely to take after reviewing this information?
outputs: [likely_behavioral_implication, action_rationale]
```

### `close`

```yaml
module: Closing
canonical_question: To close, what is the strongest part of the BRUKINSA clinical story, what is the biggest remaining concern or evidence gap, and what question would you still want answered?
outputs: [strongest_story_element, biggest_remaining_concern, remaining_question]
```
