import { describe, expect, it } from "vitest";
import { allowedWebsiteIndexUrl, WEBSITE_PROFILES, websiteRefreshSettingsSchema } from "@interview/schemas";
import { ENHERTU_HCP_GUIDE, ENHERTU_SURVEY_INTENTS, enhertuGuideForIntent } from "./mvp-enhertu-guide";
import { validateMvpSurveyDefinition, guideForIntent } from "./mvp-survey-definition";
const definition = { slug: "enhertu" as const, defaultStudyName: "ENHERTU HCP discussion", sourceBrand: "ENHERTU", guide: ENHERTU_HCP_GUIDE, intents: ENHERTU_SURVEY_INTENTS, projectIdEnvName: "ENHERTU_WEBSITE_INDEX", defaultProjectId: () => null };
describe("ENHERTU survey configuration", () => {
  it("validates all six focus paths and asks for clinical setting before evidence", () => {
    expect(() => validateMvpSurveyDefinition(definition)).not.toThrow();
    expect(ENHERTU_SURVEY_INTENTS).toHaveLength(6);
    for (const intent of ENHERTU_SURVEY_INTENTS) {
      const guide = enhertuGuideForIntent(guideForIntent(definition, intent), intent.slug);
      expect(guide.slice(0,2).map(q=>q.id)).toEqual(["intro_consent","primary_disease_focus"]);
      expect(guide.at(-1)?.id).toBe("close");
      expect(guide.find(q=>q.sourceContextRequirement)?.sourceContextRequirement).toContain("Selected focus:");
    }
    expect(enhertuGuideForIntent(ENHERTU_HCP_GUIDE,"breast-cancer-evidence")[1].canonicalQuestion).toContain("early or metastatic");
    expect(guideForIntent(definition,ENHERTU_SURVEY_INTENTS[5]).some(q=>q.id === "clinical_evidence")).toBe(false);
  });
  it("permits the exact website-linked PI endpoint without opening arbitrary query URLs", () => {
    const pi = WEBSITE_PROFILES.enhertu.documentUrls[0];
    expect(allowedWebsiteIndexUrl("enhertu",pi,true)).toBe(true);
    expect(allowedWebsiteIndexUrl("enhertu",pi + "#page=2",true)).toBe(true);
    expect(allowedWebsiteIndexUrl("enhertu",pi.replace("inline=true&productName=Enhertu","productName=Enhertu&inline=true"),true)).toBe(true);
    expect(allowedWebsiteIndexUrl("enhertu",pi + "&extra=true",true)).toBe(false);
    expect(allowedWebsiteIndexUrl("enhertu",pi,false)).toBe(false);
    expect(allowedWebsiteIndexUrl("enhertu",pi.replace("Enhertu","OtherProduct"),true)).toBe(false);
    expect(allowedWebsiteIndexUrl("enhertu","https://www.nubeqahcp.com/",true)).toBe(false);
    expect(allowedWebsiteIndexUrl("enhertu","https://www.enhertuhcp.com/en?redirect=anything",true)).toBe(false);
    const saved = websiteRefreshSettingsSchema.parse({surveySlug:"enhertu",profile:WEBSITE_PROFILES.enhertu});
    expect(saved.profile.documentUrls).toEqual(WEBSITE_PROFILES.enhertu.documentUrls);
    expect(saved.intervalHours).toBe(168);
  });
});
