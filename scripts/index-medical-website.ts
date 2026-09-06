import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { WEBSITE_PROFILES, type WebsiteIndexSnapshot } from "@interview/schemas";
import { indexMedicalWebsite } from "../apps/api/src/lib/website-crawler";
export { indexMedicalWebsite, extractWebsiteHtml, canonicalUrl, download } from "../apps/api/src/lib/website-crawler";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = process.argv[2] as WebsiteIndexSnapshot["surveySlug"];
  if (!(slug in WEBSITE_PROFILES) || !process.argv[3]) throw new Error("Usage: tsx scripts/index-medical-website.ts <nubeqa|brukinsa|padcev> <snapshot.json>");
  const snapshot = await indexMedicalWebsite(slug);
  await writeFile(process.argv[3], JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ bot: slug, pages: snapshot.pages.length, issues: snapshot.issues.length, truncated: snapshot.truncated }));
}
