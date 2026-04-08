// Generate a tentative episode slug from an uploaded filename.
// Operator renames later; the suffix guarantees uniqueness.

import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function tentativeSlug(stem: string): string {
  const base = slugify(stem) || 'episode';
  const suffix = randomBytes(3).toString('hex'); // 6 hex chars
  return `${base}-${suffix}`;
}
