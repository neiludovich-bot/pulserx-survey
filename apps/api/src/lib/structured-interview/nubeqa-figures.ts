import type { EvidenceFigure } from "./types";

// Figures published on nubeqahcp.com (efficacy, safety, DDI and dosing pages), verified 2026-10-11.
const FILES = "https://www.nubeqahcp.com/sites/g/files/vrxlpx57896/files";

export type LibraryFigure = EvidenceFigure & {
  id: string;
  trial: "aranote" | "arasens" | "aramis" | null;
  /** Lower-case words that suggest this figure answers a question. */
  topics: string[];
};

const T = {
  efficacy: ["result", "efficacy", "data", "benefit", "curve", "kaplan", "hazard", "hr"],
  rpfs: ["rpfs", "radiographic", "progression-free", "progression free", "progression"],
  os: ["overall survival", "survival", "os", "death", "die", "alive", "mortality"],
  mfs: ["mfs", "metastasis-free", "metastasis free", "metastasis", "metastases"],
  design: ["design", "enrolled", "enrollment", "population", "patients were", "randomized", "randomised", "inclusion", "eligib", "trial design", "study design"],
  demographics: ["demographic", "baseline", "characteristic", "age", "gleason", "psa at", "volume"],
  safety: ["side effect", "adverse", "safety", "tolerab", "toxicity", "ae ", "aes", "grade 3", "fatigue", "rash", "hypertension"],
  discontinuation: ["discontinu", "stop", "dose reduction", "dose interruption", "reduce the dose", "interrupt"],
  duration: ["duration", "how long", "time on treatment", "stay on", "persistence"],
  crpc: ["crpc", "castration resist", "castration-resist", "time to mcrpc"],
  pain: ["pain"],
  chemo: ["chemo", "cytotoxic", "chemotherapy"],
  dosing: ["dose", "dosing", "tablet", "food", "twice", "bid", "how to take", "pill"],
  ddi: ["interaction", "ddi", "cyp", "p-gp", "pgp", "bcrp", "statin", "anticoag", "warfarin", "concomitant", "polypharmacy", "other medic"],
};

const f = (id: string, path: string, caption: string, alt: string, trial: LibraryFigure["trial"], topics: string[]): LibraryFigure =>
  ({ id, url: `${FILES}/${path}`, caption, alt, trial, topics });

export const NUBEQA_FIGURES: LibraryFigure[] = [
  // ARANOTE (mCSPC, no docetaxel)
  f("aranote-rpfs", "2026-08/mcspc-aranote-chart.svg", "Primary endpoint: radiographic progression-free survival", "ARANOTE rPFS curve, NUBEQA + ADT vs placebo + ADT", "aranote", [...T.efficacy, ...T.rpfs]),
  f("aranote-design", "2025-06/aranote-study-desig.svg", "Study design and endpoints", "ARANOTE study design and endpoints", "aranote", T.design),
  f("aranote-demographics", "2025-05/aranote-patient-demographics.svg", "Patient demographics", "ARANOTE patient demographics", "aranote", T.demographics),
  f("aranote-duration", "2025-06/treatment-duration-adt.svg", "Treatment duration", "ARANOTE treatment duration, NUBEQA + ADT vs placebo + ADT", "aranote", T.duration),
  f("aranote-ae", "2025-06/mcspc-all-grades-3-and-4-ar_0.svg", "Adverse reactions, all grades and grades 3–4", "ARANOTE adverse reactions, NUBEQA + ADT vs placebo + ADT", "aranote", T.safety),
  f("aranote-discontinuation", "2025-06/nubeqa-vs-placebo-ar.svg", "Permanent discontinuation due to adverse reactions", "ARANOTE discontinuation rates, 6% vs 9%", "aranote", T.discontinuation),
  // ARASENS (mCSPC, with docetaxel)
  f("arasens-os", "2026-08/mhspc-chart.svg", "Primary endpoint: overall survival", "ARASENS overall survival curve, NUBEQA + docetaxel + ADT vs docetaxel + ADT", "arasens", [...T.efficacy, ...T.os]),
  f("arasens-4yr", "2026-08/63-of-pateint.svg", "Alive at 4 years (landmark analysis)", "ARASENS: 63% vs 50% alive at 4 years", "arasens", T.os),
  f("arasens-crpc", "2025-06/mhspc-64-chart.svg", "Time to castration-resistant prostate cancer", "ARASENS time to mCRPC, NUBEQA + docetaxel + ADT vs docetaxel + ADT", "arasens", T.crpc),
  f("arasens-secondary", "2026-08/arasens-study-results.svg", "Secondary endpoint results", "ARASENS secondary endpoint results", "arasens", [...T.pain, ...T.crpc, "secondary"]),
  f("arasens-design", "2025-05/arasens-study-design.svg", "Study design and endpoints", "ARASENS study design and endpoints", "arasens", T.design),
  f("arasens-demographics", "2025-05/arasens_patient_demographics.svg", "Patient demographics", "ARASENS patient demographics", "arasens", T.demographics),
  f("arasens-ae", "2025-06/mcspc-grade-3-4.svg", "Adverse reactions, grades 3–4", "ARASENS grade 3–4 adverse reactions, NUBEQA + docetaxel vs placebo + docetaxel", "arasens", T.safety),
  f("arasens-discontinuation", "2025-06/nubeqa-docetaxel-placebo.svg", "Permanent discontinuation due to adverse reactions", "ARASENS discontinuation rates, 14% vs 11%", "arasens", T.discontinuation),
  // ARAMIS (nmCRPC)
  f("aramis-mfs", "2025-06/mfs-adt-alone.svg", "Primary endpoint: metastasis-free survival", "ARAMIS metastasis-free survival curve, NUBEQA + ADT vs ADT alone", "aramis", [...T.efficacy, ...T.mfs]),
  f("aramis-os", "2025-06/nubeqa-adt-survival.svg", "Overall survival", "ARAMIS overall survival curve, NUBEQA + ADT vs ADT alone", "aramis", T.os),
  f("aramis-pain", "2025-06/Nubeqa-adt-chart.svg", "Time to pain progression", "ARAMIS time to pain progression, NUBEQA + ADT vs ADT alone", "aramis", T.pain),
  f("aramis-chemo", "2025-05/percentage_of_patients.svg", "Patients not on cytotoxic chemotherapy at 3 years", "ARAMIS: 83% vs 75% not receiving chemotherapy at 3 years", "aramis", T.chemo),
  f("aramis-design", "2025-05/Placebo-controlled-study-nmcrpc.svg", "Study design", "ARAMIS double-blind, placebo-controlled study design", "aramis", T.design),
  f("aramis-demographics", "2025-05/aramis-patient-characteristics-new.svg", "Patient characteristics", "ARAMIS patient characteristics", "aramis", T.demographics),
  f("aramis-ae", "2025-06/nmcrpc-all-grades-chart.svg", "Adverse reactions, all grades", "ARAMIS adverse reactions, NUBEQA + ADT vs ADT alone", "aramis", T.safety),
  f("aramis-fatigue", "2025-05/no-incremental.svg", "Severe fatigue vs ADT alone", "ARAMIS: severe fatigue 0.6% vs 1.1%", "aramis", ["fatigue", "tired", ...T.safety]),
  // Dosing and interactions (all settings)
  f("dosing-regimens", "2025-05/nubeqa-docetaxel-dosage.svg", "Dosing with and without docetaxel", "NUBEQA dosing options with ADT, with and without docetaxel", null, [...T.dosing, "docetaxel"]),
  f("ddi-overview", "2025-11/drug-interactions-of-nubeqa_1.svg", "Drug interactions with concomitant use", "Drug interactions with concomitant use of NUBEQA", null, T.ddi),
  f("ddi-anticoagulants", "2025-11/nubeqa-anticoagulants-interaction.svg", "Interaction with anticoagulants", "NUBEQA and anticoagulants", null, ["anticoag", "warfarin", "blood thinner", "apixaban", "rivaroxaban", "factor xa"]),
];

export const figureById = (id: string) => {
  const figure = NUBEQA_FIGURES.find(item => item.id === id);
  if (!figure) throw new Error(`Unknown figure ${id}.`);
  return figure;
};

const TRIAL_WORDS: Record<NonNullable<LibraryFigure["trial"]>, string[]> = {
  aranote: ["aranote", "without docetaxel", "no docetaxel"],
  arasens: ["arasens", "with docetaxel", "triplet"],
  aramis: ["aramis", "nmcrpc", "non-metastatic", "nonmetastatic"],
};

/** Up to `limit` figures that match a question's trial and topic, best first. Topic must match. */
export function matchFigures(text: string, limit = 2, exclude: string[] = []): LibraryFigure[] {
  const q = ` ${text.toLowerCase()} `;
  // Short tags ("os", "hr", "bid") must match whole words, or "os" would match "dose".
  const has = (word: string) => word.trim().length <= 4
    ? new RegExp(`\\b${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q)
    : q.includes(word);
  const trials = (Object.keys(TRIAL_WORDS) as Array<keyof typeof TRIAL_WORDS>).filter(trial => TRIAL_WORDS[trial].some(has));
  return NUBEQA_FIGURES
    .filter(figure => !exclude.includes(figure.url))
    .map(figure => {
      // Specific topics ("castration resistance", "pain") outweigh generic words ("results", "data").
      const topic = figure.topics.filter(has).reduce((sum, word) => sum + (T.efficacy.includes(word) ? 0.5 : 2), 0);
      const trialFit = figure.trial === null ? 0.5 : trials.length === 0 ? 0.25 : trials.includes(figure.trial) ? 1 : -2;
      return { figure, score: topic > 0 ? topic + trialFit : 0 };
    })
    .filter(item => item.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.figure);
}
