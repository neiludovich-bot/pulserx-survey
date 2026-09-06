import { describe, expect, it } from "vitest";
import { sourceAssetMeasureEligible, sourceAssetAnswerEligible, sourceAssetDisplayEligible } from "./source-asset-measure";

describe('figure measure eligibility across bots', () => {
  it('does not offer PDF documents mislabeled as visual tables', () => {
    expect(sourceAssetDisplayEligible({ assetKind: 'TABLE', url: 'https://example.com/guide.pdf' })).toBe(false);
    expect(sourceAssetDisplayEligible({ assetKind: 'TABLE', url: 'https://example.com/figure.svg?v=1' })).toBe(true);
    expect(sourceAssetDisplayEligible({ assetKind: 'PDF', url: 'https://example.com/guide.pdf' })).toBe(true);
  });
  const exposure = { title: 'Median durations of exposure to treatment for therapy and comparator' };
  it.each(['NUBEQA', 'BRUKINSA', 'PADCEV'])('does not use exposure duration to illustrate %s side effects', brand => {
    expect(sourceAssetMeasureEligible(exposure, `What are the ${brand} side effects?`)).toBe(false);
    expect(sourceAssetMeasureEligible(exposure, `What are the SEs with ${brand}?`)).toBe(false);
    expect(sourceAssetMeasureEligible({ title: 'Adverse reaction summary' }, `What are the ${brand} side effects?`)).toBe(true);
  });
  it.each(['What was the exposure duration?', 'How long were patients treated?', 'What was the time on treatment?'])('retains the figure for %s', query => {
    expect(sourceAssetMeasureEligible(exposure, query)).toBe(true);
  });
  it('does not confuse side-effect duration with treatment exposure duration', () => {
    expect(sourceAssetMeasureEligible(exposure, 'How long do the side effects last?')).toBe(false);
  });
  it('does not attach a numbered study graphic to another trial in the same indication', () => {
    const asset = { title: 'ORR data from Study 003 (WM)' };
    expect(sourceAssetAnswerEligible(asset, 'ASPEN reported outcomes in WM.')).toBe(false);
    expect(sourceAssetAnswerEligible(asset, 'Study 003 reported outcomes in WM.')).toBe(true);
  });
});
