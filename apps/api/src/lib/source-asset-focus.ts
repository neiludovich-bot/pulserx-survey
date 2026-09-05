import type { GroundedReference } from "@interview/schemas";

type SourceAsset = GroundedReference["assets"][number];
type AssetFocus = "interactions" | "urinary_infection";

function assetFocus(query: string): AssetFocus | null {
  const interactions = /\b(?:ddi(?:s|'s)?|interactions?|cyp3a4|bcrp|oatp\w*|p-gp)\b/i.test(query);
  const urinaryInfection = /\b(?:uti(?:s|'s)?|urinary tract infections?)\b/i.test(query);
  if (interactions === urinaryInfection) return null;
  return interactions ? "interactions" : "urinary_infection";
}

function matchesFocus(asset: SourceAsset, focus: AssetFocus) {
  // Asset identity, not inherited parent-document tags, determines relevance.
  // A generic safety document may label every child with "DDI".
  const identity = `${asset.title} ${asset.url}`;
  return focus === "interactions"
    ? /\b(?:ddi|drug[- ](?:drug[- ])?interactions?|cyp3a4|bcrp|oatp\w*)\b/i.test(identity)
    : /\b(?:uti|urinary[- ]tract[- ]infection)\b/i.test(identity) ||
        /aranote/i.test(asset.title) && /adverse[- ]reaction/i.test(asset.title);
}

/** Keep each citation's visual evidence aligned with the resolved source question. */
export function focusSourceReferenceAssets(
  references: GroundedReference[],
  query: string,
): GroundedReference[] {
  const focus = assetFocus(query);
  if (!focus) return references;

  return references.map((reference) => {
    const assets = reference.assets.filter((asset) => matchesFocus(asset, focus));
    if (assets.length) return { ...reference, assets };
    // Explicitly retain a source link when this citation has no relevant figure.
    // Do not let the preview silently replace it with unrelated page images.
    return {
      ...reference,
      assets: reference.url ? [{
        title: reference.title ?? "Source reference",
        url: reference.url,
        description: reference.description,
        assetKind: "LINK",
        tags: [],
        priority: 1,
      }] : [],
    };
  });
}
