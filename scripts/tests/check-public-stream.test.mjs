import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLikelyMonotoneBuzz,
  summariseSpectralMetadata,
} from '../check-public-stream.mjs';

function buildMetadataFrame({ centroid, crest, entropy, flatness }, frame) {
  return [
    `frame:${frame} pts:${frame * 1024} pts_time:${(frame * 0.02322).toFixed(5)}`,
    `lavfi.aspectralstats.1.centroid=${centroid}`,
    `lavfi.aspectralstats.1.entropy=${entropy}`,
    `lavfi.aspectralstats.1.flatness=${flatness}`,
    `lavfi.aspectralstats.1.crest=${crest}`,
  ].join('\n');
}

test('steady tonal metadata is flagged as a probable buzz', () => {
  const metadata = Array.from({ length: 32 }, (_, frame) =>
    buildMetadataFrame(
      {
        centroid: 1012.6 + (frame % 2 === 0 ? 0.02 : -0.02),
        crest: 424.9,
        entropy: 0.039,
        flatness: 0.0037,
      },
      frame,
    ),
  ).join('\n');

  const summary = summariseSpectralMetadata(metadata);

  assert.equal(summary.frameCount, 32);
  assert.equal(isLikelyMonotoneBuzz(summary), true);
});

test('programme-like metadata is not flagged as a probable buzz', () => {
  const metadata = Array.from({ length: 32 }, (_, frame) =>
    buildMetadataFrame(
      {
        centroid: 400 + frame * 120,
        crest: 40 + (frame % 7) * 18,
        entropy: 0.16 + (frame % 5) * 0.07,
        flatness: 0.03 + (frame % 6) * 0.015,
      },
      frame,
    ),
  ).join('\n');

  const summary = summariseSpectralMetadata(metadata);

  assert.equal(summary.frameCount, 32);
  assert.equal(isLikelyMonotoneBuzz(summary), false);
});
