export type ControlledRagChunk = {
  id: string;
  surveySlug: "brukinsa" | "padcev" | "nubeqa";
  title: string;
  url: string;
  description: string;
  tags: string[];
  text: string;
  evidenceRole?: "direct" | "contextual";
  assets?: Array<{
    title: string;
    url: string;
    description: string | null;
    assetKind: string;
    tags: string[];
    priority: number;
  }>;
};

// Verified 2026-09-05 against NUBEQA US PI section 6.1, Table 3 (ARANOTE):
// https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=1a7cb212-56e4-4b9d-a73d-bfee7fe4735e
export const NUBEQA_ARANOTE_UTI_FACTS = [
  "In ARANOTE, urinary tract infection occurred in 12% of patients receiving NUBEQA plus ADT versus 8% receiving placebo plus ADT across all grades.",
  "Grade 3 or 4 urinary tract infection occurred in 1.8% with NUBEQA plus ADT versus 0.5% with placebo plus ADT.",
  "These ARANOTE mCSPC safety results use N=445 for NUBEQA and N=221 for placebo; both groups received ADT, without docetaxel.",
];

// Verified 2026-09-05 against https://www.nubeqahcp.com/safety/ddi-profile
// and NUBEQA US PI sections 7.1 and 7.2. Keep interaction direction explicit.
export const NUBEQA_DDI_FACTS = [
  "Combined P-gp and strong or moderate CYP3A4 inducers decrease darolutamide exposure and should be avoided. Combined P-gp and strong CYP3A4 inhibitors increase darolutamide exposure; the label calls for more frequent monitoring for NUBEQA adverse reactions and dosage modification as needed.",
  "NUBEQA inhibits BCRP, OATP1B1, and OATP1B3 transporters and can increase exposure to their substrates. The label advises avoiding BCRP substrates where possible; if used together, monitor for adverse reactions and consider substrate dose reduction. OATP1B1/OATP1B3 substrates also warrant monitoring and possible dose reduction.",
  "These are interaction classes and label considerations, not a statement that every concomitant medicine interacts. Review the prescribing information of the specific concomitant medicine.",
];

export const CONTROLLED_RAG_CHUNKS = [
  {
    id: "brukinsa-cll-sequoia",
    surveySlug: "brukinsa",
    title: "BRUKINSA CLL/SLL Efficacy: SEQUOIA",
    url: "https://brukinsahcp.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=32",
    description:
      "US prescribing information section 14.4, Table 22: SEQUOIA randomized first-line CLL/SLL PFS analysis.",
    tags: [
      "cll",
      "sll",
      "sequoia",
      "first line",
      "frontline",
      "pfs",
      "efficacy",
    ],
    // Verified 2026-09-05: US PI section 14.4, Table 22; these are the PI analysis, not later HCP follow-up results.
    // https://brukinsahcp.com/wp-content/uploads/brukinsa-prescribing-information.pdf
    text: "The BRUKINSA US prescribing information, Table 22, reports SEQUOIA in previously untreated CLL/SLL without del(17p): BRUKINSA (N=241) versus bendamustine plus rituximab (N=238). Independent review committee-assessed progression-free survival (PFS) had a hazard ratio of 0.42 (95% CI 0.28-0.63; p<0.0001). Median PFS was not estimable with BRUKINSA versus 33.7 months with bendamustine plus rituximab. These PI analysis results apply to the randomized cohort; the separate del(17p) cohort was single-arm and does not provide this comparison.",
  },
  {
    id: "brukinsa-cll-alpine",
    surveySlug: "brukinsa",
    title: "BRUKINSA CLL/SLL Efficacy: ALPINE",
    url: "https://brukinsahcp.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=35",
    description:
      "US prescribing information section 14.4, Table 24: ALPINE independent-review PFS analysis in relapsed/refractory CLL/SLL.",
    tags: [
      "cll",
      "sll",
      "alpine",
      "ibrutinib",
      "head to head",
      "rr",
      "pfs",
      "orr",
    ],
    // Verified 2026-09-05: same US PI, section 14.4, Table 24 (IRC analysis).
    text: "The BRUKINSA US prescribing information, Table 24, reports ALPINE in relapsed or refractory CLL/SLL: BRUKINSA (N=327) versus ibrutinib (N=325). Independent review committee-assessed progression-free survival (PFS) had a hazard ratio of 0.65 (95% CI 0.49-0.86; two-sided p=0.0024). Median PFS was not estimable with BRUKINSA versus 35 months with ibrutinib. These are the PI analysis results, distinct from later follow-up analyses on the HCP page.",
  },
  {
    id: "brukinsa-cll-guidelines",
    surveySlug: "brukinsa",
    title: "BRUKINSA for CLL/SLL: Guideline Positioning",
    url: "https://brukinsahcp.com/cll/",
    description:
      "Curated CLL/SLL source card for guideline/NCCN positioning discussion.",
    tags: [
      "cll",
      "sll",
      "guideline",
      "guidelines",
      "nccn",
      "preferred",
      "category",
    ],
    text: "The BRUKINSA CLL/SLL HCP material includes guideline-positioning context for HCPs. Use the live source for exact current NCCN wording, categories, and version caveats; do not infer details that are not present in the approved HCP source.",
  },
  {
    id: "brukinsa-safety-management",
    surveySlug: "brukinsa",
    title: "BRUKINSA Safety, Dosing, and Medication Management",
    url: "https://brukinsahcp.com/dosing/",
    description:
      "Curated source card for BRUKINSA safety, dosing, dose modification, and medication-management questions.",
    tags: [
      "safety",
      "tolerability",
      "dosing",
      "dose",
      "dose modification",
      "tablet",
      "cyp3a",
      "drug interaction",
      "bleeding",
      "hemorrhage",
      "cardiac",
      "infection",
    ],
    // Verified 2026-09-05: Important Safety Information at https://brukinsahcp.com/cll/efficacy/.
    text: "BRUKINSA Important Safety Information covers hemorrhage, infections, cytopenias, second primary malignancies, cardiac arrhythmias, hepatotoxicity, and embryo-fetal toxicity. Practical guidance includes checking for bleeding or infection symptoms and monitoring complete blood counts during treatment. Arrhythmia symptoms to monitor include palpitations, dizziness, syncope, dyspnea, and chest discomfort. Assess bilirubin and transaminases before and during treatment; abnormal liver tests warrant more frequent monitoring. Withhold BRUKINSA for suspected drug-induced liver injury and discontinue if confirmed. These are general treatment precautions; they do not establish which individual adverse reactions result from a specific drug interaction.",
  },
  {
    // Verified 2026-09-05 against the manufacturer's US PI, section 7.1,
    // Table 17, PDF page 23. Keep interaction effects separate from general warnings.
    id: "brukinsa-ddi-profile",
    surveySlug: "brukinsa",
    title: "BRUKINSA Prescribing Information: Drug Interactions",
    url: "https://brukinsa.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=23",
    description: "US prescribing information section 7.1, Table 17: effects of other medicines on zanubrutinib and labeled management.",
    tags: ["brukinsa", "zanubrutinib", "drug interactions", "ddi", "cyp3a", "inhibitors", "inducers"],
    text: "The BRUKINSA US prescribing information, section 7.1, describes effects of other drugs on zanubrutinib. Moderate or strong CYP3A inhibitors increase zanubrutinib exposure (Cmax and AUC), which may increase BRUKINSA toxicity risk; the label calls for reducing the BRUKINSA dose during coadministration. Moderate or strong CYP3A inducers lower zanubrutinib exposure (Cmax and AUC), potentially reducing BRUKINSA efficacy. The label advises avoiding strong and moderate CYP3A inducers. If a moderate inducer cannot be avoided, it specifies an increased BRUKINSA dose; consult section 2.3 for the applicable dosing instructions. Table 17 provides these interaction effects and management instructions, without incidence rates for individual adverse reactions attributable to these combinations.",
    assets: [{
      title: "BRUKINSA US PI: Drug Interactions, Table 17",
      url: "https://brukinsa.com/wp-content/uploads/brukinsa-prescribing-information.pdf#page=23",
      description: "Official prescribing information section 7.1 on CYP3A inhibitors and inducers.",
      assetKind: "LINK",
      tags: ["drug interactions", "cyp3a", "inhibitors", "inducers"],
      priority: 90,
    }],
  },
  {
    id: "brukinsa-resources",
    surveySlug: "brukinsa",
    title: "BRUKINSA Resources and myBeOne Support",
    url: "https://brukinsahcp.com/resources/",
    description:
      "Curated source card for BRUKINSA support, patient education, patient management, and access resources.",
    tags: [
      "resources",
      "support",
      "mybeone",
      "patient management",
      "brochure",
      "guide",
      "access",
      "representative",
    ],
    text: "BRUKINSA HCP resources include patient education and support materials, dosing and administration resources, patient-management materials, brochures, enrollment or access support references, and contact-a-representative pathways. Use source detail for exact resource names and caveats such as support not guaranteeing coverage or reimbursement.",
  },
  {
    id: "padcev-ev302",
    surveySlug: "padcev",
    title: "PADCEV + Pembrolizumab Efficacy: EV-302/KEYNOTE-A39",
    url: "https://astellas.us/docs/PADCEV_label.pdf#page=42",
    description:
      "US prescribing information section 14.1, Table 22: EV-302 PADCEV plus intravenous pembrolizumab PFS results.",
    tags: [
      "ev302",
      "ev-302",
      "keynote",
      "keynote-a39",
      "pfs",
      "os",
      "orr",
      "response rate",
      "complete response",
      "cr",
      "first line",
      "efficacy",
    ],
    // Verified 2026-09-05: https://astellas.us/docs/PADCEV_label.pdf, section 14.1, Table 22.
    text: "In the PADCEV US prescribing information, EV-302/KEYNOTE-A39 enrolled previously untreated locally advanced or metastatic urothelial cancer. PADCEV plus intravenous pembrolizumab (N=442) was compared with gemcitabine plus cisplatin or carboplatin (N=444). Blinded independent central review-assessed median progression-free survival (PFS) was 12.5 versus 6.3 months; hazard ratio 0.45 (95% CI 0.38-0.54; p<0.0001). These are combination-regimen results, not PADCEV monotherapy results.",
  },
  {
    // Verified 2026-09-05: PADCEV US PI section 7.1 (July 2026 revision).
    id: "padcev-ddi-profile",
    surveySlug: "padcev",
    title: "PADCEV Prescribing Information: Drug Interactions",
    url: "https://astellas.us/docs/PADCEV_label.pdf#page=28",
    description: "US prescribing information section 7.1: dual P-gp and strong CYP3A4 inhibitors, MMAE exposure, and toxicity monitoring.",
    tags: ["padcev", "enfortumab vedotin", "drug interactions", "ddi", "p-gp", "cyp3a4", "inhibitors", "mmae"],
    text: "The PADCEV US prescribing information, section 7.1, states that dual P-gp and strong CYP3A4 inhibitors may increase exposure to unconjugated monomethyl auristatin E (MMAE), potentially increasing PADCEV toxicity incidence or severity. It calls for close monitoring for toxicity signs during coadministration. This interaction section does not identify a specific interaction-attributable adverse reaction or monitoring schedule.",
    assets: [{
      title: "PADCEV US PI: Drug Interactions, section 7.1",
      url: "https://astellas.us/docs/PADCEV_label.pdf#page=28",
      description: "Official prescribing information on dual P-gp and strong CYP3A4 inhibitors.",
      assetKind: "LINK",
      tags: ["drug interactions", "cyp3a4", "p-gp", "mmae"],
      priority: 90,
    }],
  },
  {
    id: "padcev-safety-management",
    surveySlug: "padcev",
    title: "PADCEV Safety and Adverse Reaction Management",
    url: "https://www.padcevhcp.com/monotherapy-safety",
    description:
      "Curated source card for PADCEV safety, dose modification, neuropathy, rash, and monitoring resources.",
    tags: [
      "safety",
      "side effects",
      "adverse",
      "neuropathy",
      "rash",
      "skin",
      "monitoring",
      "dose modification",
      "dose reduction",
      "discontinuation",
      "guide",
      "checklist",
    ],
    // Verified 2026-09-05: https://astellas.us/docs/PADCEV_label.pdf, sections 5.1-5.5.
    text: "PADCEV prescribing information calls for close skin-reaction monitoring throughout treatment and blood-glucose monitoring in patients with or at risk for diabetes or hyperglycemia. Monitor new or worsening peripheral neuropathy, ocular disorders, and pneumonitis/ILD symptoms such as cough, dyspnea, or hypoxia. Management may require treatment interruption, dose reduction, or discontinuation according to the specific reaction and grade. These general warnings do not establish which adverse reactions are caused by a particular interacting medicine.",
  },
  {
    id: "padcev-resources",
    surveySlug: "padcev",
    title: "PADCEV Support Solutions and Resource Materials",
    url: "https://www.padcevhcp.com/support-solutions",
    description:
      "Curated source card for PADCEV support resources, downloadable guides, and operational materials.",
    tags: [
      "resources",
      "support",
      "guide",
      "pdf",
      "download",
      "patient education",
      "counseling",
    ],
    text: "PADCEV support resources can include access and reimbursement support, patient education, downloadable resource materials, dosing/administration materials, and adverse-reaction management resources. Use the live source for exact PDF titles and download URLs.",
  },
  {
    id: "nubeqa-mcspc-aranote",
    surveySlug: "nubeqa",
    title: "NUBEQA mCSPC Efficacy: ARANOTE",
    url: "https://www.nubeqahcp.com/efficacy/mcspc",
    description:
      "Curated source card for ARANOTE NUBEQA plus ADT in mCSPC, with rPFS visuals.",
    tags: [
      "nubeqa",
      "darolutamide",
      "mcspc",
      "mhspc",
      "aranote",
      "adt",
      "without docetaxel",
      "rpfs",
      "radiographic progression-free survival",
      "efficacy",
    ],
    text: "The NUBEQA mCSPC HCP efficacy page presents ARANOTE as NUBEQA plus ADT versus placebo plus ADT in mCSPC. The page frames rPFS as the primary endpoint and states that median follow-up was 25.3 months for NUBEQA plus ADT and 25.0 months for placebo plus ADT. At 24 months, 70.3% of patients receiving NUBEQA plus ADT versus 52.1% receiving placebo plus ADT remained free of radiological progression and were alive. Use the source page for exact current curves, caveats, and references.",
    assets: [
      {
        title: "ARANOTE rPFS chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mcspc-aranote-chart.svg",
        description:
          "Graph showing risk of progression or death with NUBEQA plus ADT versus ADT alone in ARANOTE.",
        assetKind: "CHART",
        tags: ["aranote", "mcspc", "rpfs", "progression", "adt"],
        priority: 100,
      },
      {
        title: "ARANOTE study design and endpoints",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/aranote-study-desig.svg",
        description: "ARANOTE study design and endpoints visual.",
        assetKind: "CHART",
        tags: ["aranote", "study design", "endpoint", "mcspc"],
        priority: 88,
      },
      {
        title: "ARANOTE treatment duration",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/treatment-duration-adt.svg",
        description:
          "Treatment duration visual for NUBEQA plus ADT compared with ADT alone in ARANOTE.",
        assetKind: "CHART",
        tags: ["aranote", "treatment duration", "adt", "mcspc"],
        priority: 72,
      },
    ],
  },
  {
    id: "nubeqa-mcspc-arasens",
    surveySlug: "nubeqa",
    title: "NUBEQA mCSPC Efficacy: ARASENS",
    url: "https://www.nubeqahcp.com/efficacy/mcspc",
    description:
      "Curated source card for ARASENS NUBEQA plus ADT plus docetaxel in mCSPC.",
    tags: [
      "nubeqa",
      "darolutamide",
      "mcspc",
      "mhspc",
      "arasens",
      "docetaxel",
      "adt",
      "triplet",
      "overall survival",
      "os",
      "time to mcrpc",
      "efficacy",
    ],
    text: "The NUBEQA mCSPC HCP efficacy page presents ARASENS as NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel. The page states that NUBEQA in combination with docetaxel significantly reduced the risk of death by nearly a third versus docetaxel and ADT alone, and separately describes time to mCRPC and other secondary endpoints. Use the source page for exact current Kaplan-Meier visuals, landmark analysis caveats, and endpoint hierarchy.",
    assets: [
      {
        title: "ARASENS overall survival chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mhspc-chart.svg",
        description:
          "Graph of risk of death with NUBEQA plus docetaxel and ADT versus docetaxel and ADT alone in ARASENS.",
        assetKind: "CHART",
        tags: ["arasens", "overall survival", "os", "docetaxel", "mcspc"],
        priority: 100,
      },
      {
        title: "ARASENS secondary endpoint results",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-05/arasens-study-results.svg",
        description: "Secondary endpoint results visual from ARASENS.",
        assetKind: "CHART",
        tags: ["arasens", "secondary endpoints", "mcspc"],
        priority: 86,
      },
      {
        title: "ARASENS time to mCRPC chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mhspc-64-chart.svg",
        description:
          "Graph showing risk reduction in time to CRPC with NUBEQA plus docetaxel and ADT versus docetaxel and ADT alone.",
        assetKind: "CHART",
        tags: ["arasens", "time to mcrpc", "secondary endpoint", "mcspc"],
        priority: 82,
      },
      {
        title: "ARASENS study design and endpoints",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-05/arasens-study-design.svg",
        description: "ARASENS study design and endpoints visual.",
        assetKind: "CHART",
        tags: ["arasens", "study design", "docetaxel", "mcspc"],
        priority: 78,
      },
    ],
  },
  {
    id: "nubeqa-nmcrpc-aramis",
    surveySlug: "nubeqa",
    title: "NUBEQA nmCRPC Efficacy: ARAMIS",
    url: "https://www.nubeqahcp.com/efficacy/nmcrpc",
    description:
      "Curated source card for ARAMIS NUBEQA plus ADT in nmCRPC, with MFS and OS visuals.",
    tags: [
      "nubeqa",
      "darolutamide",
      "nmcrpc",
      "aramis",
      "adt",
      "metastasis-free survival",
      "mfs",
      "overall survival",
      "os",
      "psadt",
      "efficacy",
    ],
    text: "The NUBEQA nmCRPC HCP efficacy page presents ARAMIS as NUBEQA plus ADT versus ADT/placebo alone. It states that NUBEQA significantly improved metastasis-free survival and overall survival in nmCRPC, describes MFS as the primary endpoint, and notes consistent MFS results across subgroups such as PSADT and prior bone-targeting agent use. Use the source page for exact current Kaplan-Meier visuals, secondary endpoint details, and caveats.",
    assets: [
      {
        title: "ARAMIS metastasis-free survival chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mfs-adt-alone.svg",
        description:
          "Graph showing probability of MFS with NUBEQA plus ADT versus ADT alone in ARAMIS.",
        assetKind: "CHART",
        tags: ["aramis", "mfs", "metastasis-free survival", "nmcrpc"],
        priority: 100,
      },
      {
        title: "ARAMIS overall survival chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/nubeqa-adt-survival.svg",
        description:
          "Graph showing risk of death with NUBEQA plus ADT versus ADT alone in ARAMIS.",
        assetKind: "CHART",
        tags: ["aramis", "overall survival", "os", "nmcrpc"],
        priority: 94,
      },
      {
        title: "ARAMIS study design",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-05/Placebo-controlled-study-nmcrpc.svg",
        description:
          "Double-blind, placebo-controlled ARAMIS study in patients with nmCRPC.",
        assetKind: "CHART",
        tags: ["aramis", "study design", "nmcrpc"],
        priority: 78,
      },
    ],
  },
  {
    id: "nubeqa-safety-dosing",
    surveySlug: "nubeqa",
    title: "NUBEQA Safety, Dosing, and DDI Profile",
    url: "https://www.nubeqahcp.com/dosing",
    description:
      "Curated source card for NUBEQA dosing, dose modification, safety, and drug-interaction discussion.",
    tags: [
      "nubeqa",
      "darolutamide",
      "safety",
      "dosing",
      "dose",
      "600 mg twice daily",
      "food",
      "dose modification",
      "renal",
      "hepatic",
      "ddi",
      "drug interaction",
      "ischemic heart disease",
      "seizure",
    ],
    // Verified 2026-09-05 against the cited HCP dosing page and its Important Safety Information.
    // Keep practical general warnings separate from the dedicated interaction source.
    text: "The NUBEQA HCP dosing page gives 600 mg twice daily with food. Severe renal impairment (eGFR 15-29 mL/min/1.73 m2, without hemodialysis) or moderate hepatic impairment (Child-Pugh B) calls for 300 mg twice daily. For Grade 3 or greater toxicity or an intolerable adverse reaction, withhold treatment or reduce to 300 mg twice daily until symptoms improve; 600 mg twice daily may resume when the reaction returns to baseline. General safety guidance includes monitoring ischemic heart disease symptoms and managing cardiovascular risk factors, including hypertension, diabetes, and dyslipidemia; discontinue NUBEQA for Grade 3-4 ischemic heart disease. Counsel patients about seizure risk and activities where loss of consciousness could cause harm; consider discontinuation if a seizure develops during treatment. These are general NUBEQA warnings, not evidence that a particular interacting medicine causes ischemic heart disease or seizure.",
    assets: [
      {
        title: "NUBEQA mCSPC dosing options",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-05/nubeqa-docetaxel-dosage.svg",
        description:
          "Graphic showing NUBEQA plus ADT twice daily with or without docetaxel for mCSPC.",
        assetKind: "CHART",
        tags: ["dosing", "mcspc", "docetaxel", "adt"],
        priority: 92,
      },
      {
        title: "NUBEQA mCSPC ARANOTE adverse reaction chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mcspc-all-grades-3-and-4-ar_0.svg",
        description:
          "Comparison of adverse reactions in ARANOTE for NUBEQA plus ADT versus placebo plus ADT.",
        assetKind: "CHART",
        tags: ["safety", "aranote", "adverse reactions", "mcspc"],
        priority: 86,
      },
      {
        title: "NUBEQA ARASENS Grade 3-4 adverse reaction chart",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/mcspc-grade-3-4.svg",
        description:
          "Comparison of Grade 3-4 adverse reactions in ARASENS for NUBEQA plus docetaxel versus placebo plus docetaxel.",
        assetKind: "CHART",
        tags: ["safety", "arasens", "adverse reactions", "docetaxel"],
        priority: 82,
      },
    ],
  },
  {
    id: "nubeqa-aranote-uti",
    surveySlug: "nubeqa",
    title: "NUBEQA ARANOTE Urinary Tract Infection Rates",
    url: "https://www.nubeqahcp.com/safety/mcspc",
    description: "ARANOTE urinary tract infection adverse reactions by treatment arm and severity, matching the HCP chart and US PI Table 3.",
    tags: ["nubeqa", "darolutamide", "aranote", "mcspc", "safety", "urinary tract infection", "uti", "all grades", "grade 3 or 4", "adverse reactions"],
    text: NUBEQA_ARANOTE_UTI_FACTS.join(" "),
    assets: [{
      title: "ARANOTE urinary tract infection: all grades and Grades 3-4",
      url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57896/files/2025-06/mcspc-all-grades-3-and-4-ar_0.svg",
      description: "ARANOTE urinary tract infection: NUBEQA plus ADT vs placebo plus ADT, 12% vs 8% all grades and 1.8% vs 0.5% Grade 3 or 4 (N=445 vs N=221).",
      assetKind: "CHART",
      tags: ["safety", "aranote", "urinary tract infection", "uti", "adverse reactions", "mcspc"],
      priority: 100,
    }],
  },
  {
    id: "nubeqa-ddi-profile",
    surveySlug: "nubeqa",
    title: "NUBEQA Drug-Drug Interaction (DDI) Profile",
    url: "https://www.nubeqahcp.com/safety/ddi-profile",
    description: "Dedicated NUBEQA drug interaction classes and mechanisms, separate from adverse-reaction incidence and dosing charts.",
    tags: ["nubeqa", "darolutamide", "ddi", "drug interactions", "drug interaction", "cyp3a4", "p-gp", "bcrp", "oatp1b1", "oatp1b3", "inducers", "inhibitors", "substrates"],
    text: NUBEQA_DDI_FACTS.join(" "),
    assets: [{
      title: "Drug interactions of NUBEQA",
      url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57896/files/2025-11/drug-interactions-of-nubeqa_1.svg",
      description: "Drug interaction classes: effects of concomitant medicines on NUBEQA and effects of NUBEQA on BCRP and OATP transporter substrates.",
      assetKind: "CHART",
      tags: ["ddi", "drug interactions", "cyp3a4", "p-gp", "bcrp", "oatp1b1", "oatp1b3"],
      priority: 100,
    }],
  },
  {
    id: "nubeqa-guidelines-resources",
    surveySlug: "nubeqa",
    title: "NUBEQA Guidelines, Access, and Practice Resources",
    url: "https://www.nubeqahcp.com/about-nubeqa/guidelines",
    description:
      "Curated source card for NUBEQA guideline positioning and practice-resource discussion.",
    tags: [
      "nubeqa",
      "darolutamide",
      "guidelines",
      "nccn",
      "aua",
      "access",
      "support",
      "resources",
      "practice",
      "formulary",
    ],
    text: "The NUBEQA HCP guidelines page presents treatment-guideline context for mCSPC and nmCRPC and explains category/preferred-option terminology from guideline bodies such as NCCN and AUA when source-supported. The HCP site also includes access and support areas, formulary coverage, Access Services by Bayer, contact-a-representative pathways, Bayer Den, KOL videos, practice resources, patient resources, and patient profiles. Use source pages for exact current wording and resource names.",
    assets: [
      {
        title: "NUBEQA treatment guideline visual",
        url: "https://www.nubeqahcp.com/sites/g/files/vrxlpx57696/files/2025-06/guideline-treatment.png",
        description: "Treatment guidelines for mCSPC and nmCRPC.",
        assetKind: "CHART",
        tags: ["guidelines", "nccn", "aua", "mcspc", "nmcrpc"],
        priority: 96,
      },
      {
        title: "NUBEQA practice resources",
        url: "https://www.nubeqahcp.com/resources/for-your-practice",
        description: "NUBEQA HCP practice resources page.",
        assetKind: "LINK",
        tags: ["resources", "practice", "support"],
        priority: 58,
      },
      {
        title: "Access Services by Bayer",
        url: "https://www.nubeqahcp.com/access-and-support/access-services-by-bayer",
        description: "NUBEQA access support resource page.",
        assetKind: "LINK",
        tags: ["access", "support", "coverage"],
        priority: 56,
      },
    ],
  },
] satisfies ControlledRagChunk[];
