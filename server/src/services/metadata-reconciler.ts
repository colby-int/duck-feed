/**
 * Metadata Reconciler
 *
 * Parses and normalises episode metadata to match the authoritative Mixcloud
 * archive format:  "Show Name | Presenter Name | DD.MM.YYYY"
 *
 * The DB stores title, presenter, and broadcastDate as separate columns.
 * This module bridges the gap between raw/ingested metadata and the canonical
 * Mixcloud representation so the validator can do an exact match.
 */

export interface ReconciledMetadata {
  title: string;
  presenter: string | null;
  broadcastDate: string | null;
  /** The full Mixcloud-format display string for validation. */
  mixcloudTitle: string;
}

/**
 * Parse a Mixcloud-format title string:
 *   "Show Name | Presenter | DD.MM.YYYY"   (3-part, with date)
 *   "Show Name | Presenter"                (2-part, no date)
 *
 * Returns null when the string doesn't match either pattern.
 */
export function parseMixcloudTitle(value: string): ReconciledMetadata | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('|').map((p) => p.trim());

  if (parts.length === 3 && parts.every(Boolean)) {
    const [title, presenter, rawDate] = parts;
    const broadcastDate = parseLooseBroadcastDate(rawDate!);
    if (!broadcastDate) return null;
    return {
      title: title!,
      presenter: presenter!,
      broadcastDate,
      mixcloudTitle: trimmed,
    };
  }

  if (parts.length === 2 && parts.every(Boolean)) {
    return {
      title: parts[0]!,
      presenter: parts[1]!,
      broadcastDate: null,
      mixcloudTitle: trimmed,
    };
  }

  return null;
}

/**
 * Build the canonical Mixcloud display title from separate DB fields.
 * This is the string that should appear on Mixcloud and is used for
 * validation lookups.
 */
export function buildMixcloudTitle(
  title: string,
  presenter?: string | null,
  broadcastDate?: string | null,
): string {
  const parts = [title.trim()];
  if (presenter?.trim()) parts.push(presenter.trim());
  if (broadcastDate) parts.push(formatBroadcastDate(broadcastDate));
  return parts.join(' | ');
}

/**
 * Reconcile an episode's metadata.
 *
 * Strategy:
 *  1. If the raw title is already in Mixcloud pipe-format, parse it and
 *     extract title / presenter / broadcastDate.
 *  2. Otherwise, build the Mixcloud title from the episode's existing
 *     separate fields (which come from the filename parser at ingest time).
 */
export function reconcileMetadata(episode: {
  title: string;
  presenter?: string | null;
  broadcastDate?: string | null;
}): ReconciledMetadata {
  // Try parsing the title as a Mixcloud-format string first.
  const parsed = parseMixcloudTitle(episode.title);
  if (parsed) return parsed;

  // Fall back to building from separate fields.
  const title = episode.title.trim();
  const presenter = episode.presenter?.trim() || null;
  const broadcastDate = episode.broadcastDate ?? null;

  return {
    title,
    presenter,
    broadcastDate,
    mixcloudTitle: buildMixcloudTitle(title, presenter, broadcastDate),
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Parse loose date strings like "15.02.2026", "15/02/2026", "15-02-26". */
function parseLooseBroadcastDate(value: string): string | null {
  const parts = value
    .trim()
    .split(/[^0-9]+/g)
    .filter(Boolean);

  if (parts.length !== 3) return null;

  const [rawDay, rawMonth, rawYear] = parts;
  const day = rawDay!.padStart(2, '0');
  const month = rawMonth!.padStart(2, '0');
  const year = normalizeYear(rawYear!);

  return toIsoDate(day, month, year);
}

/** Convert an ISO date (YYYY-MM-DD) to Mixcloud display format (DD.MM.YYYY). */
function formatBroadcastDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return isoDate;
}

function normalizeYear(value: string): string {
  if (value.length === 4) return value;
  const n = Number.parseInt(value, 10);
  return String(n >= 70 ? 1900 + n : 2000 + n);
}
