import { figureById } from "../structured-interview/nubeqa-figures";
import type { EvidenceFigure } from "../structured-interview/types";

export type Criterion = { id: string; label: string; description: string };

export type Objection = {
  id: string;
  title: string;
  /** What the simulated HCP says, in their own voice. */
  hcpLine: string;
  setting: string;
  /** What a strong answer does, judged by the coach. Acknowledgment and compliance apply to every objection. */
  criteria: Criterion[];
  /** Pre-written strong response, shown after the attempt. */
  modelAnswer: string;
  figures: EvidenceFigure[];
};

export type TrainerProgram = {
  slug: "nubeqa";
  brand: string;
  title: string;
  persona: { name: string; role: string };
  roundSize: number;
  objections: Objection[];
  /** Everything the coach may treat as accurate. Claims outside this list are flagged as unsupported. */
  approvedFacts: string[];
  /** Compliance rules every reply is checked against. */
  rules: string[];
};

const figures = (...ids: string[]): EvidenceFigure[] => ids.map(id => { const { url, alt, caption } = figureById(id); return { url, alt, caption }; });

const ACKNOWLEDGE: Criterion = { id: "acknowledge", label: "Acknowledge and clarify",
  description: "Acknowledges the concern without dismissing it, and asks or checks what matters to this doctor or which patients they mean." };

export const NUBEQA_TRAINER: TrainerProgram = {
  slug: "nubeqa",
  brand: "NUBEQA",
  title: "NUBEQA objection practice",
  persona: { name: "Dr. Patel", role: "GU medical oncologist" },
  roundSize: 5,
  rules: [
    "Stay on-label: NUBEQA is indicated for adult patients with nmCRPC, and for mCSPC alone or in combination with docetaxel. Do not suggest other uses.",
    "No comparative claims: there are no head-to-head trials versus enzalutamide, apalutamide or other ARIs, so do not say or imply NUBEQA is better, safer, better tolerated or has fewer interactions than them.",
    "Do not attribute a result to the wrong trial or setting (for example, do not claim an overall survival benefit for ARANOTE, which reported rPFS).",
    "Use numbers exactly as approved; do not round in a way that changes meaning or invent figures.",
    "When discussing safety or tolerability, include fair balance: mention the warnings (ischemic heart disease, seizure, embryo-fetal toxicity) or point to the full Important Safety Information.",
    "Do not promise outcomes for an individual patient or make claims about cost, adherence or convenience that the approved facts do not support.",
  ],
  approvedFacts: [
    "Indications: adult patients with non-metastatic castration-resistant prostate cancer (nmCRPC); metastatic castration-sensitive prostate cancer (mCSPC); mCSPC in combination with docetaxel.",
    "ARANOTE (mCSPC, no docetaxel): randomized 2:1, double-blind, phase III; 669 patients (446 NUBEQA, 223 placebo), all on ADT. Primary endpoint rPFS: HR 0.54 (95% CI 0.41–0.71; P<0.0001), a 46% reduction in risk of radiographic progression or death. Median rPFS not reached vs 25 months. At 24 months, 70.3% vs 52.1% alive without radiological progression (landmark analysis). Median follow-up about 25 months. The site does not report an overall survival result for ARANOTE.",
    "ARANOTE safety: serious adverse reactions 24%; most common adverse reaction urinary tract infection (12% vs 8%). Permanent discontinuation due to adverse reactions 6% with NUBEQA vs 9% with placebo. Over 96% treated without dose reduction; over 85% with no dose interruption.",
    "ARASENS (mCSPC with docetaxel): double-blind phase III, NUBEQA + ADT + docetaxel vs placebo + ADT + docetaxel. Primary endpoint overall survival: HR 0.68 (95% CI 0.57–0.80; P<0.0001), reducing risk of death by nearly a third. At 4 years, 63% vs 50% alive (landmark analysis). 76% of control patients received subsequent life-prolonging therapy. Docetaxel 75 mg/m² every 3 weeks for 6 cycles, started within 6 weeks of NUBEQA.",
    "ARASENS safety: serious adverse reactions 45%; most common included constipation (23%) and rash (20%). Permanent discontinuation due to adverse reactions 14% with NUBEQA vs 11% with placebo (both with docetaxel). Over 90% treated without dose reduction.",
    "ARAMIS (nmCRPC): double-blind, placebo-controlled; 955 NUBEQA vs 554 placebo, all on ADT. Median metastasis-free survival 40.4 vs 18.4 months, HR 0.41 (95% CI 0.34–0.50; P<0.0001). Overall survival HR 0.69 (95% CI 0.53–0.88; P=0.003), a 31% reduction in risk of death. Time to pain progression HR 0.65 (95% CI 0.53–0.79). Time to cytotoxic chemotherapy HR 0.58 (95% CI 0.44–0.76); at 3 years 83% vs 75% had not received chemotherapy. MFS benefit consistent for PSADT ≤6 and >6 months.",
    "ARAMIS safety: serious adverse reactions 25% vs 20%. Severe fatigue 0.6% vs 1.1% with ADT alone. About 95% treated without dose reduction; 9% discontinued due to adverse reactions.",
    "Warnings and precautions: ischemic heart disease, including fatal cases (pooled ARAMIS/ARANOTE 3.4% vs 2.2%; ARASENS 3.2% vs 2%), discontinue for Grade 3–4; seizure (0.2% pooled ARAMIS/ARANOTE; 0.8% in ARASENS), consider discontinuation; embryo-fetal toxicity, males with female partners of reproductive potential should use effective contraception during treatment and for 1 week after.",
    "Drug interactions: avoid combined P-gp and strong or moderate CYP3A4 inducers; with combined P-gp and strong CYP3A4 inhibitors monitor more frequently and modify dose as needed; NUBEQA inhibits BCRP (avoid BCRP substrates where possible) and OATP1B1/OATP1B3 (consider substrate dose reduction). No clinically relevant change in docetaxel pharmacokinetics in mCSPC. Concomitant medication use was common: 100% in ARASENS, 98.7% in ARAMIS and 93.5% in ARANOTE took at least one.",
    "Dosing: 600 mg (two 300 mg tablets) twice daily with food, with a GnRH agonist or antagonist or after bilateral orchiectomy. Reduce to 300 mg twice daily for severe renal impairment (eGFR 15–29, not on dialysis), moderate hepatic impairment (Child-Pugh B), or Grade ≥3 or intolerable adverse reactions; doses below 300 mg twice daily are not recommended. A missed dose is taken as soon as remembered before the next dose, never doubled.",
    "There are no head-to-head trials of NUBEQA versus other androgen receptor inhibitors.",
  ],
  objections: [
    {
      id: "switch", title: "Happy with another ARI", setting: "Any setting",
      hcpLine: "Honestly, I'm comfortable with the androgen receptor inhibitor I already use. Why would I switch to NUBEQA?",
      criteria: [
        ACKNOWLEDGE,
        { id: "own_data", label: "NUBEQA's own evidence", description: "Presents NUBEQA's trial data for the relevant setting (ARANOTE, ARASENS or ARAMIS) accurately, tied to the doctor's patients." },
        { id: "no_comparison", label: "No comparative claim", description: "Does not claim or imply NUBEQA is better, safer or better tolerated than the doctor's current ARI; may note there are no head-to-head trials." },
      ],
      modelAnswer: "That makes sense, and I'm not here to ask you to switch patients who are doing well. Can I ask which patients you're treating most often, mCSPC or nmCRPC? There are no head-to-head trials between ARIs, so I can only share NUBEQA's own data. In mCSPC without docetaxel, ARANOTE showed a 46% reduction in the risk of radiographic progression or death versus placebo plus ADT, a hazard ratio of 0.54. With docetaxel, ARASENS showed an overall survival benefit, hazard ratio 0.68. I can walk you through the safety information, including the warnings for ischemic heart disease and seizure, so you can judge where it might fit.",
      figures: figures("aranote-rpfs", "arasens-os", "aramis-mfs"),
    },
    {
      id: "ddi", title: "Drug interactions", setting: "Patients on several medicines",
      hcpLine: "Most of my patients are on five or six other medications. I'm worried about drug interactions.",
      criteria: [
        ACKNOWLEDGE,
        { id: "trial_context", label: "Trial context", description: "Notes that concomitant medication use was common in the trials (93.5% to 100% of patients took at least one)." },
        { id: "specific_guidance", label: "Specific interaction guidance", description: "States the labeled guidance accurately: avoid combined P-gp and strong or moderate CYP3A4 inducers; monitor with combined P-gp and strong CYP3A4 inhibitors; BCRP and OATP1B1/1B3 substrates." },
        { id: "no_overclaim", label: "No overclaiming", description: "Does not say NUBEQA has no interactions or fewer interactions than other ARIs." },
      ],
      modelAnswer: "That's a real concern with this population. Which medications come up most for you? In the trials, nearly everyone was on other medicines: at least one concomitant medication in 93.5% of ARANOTE, 98.7% of ARAMIS and 100% of ARASENS patients. The label does list interactions to manage: avoid combined P-gp and strong or moderate CYP3A4 inducers, monitor more closely with combined P-gp and strong CYP3A4 inhibitors, and NUBEQA inhibits BCRP and OATP1B1 and 1B3, so some substrates may need a dose reduction. I can leave the interaction summary and the full safety information with you.",
      figures: figures("ddi-overview", "ddi-anticoagulants"),
    },
    {
      id: "tolerability", title: "Fatigue and tolerability", setting: "Older patients",
      hcpLine: "My older patients really struggle with fatigue on these drugs. I'm worried about tolerability.",
      criteria: [
        ACKNOWLEDGE,
        { id: "safety_data", label: "Accurate safety data", description: "Uses NUBEQA's own safety data accurately, such as severe fatigue 0.6% vs 1.1% in ARAMIS, or discontinuation rates by trial." },
        { id: "fair_balance", label: "Fair balance", description: "Mentions the warnings (ischemic heart disease, seizure, embryo-fetal toxicity) or the full Important Safety Information." },
        { id: "no_comparison", label: "No comparative claim", description: "Does not claim NUBEQA causes less fatigue or is better tolerated than other ARIs." },
      ],
      modelAnswer: "Fatigue matters a lot for older patients, so that's fair. Is it mostly in nmCRPC that you're seeing it? In ARAMIS, severe fatigue occurred in 0.6% of patients on NUBEQA plus ADT versus 1.1% on ADT alone, and about 95% were treated without a dose reduction. I do want to be balanced: NUBEQA carries warnings for ischemic heart disease, including fatal cases, and for seizure, and serious adverse reactions occurred in 25% versus 20% in ARAMIS. I can go through the full safety information with you.",
      figures: figures("aramis-fatigue", "aramis-ae", "aranote-discontinuation"),
    },
    {
      id: "aranote_os", title: "Where is the survival data?", setting: "mCSPC without docetaxel",
      hcpLine: "ARANOTE shows rPFS, sure. But where's the overall survival benefit without docetaxel?",
      criteria: [
        ACKNOWLEDGE,
        { id: "accurate_aranote", label: "Accurate on ARANOTE", description: "States that ARANOTE's primary endpoint was rPFS (HR 0.54) and does not claim an overall survival result for ARANOTE." },
        { id: "right_setting", label: "Right trial for each claim", description: "If citing survival, attributes it correctly: ARASENS (with docetaxel, HR 0.68) or ARAMIS (nmCRPC, HR 0.69), clearly in those settings." },
      ],
      modelAnswer: "That's a fair question. ARANOTE's primary endpoint was radiographic progression-free survival, where NUBEQA plus ADT reduced the risk of radiographic progression or death by 46% versus placebo plus ADT, a hazard ratio of 0.54, and I don't have an overall survival result from ARANOTE to share. Where NUBEQA has shown an overall survival benefit is in other settings: ARASENS, with docetaxel, hazard ratio 0.68, and ARAMIS in nmCRPC, hazard ratio 0.69. Would it help to look at the ARANOTE study design and patient population?",
      figures: figures("aranote-rpfs", "aranote-design", "aranote-demographics"),
    },
    {
      id: "docetaxel", title: "Why add to docetaxel?", setting: "mCSPC with docetaxel",
      hcpLine: "If a patient is fit enough for docetaxel, why would I add anything on top of it?",
      criteria: [
        ACKNOWLEDGE,
        { id: "arasens_os", label: "ARASENS survival data", description: "Presents ARASENS accurately: overall survival HR 0.68 versus docetaxel and ADT, and/or 63% vs 50% alive at 4 years (landmark)." },
        { id: "fair_balance", label: "Fair balance", description: "Acknowledges safety in this setting, such as serious adverse reactions 45% or discontinuation 14% vs 11%, or the warnings." },
      ],
      modelAnswer: "I understand, docetaxel plus ADT is already intensive. Which patients are you thinking about? In ARASENS, adding NUBEQA to docetaxel and ADT reduced the risk of death by nearly a third versus docetaxel and ADT alone, a hazard ratio of 0.68, and at four years 63% versus 50% were alive. To be balanced, serious adverse reactions occurred in 45% of patients on the NUBEQA combination, discontinuation due to adverse reactions was 14% versus 11%, and there are warnings for ischemic heart disease and seizure. Can I show you the survival curve?",
      figures: figures("arasens-os", "arasens-4yr", "arasens-ae"),
    },
    {
      id: "nmcrpc_wait", title: "Why not wait?", setting: "nmCRPC",
      hcpLine: "My nmCRPC patients feel fine. Why start treatment now instead of watching and waiting?",
      criteria: [
        ACKNOWLEDGE,
        { id: "aramis_data", label: "ARAMIS evidence", description: "Presents ARAMIS accurately: metastasis-free survival 40.4 vs 18.4 months (HR 0.41), and/or overall survival HR 0.69, and/or time to pain progression HR 0.65." },
        { id: "fair_balance", label: "Fair balance", description: "Mentions safety: warnings or the serious adverse reaction rates, or offers the full safety information." },
      ],
      modelAnswer: "That's an important conversation, especially when patients feel well. What PSA doubling times are you seeing? In ARAMIS, NUBEQA plus ADT extended median metastasis-free survival to 40.4 months versus 18.4 months with ADT alone, a hazard ratio of 0.41, and reduced the risk of death by 31%, a hazard ratio of 0.69. It also delayed time to pain progression, hazard ratio 0.65. Treatment does carry risks, including warnings for ischemic heart disease and seizure, and serious adverse reactions were 25% versus 20%, so I can share the full safety information too.",
      figures: figures("aramis-mfs", "aramis-os", "aramis-pain"),
    },
    {
      id: "dosing", title: "Twice-daily dosing", setting: "Any setting",
      hcpLine: "Twice a day with food is a hassle for a lot of my patients.",
      criteria: [
        ACKNOWLEDGE,
        { id: "accurate_dosing", label: "Accurate dosing", description: "States the regimen accurately: 600 mg (two 300 mg tablets) twice daily with food, with ADT; and/or the labeled dose reductions." },
        { id: "no_unsupported", label: "No unsupported claims", description: "Does not make adherence, convenience or comparative dosing claims that the approved facts do not support." },
      ],
      modelAnswer: "I hear that, pill burden matters. Which patients worry you most, and is it timing or remembering doses? NUBEQA is two 300 mg tablets twice a day with food, alongside ADT. If a dose is missed, patients take it as soon as they remember before the next one and never double up. The dose can be reduced to 300 mg twice daily for severe renal impairment, moderate hepatic impairment, or significant side effects. I can leave the dosing guide and the full safety information.",
      figures: figures("dosing-regimens"),
    },
  ],
};

export const TRAINER_PROGRAMS: Partial<Record<string, TrainerProgram>> = { nubeqa: NUBEQA_TRAINER };

export const objectionById = (program: TrainerProgram, id: string) => {
  const objection = program.objections.find(item => item.id === id);
  if (!objection) throw new Error(`Unknown objection ${id}.`);
  return objection;
};
