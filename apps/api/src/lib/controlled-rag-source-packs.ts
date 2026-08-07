export type ControlledRagChunk = {
  id: string;
  surveySlug: "brukinsa" | "padcev" | "nubeqa";
  title: string;
  url: string;
  description: string;
  tags: string[];
  text: string;
  assets?: Array<{
    title: string;
    url: string;
    description: string | null;
    assetKind: string;
    tags: string[];
    priority: number;
  }>;
};

export const CONTROLLED_RAG_CHUNKS = [
  {
    id: "brukinsa-cll-sequoia",
    surveySlug: "brukinsa",
    title: "BRUKINSA CLL/SLL Efficacy: SEQUOIA",
    url: "https://brukinsahcp.com/cll/efficacy/#first",
    description:
      "Curated CLL/SLL source card for SEQUOIA first-line efficacy context and source visuals.",
    tags: [
      "cll",
      "sll",
      "sequoia",
      "first line",
      "frontline",
      "pfs",
      "efficacy",
    ],
    text: "SEQUOIA is the BRUKINSA first-line CLL/SLL evidence anchor on the HCP site. It includes a treatment-naive CLL/SLL setting, Cohort 1 comparing BRUKINSA with bendamustine plus rituximab in patients without del(17p), and a separate del(17p) BRUKINSA-only cohort. The HCP source presents progression-free survival as a key efficacy focus and includes Kaplan-Meier visuals and patient-at-risk information for HCP review.",
  },
  {
    id: "brukinsa-cll-alpine",
    surveySlug: "brukinsa",
    title: "BRUKINSA CLL/SLL Efficacy: ALPINE",
    url: "https://brukinsahcp.com/cll/efficacy/#second",
    description:
      "Curated CLL/SLL source card for ALPINE relapsed/refractory head-to-head evidence.",
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
    text: "ALPINE is the BRUKINSA relapsed/refractory CLL/SLL head-to-head evidence anchor on the HCP site. The HCP source frames ALPINE as BRUKINSA versus ibrutinib after prior systemic therapy, with ORR and PFS information used to support HCP discussion of comparative evidence.",
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
    text: "BRUKINSA HCP dosing and safety resources cover real-world medication-management topics including tablet formulation, dosing schedule, dose reduction or modification, drug-interaction considerations, hepatic impairment, and Important Safety Information topics such as hemorrhage, infections, cytopenias, second primary malignancies, cardiac arrhythmias, hepatotoxicity, embryo-fetal toxicity, and common adverse reactions or lab abnormalities.",
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
    url: "https://www.padcevhcp.com/padcev-pembrolizumab-efficacy",
    description:
      "Curated source card for PADCEV plus pembrolizumab first-line efficacy context.",
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
    text: "EV-302/KEYNOTE-A39 is the PADCEV plus pembrolizumab first-line evidence anchor for locally advanced or metastatic urothelial cancer on the HCP site. The source includes survival, progression-free survival, and response-endpoint context or visuals when available, and should be used for exact current efficacy values, timepoints, and caveats.",
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
    text: "PADCEV safety-management HCP materials include adverse-reaction monitoring, dose interruption/reduction/discontinuation concepts, and practical resources such as monitoring checklists or adverse-reaction management materials when available. For neuropathy, rash or skin reactions, hyperglycemia, pneumonitis/ILD, ocular disorders, and other adverse events, use source-supported monitoring and dose-modification guidance rather than broad efficacy framing.",
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
    text: "The NUBEQA HCP dosing page describes 600 mg twice daily with food, continuing treatment until disease progression or unacceptable toxicity, and dose modification to 300 mg twice daily for severe renal impairment not receiving hemodialysis, moderate hepatic impairment, Grade 3 or greater toxicity, or intolerable adverse reaction when source-supported. The page also notes that in ARASENS NUBEQA continues even if a docetaxel cycle is delayed, interrupted, or discontinued. Important Safety Information includes ischemic heart disease and seizure warnings, plus adverse reaction context across ARAMIS, ARANOTE, and ARASENS. For drug interactions, the HCP page says combined P-gp plus strong or moderate CYP3A4 inducers can decrease darolutamide exposure and should be avoided; combined P-gp plus strong CYP3A4 inhibitors can increase darolutamide exposure, so patients should be monitored more frequently for adverse reactions and dose modified as needed. NUBEQA is also described as an inhibitor of BCRP, OATP1B1, and OATP1B3 transporters; concomitant use may increase substrate exposure, so BCRP substrates should be avoided when possible or monitored with possible substrate dose reduction, and OATP substrates should be monitored with possible dose reduction.",
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
