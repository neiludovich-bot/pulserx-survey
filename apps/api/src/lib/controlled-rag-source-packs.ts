export type ControlledRagChunk = {
  id: string;
  surveySlug: "brukinsa" | "padcev";
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
      "first line",
      "efficacy",
    ],
    text: "EV-302/KEYNOTE-A39 is the PADCEV plus pembrolizumab first-line evidence anchor for locally advanced or metastatic urothelial cancer on the HCP site. The source includes survival and progression-free survival visuals and should be used for exact current efficacy values, timepoints, and caveats.",
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
] satisfies ControlledRagChunk[];
