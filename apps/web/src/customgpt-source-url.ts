const SITEMAP_PATH_PATTERN = /(?:^|\/)[^/?#]*sitemap[^/?#]*\.xml$/i;

export function getSuggestedCustomGptSitemapUrl(sourceUrl: string) {
  const trimmed = sourceUrl.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);

    if (!/^https?:$/i.test(url.protocol)) {
      return trimmed;
    }

    if (SITEMAP_PATH_PATTERN.test(url.pathname)) {
      return trimmed;
    }

    return `${url.origin}/sitemap.xml`;
  } catch {
    return trimmed;
  }
}
