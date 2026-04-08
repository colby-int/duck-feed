import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

describe('favicon assets', () => {
  it('references the generated favicon assets in the app shell', () => {
    expect(indexHtml).toContain('href="/favicon-32x32.png"');
    expect(indexHtml).toContain('href="/favicon-16x16.png"');
    expect(indexHtml).toContain('href="/apple-touch-icon.png"');
  });
  it('includes the larger installable icon variant', () => {
    expect(indexHtml).toContain('href="/favicon-192x192.png"');
  });
});
