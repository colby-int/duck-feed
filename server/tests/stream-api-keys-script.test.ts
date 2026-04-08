import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server package scripts', () => {
  it('runs the stream API key CLI from the compiled dist output', () => {
    const packageJsonPath = resolve(import.meta.dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['stream-api-keys']).toBe('node dist/cli/manage-stream-api-keys.js');
  });
});
