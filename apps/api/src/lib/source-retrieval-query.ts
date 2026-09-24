import { Prisma } from "@prisma/client";

const SEARCH_STOP_WORDS = new Set("a an and are as at be can could do does for from how i in is it me my of on or please show tell that the their there these this to us was we were what when where which with would you your about any see seeing graphics graphic images image figures figure charts chart graphs graph display displayed showing visible missing cannot cant again approved available clinical current describe describes described discuss discusses discussed document documented evidence explain explains explained information known list lists listed material materials mention mentions mentioned note notes noted question regarding report reports reported source sources support supports supported".split(" "));

// Search vocabulary only, not clinical facts or an inferred answer. Shared by
// every bot so ordinary shorthand can find the website's spelled-out wording.
const SEARCH_ALIASES: Record<string, string> = {
  ddi: "drug interactions", ddis: "drug interactions",
  ae: "adverse events reactions", aes: "adverse events reactions",
  se: "side effects adverse reactions safety", ses: "side effects adverse reactions safety",
  pfs: "progression free survival", psf: "progression free survival", mpfs: "progression free survival", rpfs: "radiographic progression free survival",
  os: "overall survival", mfs: "metastasis free survival",
};

export function isBroadProductComparison(query: string) {
  return /\b(advantages?|differentiat\w*|compare|comparison|versus|vs)\b/i.test(query)
    && !/\b(pfs|rpfs|os|mfs|survival|safety|side effects?|adverse|dosing|dose|ddi|interactions?)\b/i.test(query);
}

export function sourceContentSearchTerms(query: string, surveySlug: string) {
  // Prefer a supplied expansion over its acronym. No clinical aliases or
  // facts are inferred here; the moderator supplies the resolved question.
  const expanded = query.replace(/\b[A-Z][A-Z0-9]{1,8}\s*\(([^)]+)\)/g, "$1").replace(/\([A-Z][A-Z0-9]{1,8}\)/g, "")
    .replace(/\bnon[ -]small[ -]cell lung cancer\b/gi, "NSCLC non small cell lung cancer")
    .replace(/\bside[ -]effects?\b/gi, "side effects adverse reactions safety");
  const terms = expanded.toLowerCase().replace(/\b(ae|ddi|se)['’]s\b/g, "$1s").split(/[^a-z0-9]+/).filter(
    (term) => term.length >= 2 && term !== surveySlug && !SEARCH_STOP_WORDS.has(term),
  );
  // Preserve a follow-up at the end of a mixed reaction + question message.
  return [...new Set([...terms.slice(-24).flatMap(term => (SEARCH_ALIASES[term] ?? term).split(" ")), ...(isBroadProductComparison(query) ? ["comparative", "efficacy", "safety", "head", "randomized"] : [])])];
}

/** Rank the approved content before applying the bounded candidate limit. */
export function sourceContentSearchSql(query: string, surveySlug: string, context?: string | null, websiteOnly = false, priorSourceIds: string[] = [], preferPriorSection = false) {
  const documentFilter = websiteOnly ? Prisma.sql`AND document.source_type <> 'PDF'` : Prisma.empty;
  // Named numbered trials must outrank shared indication words in page URLs.
  // Preserve the exact participant-supplied trial token; do not infer a trial.
  const studies = [...new Set(query.match(/\b[a-z]{2,}-[a-z]*\d{1,3}\b/gi) ?? [])].slice(0, 3);
  const studyPriority = studies.length
    ? Prisma.sql`(${Prisma.join(studies.map(study => Prisma.sql`chunk.content ILIKE ${`%${study}%`}`), " OR ")}) DESC,`
    : Prisma.empty;
  // A broad comparison should retrieve comparative findings before a footer
  // containing an abbreviation glossary or a generic head-to-head heading.
  const comparisonPriority = isBroadProductComparison(query)
    ? Prisma.sql`(to_tsvector('english', chunk.content) @@ websearch_to_tsquery('english', 'versus OR vs OR compared') AND chunk.content ~ '[0-9]') DESC,`
    : Prisma.empty;
  const terms = sourceContentSearchTerms(query, surveySlug);
  // A clinical section such as /nsclc/ or /gastric/ is stronger contextual
  // evidence than a biomarker shared by many compound indication URLs.
  // This only ranks the context pool; explicit new requests keep their order.
  const contextPathPriority = preferPriorSection && terms.length ? Prisma.sql`
    (string_to_array(lower(regexp_replace(split_part(document.url, '?', 1), '^https?://[^/]+', '')), '/')
      && ARRAY[${Prisma.join(terms)}]::text[]) DESC,` : Prisma.empty;
  // A UI-only follow-up should retain the cited pages, not search for words
  // like "graphics" across unrelated indications. Explicit clinical terms win.
  const priorPages = !terms.length ? priorSourceIds.flatMap(id => /^db:page:([^:]+):\d+:\d+$/.exec(id)?.[1] ?? []).slice(0, 3) : [];
  const priorChunks = !terms.length ? priorSourceIds.flatMap(id => /^db:([^:]+)$/.exec(id)?.[1] ?? []).slice(0, 3) : [];
  const anchors = [ ...(priorPages.length ? [Prisma.sql`document.id IN (${Prisma.join(priorPages)})`] : []), ...(priorChunks.length ? [Prisma.sql`chunk.id IN (${Prisma.join(priorChunks)})`] : []) ];
  const anchorPriority = anchors.length ? Prisma.sql`(${Prisma.join(anchors, " OR ")}) DESC,` : Prisma.empty;
  // In the separate context pool, neighboring pages in the cited website
  // section preserve the population even when another indication uses the
  // same biomarker or endpoint. Never apply this preference to fresh results.
  const sectionPages = preferPriorSection ? priorSourceIds.flatMap(id => /^db:page:([^:]+):\d+:\d+$/.exec(id)?.[1] ?? []).slice(0, 3) : [];
  const sectionChunks = preferPriorSection ? priorSourceIds.flatMap(id => /^db:([^:]+)$/.exec(id)?.[1] ?? []).slice(0, 3) : [];
  const sectionOwners = [...(sectionPages.length ? [Prisma.sql`prior.id IN (${Prisma.join(sectionPages)})`] : []),
    ...(sectionChunks.length ? [Prisma.sql`prior.id IN (SELECT source_document_id FROM source_chunks WHERE id IN (${Prisma.join(sectionChunks)}))`] : [])];
  const sectionPriority = sectionOwners.length ? Prisma.sql`EXISTS (
    SELECT 1 FROM source_documents prior
    WHERE prior.survey_slug = ${surveySlug} AND prior.status = 'ACTIVE' AND prior.source_type <> 'PDF'
      AND (${Prisma.join(sectionOwners, " OR ")})
      AND prior.url ~ '^https?://[^/]+/[^/]+/[^/]+/[^/?#]+'
      AND starts_with(document.url, regexp_replace(split_part(split_part(prior.url, '?', 1), '#', 1), '[^/]+/?$', ''))
  ) DESC,` : Prisma.empty;
  const normalized = query.toLowerCase().replace(/-/g, " ");
  const phrases = [...(isBroadProductComparison(query) ? ["head to head"] : []), ...new Set(Object.entries(SEARCH_ALIASES).filter(([alias, phrase]) => new RegExp(`\\b${alias}\\b`, "i").test(query) || normalized.includes(phrase)).flatMap(([, phrase]) => phrase === "side effects adverse reactions safety" ? ["side effects", "adverse reactions"] : phrase === "adverse events reactions" ? ["adverse events", "adverse reactions"] : phrase === "drug interactions" ? [phrase, "drug drug interactions"] : [phrase]))];
  const phrasePriority = phrases.length ? Prisma.sql`(to_tsvector('english', chunk.content) @@ websearch_to_tsquery('english', ${phrases.map(phrase => `"${phrase}"`).join(" OR ")})) DESC,` : Prisma.empty;
  const contextTerms = sourceContentSearchTerms(context ?? "", surveySlug).slice(0, 12);
  if (!terms.length && !contextTerms.length) return null;
  if (contextTerms.length) {
    return Prisma.sql`
      WITH search AS (
        SELECT websearch_to_tsquery('english', ${[...new Set([...terms, ...contextTerms])].join(" OR ")}) AS any_terms,
               websearch_to_tsquery('english', ${(terms.length ? terms : contextTerms).join(" OR ")}) AS current_terms,
               websearch_to_tsquery('english', ${contextTerms.join(" OR ")}) AS context_terms
      )
      SELECT chunk.id
      FROM source_chunks AS chunk
      JOIN source_documents AS document ON document.id = chunk.source_document_id
      CROSS JOIN search
      WHERE chunk.survey_slug = ${surveySlug}
        AND document.survey_slug = ${surveySlug}
        AND document.status = 'ACTIVE'
        ${documentFilter}
        AND to_tsvector('english', chunk.content) @@ search.any_terms
      ORDER BY ${anchorPriority} ${sectionPriority} ${contextPathPriority} ${studyPriority} (to_tsvector('english', chunk.content) @@ search.current_terms) DESC,
               ${websiteOnly ? Prisma.sql`ts_rank_cd(to_tsvector('english', regexp_replace(coalesce(document.url, ''), '[^a-zA-Z0-9]+', ' ', 'g')), search.current_terms) DESC,` : Prisma.empty}
               ${comparisonPriority} ${phrasePriority}
               ts_rank_cd(to_tsvector('english', chunk.content), search.current_terms) DESC,
               ts_rank_cd(to_tsvector('english', chunk.content), search.context_terms) DESC,
               document.priority DESC, chunk.position ASC, chunk.id ASC
      LIMIT 80
    `;
  }
  return Prisma.sql`
    WITH search AS (
      SELECT websearch_to_tsquery('english', ${terms.join(" OR ")}) AS any_terms,
             websearch_to_tsquery('english', ${terms.join(" ")}) AS all_terms
    )
    SELECT chunk.id
    FROM source_chunks AS chunk
    JOIN source_documents AS document ON document.id = chunk.source_document_id
    CROSS JOIN search
    WHERE chunk.survey_slug = ${surveySlug}
      AND document.survey_slug = ${surveySlug}
      AND document.status = 'ACTIVE'
      ${documentFilter}
      AND to_tsvector('english', chunk.content) @@ search.any_terms
    ORDER BY ${anchorPriority} ${sectionPriority} ${contextPathPriority} ${studyPriority} ${websiteOnly ? Prisma.sql`ts_rank_cd(to_tsvector('english', regexp_replace(coalesce(document.url, ''), '[^a-zA-Z0-9]+', ' ', 'g')), search.any_terms) DESC,` : Prisma.empty}
             ${comparisonPriority} ${phrasePriority} (to_tsvector('english', chunk.content) @@ search.all_terms) DESC,
             ts_rank_cd(to_tsvector('english', chunk.content), search.any_terms) DESC,
             document.priority DESC, chunk.position ASC, chunk.id ASC
    LIMIT 80
  `;
}
