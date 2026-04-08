// Cursor-based pagination helpers.
// Cursor is an opaque base64 of an ISO timestamp — the created_at of the last returned item.
// Results are ordered created_at DESC so the cursor means "items older than this".

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parseLimit(raw: unknown): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function decodeCursor(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  try {
    const iso = Buffer.from(String(raw), 'base64url').toString('utf8');
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

export function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString(), 'utf8').toString('base64url');
}
