import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMixcloudEpisodeTitle,
  resolveStructuredFilenameMetadata,
} from './ingest-manifest-metadata.mjs';

test('recovers exact Mixcloud formatting from source titles for ingest metadata', () => {
  assert.deepEqual(
    resolveStructuredFilenameMetadata(
      '080226_hardcorenerds_tkfmbadmd.mp3',
      "Hardcore Nerds TK FM & Bad'm D",
    ),
    {
      broadcastDate: '2026-02-08',
      presenter: "TK FM & Bad'm D",
      title: 'Hardcore Nerds',
    },
  );
});

test('preserves source-title casing when it differs from generic humanization', () => {
  assert.deepEqual(
    resolveStructuredFilenameMetadata('180126_sunshinehouse_zoeg.mp3', 'sunshine house Zoe G'),
    {
      broadcastDate: '2026-01-18',
      presenter: 'Zoe G',
      title: 'sunshine house',
    },
  );
});

test('falls back to structured filename humanization when no exact source-title split is available', () => {
  assert.deepEqual(resolveStructuredFilenameMetadata('08042026_duck-feed-live_gary-butterfield.mp3'), {
    broadcastDate: '2026-04-08',
    presenter: 'Gary Butterfield',
    title: 'Duck Feed Live',
  });
});

test('parses canonical Mixcloud titles into exact title, presenter, and date metadata', () => {
  assert.deepEqual(
    parseMixcloudEpisodeTitle("Hardcore Nerds | TK FM & Bad'm D | 08.02.2026"),
    {
      broadcastDate: '2026-02-08',
      presenter: "TK FM & Bad'm D",
      sourceTitle: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
      title: 'Hardcore Nerds',
    },
  );
});

test('preserves exact Mixcloud casing when parsing canonical titles', () => {
  assert.deepEqual(parseMixcloudEpisodeTitle('sunshine house | Zoe G | 18.01.26'), {
    broadcastDate: '2026-01-18',
    presenter: 'Zoe G',
    sourceTitle: 'sunshine house | Zoe G | 18.01.26',
    title: 'sunshine house',
  });
});
