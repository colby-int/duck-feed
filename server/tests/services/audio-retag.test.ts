import { describe, expect, it } from 'vitest';

import { buildExpectedTags } from '../../src/services/audio-retag.js';

describe('audio-retag buildExpectedTags', () => {
  it('formats title as "Show | Presenter" and uses presenter as artist', () => {
    const tags = buildExpectedTags({
      presenter: 'Morgan, Stu & Josh',
      title: 'Discount Panettone',
    });

    expect(tags).toEqual({
      album: 'duckfeed Radio',
      artist: 'Morgan, Stu & Josh',
      title: 'Discount Panettone | Morgan, Stu & Josh',
    });
  });

  it('omits the separator when presenter is missing', () => {
    const tags = buildExpectedTags({
      presenter: null,
      title: 'Standalone Show',
    });

    expect(tags).toEqual({
      album: 'duckfeed Radio',
      artist: '',
      title: 'Standalone Show',
    });
  });
});
