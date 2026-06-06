import {
  type MvpCustomGptSourcePreviewRequest,
  type MvpCustomGptSourcePreviewResponse,
  mvpCustomGptSourcePreviewResponseSchema,
} from "@interview/schemas";

const SOURCE_PREVIEW_TIMEOUT_MS = 8_000;
const SOURCE_PREVIEW_MAX_HTML_CHARS = 600_000;
const sourcePreviewCache = new Map<string, MvpCustomGptSourcePreviewResponse>();

type ImageCandidate = {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  source: "open_graph" | "twitter" | "html_image";
  context: string;
  score: number;
};

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  const [first, second] = octets;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 0
  );
}

function assertPreviewUrlAllowed(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS source URLs can be previewed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Local or private network source URLs cannot be previewed.");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function getAttribute(tag: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;

  return value ? decodeHtmlEntities(value) : null;
}

function absoluteUrl(value: string | null, baseUrl: string) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseNumberAttribute(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractMetaContent(html: string, key: string) {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const tag = match[0];
    const property = getAttribute(tag, "property") ?? getAttribute(tag, "name");
    if (property?.toLowerCase() === key.toLowerCase()) {
      return getAttribute(tag, "content");
    }
  }

  return null;
}

function parseSrcSet(value: string | null) {
  if (!value) {
    return null;
  }

  const candidates = value
    .split(",")
    .map((item, index) => {
      const [url, descriptor] = item.trim().split(/\s+/);
      const width = descriptor?.match(/^(\d+)w$/i)?.[1];
      const density = descriptor?.match(/^(\d+(?:\.\d+)?)x$/i)?.[1];

      return {
        url,
        index,
        score: width
          ? Number.parseInt(width, 10)
          : density
            ? Number.parseFloat(density) * 1_000
            : index,
      };
    })
    .filter(
      (candidate): candidate is { url: string; index: number; score: number } =>
        Boolean(candidate.url) && Number.isFinite(candidate.score),
    );

  return (
    candidates.sort(
      (left, right) => right.score - left.score || right.index - left.index,
    )[0]?.url ?? null
  );
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function getContextAround(html: string, start: number, end: number) {
  const contextStart = Math.max(0, start - 1_200);
  const contextEnd = Math.min(html.length, end + 1_200);

  return stripHtml(html.slice(contextStart, contextEnd));
}

function imageLooksUseful(candidate: ImageCandidate) {
  const directHaystack = `${candidate.url} ${candidate.alt ?? ""}`.toLowerCase();
  const haystack = `${directHaystack} ${candidate.context}`.toLowerCase();
  const directClinicalOrDocumentSignal =
    /\b(?:sequoia|alpine|aspen|pfs|progression-free|progression free|km curve|kaplan|curve|chart|graph|table|forest plot|hazard ratio|95% ci|cohort|study design|trial design|patient management guide|dosing and administration guide|brochure|form|enrollment|specialty pharmacies|distributors)\b/.test(
      directHaystack,
    );
  const contextualClinicalOrDocumentSignal =
    /\b(?:km curve|kaplan|chart|graph|table|figure|forest plot|hazard ratio|95% ci|cohort\s+\d|study design|trial design|patient management guide|dosing and administration guide|brochure|form|enrollment|specialty pharmacies|distributors)\b/.test(
      haystack,
    );
  const marketingOnlySignal =
    /\b(?:hero|lifestyle|brand|campaign|atmosphere|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/.test(
      directHaystack,
    );
  const productShotSignal =
    /\b(?:tablet1|tablet|tablets|pill|pills|capsule|capsules|bottle|packshot|product shot|dosing options)\b/.test(
      directHaystack,
    );
  const promotionalGraphicSignal =
    /\b(?:stays on|stays off|btk stays|up to 100|100%|potency|inhibition|selective|selectivity|off-target|off target|on-target|on target)\b/.test(
      directHaystack,
    );

  if (
    /\b(?:favicon|sprite|icon|logo|pixel|tracking|loader|spinner|swipe-to-scroll|subtab|popup|footer-logo)\b/.test(
      haystack,
    )
  ) {
    return false;
  }

  if (/\.(?:svg)(?:[?#].*)?$/i.test(candidate.url)) {
    return false;
  }

  if (productShotSignal) {
    return false;
  }

  if (promotionalGraphicSignal && !directClinicalOrDocumentSignal) {
    return false;
  }

  if (marketingOnlySignal && !directClinicalOrDocumentSignal) {
    return false;
  }

  return directClinicalOrDocumentSignal || contextualClinicalOrDocumentSignal;
}

function scoreImage(
  candidate: ImageCandidate,
  pageTitle: string | null,
  sourceUrl: string,
) {
  const parsedUrl = new URL(sourceUrl);
  const hash = parsedUrl.hash.toLowerCase();
  const directHaystack = `${candidate.url} ${candidate.alt ?? ""}`.toLowerCase();
  const haystack =
    `${directHaystack} ${candidate.context} ${pageTitle ?? ""}`.toLowerCase();
  let score = candidate.score;

  if (/\b(?:sequoia|alpine|aspen)\b/.test(haystack)) {
    score += 70;
  }

  if (/\b(?:pfs|progression-free|progression free|km curve|kaplan|curve|chart|graph)\b/.test(haystack)) {
    score += 55;
  }

  if (/\b(?:efficacy|study|trial|data|cohort|relative risk|hazard ratio|hr=|95% ci)\b/.test(haystack)) {
    score += 35;
  }

  if (/\b(?:1l|first line|cll|sll)\b/.test(haystack)) {
    score += 25;
  }

  if (/\b(?:guide|brochure|form|enrollment|specialty pharmacies|distributors)\b/.test(haystack)) {
    score += 18;
  }

  if (/\b(?:brukinsa|zanubrutinib)\b/.test(haystack)) {
    score += 12;
  }

  if (hash === "#first" && /\b(?:sequoia|1l|first line|cohort 1|cohort 2)\b/.test(haystack)) {
    score += 30;
  }

  if (/\/wp-content\/uploads\//i.test(candidate.url)) {
    score += 12;
  }

  if (/\b(?:tablet|support|dosing|video|resource|patient|footer|header)\b/.test(haystack)) {
    score -= 35;
  }

  if (/\b(?:hero|lifestyle|brand|campaign|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/.test(haystack)) {
    score -= 90;
  }

  if (/\b(?:hero|lifestyle|brand|campaign|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/.test(directHaystack)) {
    score -= 90;
  }

  if (/\b(?:tablet1|pill|pills|capsule|capsules|bottle|packshot|product shot|dosing options)\b/.test(directHaystack)) {
    score -= 85;
  }

  if (candidate.width && candidate.height) {
    if (candidate.width >= 240 && candidate.height >= 120) {
      score += 8;
    }
    if (candidate.width < 80 || candidate.height < 80) {
      score -= 40;
    }
  }

  return score;
}

function uniqueTopImages(
  candidates: ImageCandidate[],
  title: string | null,
  sourceUrl: string,
) {
  const seen = new Set<string>();

  return candidates
    .filter((candidate) => imageLooksUseful(candidate))
    .map((candidate) => ({
      ...candidate,
      score: scoreImage(candidate, title, sourceUrl),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 6)
    .map(({ score: _score, context: _context, ...candidate }) => candidate);
}

function extractImageCandidates(html: string, sourceUrl: string, title: string | null) {
  const candidates: ImageCandidate[] = [];
  const ogImage = absoluteUrl(extractMetaContent(html, "og:image"), sourceUrl);
  const twitterImage = absoluteUrl(
    extractMetaContent(html, "twitter:image"),
    sourceUrl,
  );

  if (ogImage) {
    candidates.push({
      url: ogImage,
      alt: title,
      width: null,
      height: null,
      source: "open_graph",
      context: title ?? "",
      score: 18,
    });
  }

  if (twitterImage) {
    candidates.push({
      url: twitterImage,
      alt: title,
      width: null,
      height: null,
      source: "twitter",
      context: title ?? "",
      score: 16,
    });
  }

  for (const match of html.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)) {
    const block = match[0];
    const start = match.index ?? 0;
    const context = getContextAround(html, start, start + block.length);
    const imgTag = block.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const fallbackAlt = getAttribute(imgTag, "alt");
    const fallbackWidth = parseNumberAttribute(getAttribute(imgTag, "width"));
    const fallbackHeight = parseNumberAttribute(getAttribute(imgTag, "height"));

    for (const sourceMatch of block.matchAll(/<source\b[^>]*>/gi)) {
      const tag = sourceMatch[0];
      const src = parseSrcSet(
        getAttribute(tag, "srcset") ?? getAttribute(tag, "data-srcset"),
      );
      const url = absoluteUrl(src, sourceUrl);

      if (!url) {
        continue;
      }

      candidates.push({
        url,
        alt: fallbackAlt,
        width: fallbackWidth,
        height: fallbackHeight,
        source: "html_image",
        context,
        score: 42,
      });
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const start = match.index ?? 0;
    const src =
      parseSrcSet(getAttribute(tag, "srcset") ?? getAttribute(tag, "data-srcset")) ??
      getAttribute(tag, "src") ??
      getAttribute(tag, "data-src") ??
      getAttribute(tag, "data-original");
    const url = absoluteUrl(src, sourceUrl);

    if (!url) {
      continue;
    }

    candidates.push({
      url,
      alt: getAttribute(tag, "alt"),
      width: parseNumberAttribute(getAttribute(tag, "width")),
      height: parseNumberAttribute(getAttribute(tag, "height")),
      source: "html_image",
      context: getContextAround(html, start, start + tag.length),
      score: 35,
    });
  }

  for (const match of html.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)) {
    const start = match.index ?? 0;
    const url = absoluteUrl(match[2] ?? null, sourceUrl);

    if (!url) {
      continue;
    }

    candidates.push({
      url,
      alt: null,
      width: null,
      height: null,
      source: "html_image",
      context: getContextAround(html, start, start + match[0].length),
      score: 8,
    });
  }

  return uniqueTopImages(candidates, title, sourceUrl);
}

function extractTitle(html: string, fallbackTitle?: string) {
  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle) {
    return ogTitle;
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1].replace(/\s+/g, " "));
  }

  return fallbackTitle ?? null;
}

export async function previewSourceImages(
  input: MvpCustomGptSourcePreviewRequest,
) {
  const cached = sourcePreviewCache.get(input.url);
  if (cached) {
    return cached;
  }

  const url = new URL(input.url);
  assertPreviewUrlAllowed(url);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_PREVIEW_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 source-preview-bot",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Source page returned ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("Source page did not return HTML.");
    }

    const html = (await response.text()).slice(0, SOURCE_PREVIEW_MAX_HTML_CHARS);
    const title = extractTitle(html, input.title);
    const images = extractImageCandidates(html, url.toString(), title);
    const result = mvpCustomGptSourcePreviewResponseSchema.parse({
      sourceUrl: url.toString(),
      title,
      images,
      reason: images.length ? null : "No useful image assets were found on this source page.",
    });

    sourcePreviewCache.set(input.url, result);
    return result;
  } catch (error) {
    return mvpCustomGptSourcePreviewResponseSchema.parse({
      sourceUrl: url.toString(),
      title: input.title ?? null,
      images: [],
      reason:
        error instanceof Error
          ? error.message
          : "Unable to preview source images.",
    });
  }
}

export function resetSourcePreviewCache() {
  sourcePreviewCache.clear();
}
