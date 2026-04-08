import path from 'node:path';

export interface ParsedEpisodeFilename {
  title: string;
  presenter: string;
  broadcastDate: string;
  slugSeed: string;
}

const STRUCTURED_EPISODE_PATTERN =
  /^(?<day>\d{2})(?<month>\d{2})(?<year>\d{2}|\d{4})_(?<title>[^_]+)_(?<presenter>[^_]+)$/;

export function parseEpisodeFilename(filename: string): ParsedEpisodeFilename | null {
  const stem = path.basename(filename, path.extname(filename));
  const match = STRUCTURED_EPISODE_PATTERN.exec(stem);
  if (!match?.groups) {
    return null;
  }

  const { day, month, year, title, presenter } = match.groups;
  const broadcastDate = toIsoDate(day, month, normalizeYear(year));
  if (!broadcastDate) {
    return null;
  }

  const displayTitle = humanizeSegment(title);
  const displayPresenter = humanizeSegment(presenter);
  if (!displayTitle || !displayPresenter) {
    return null;
  }

  return {
    title: displayTitle,
    presenter: displayPresenter,
    broadcastDate,
    slugSeed: `${broadcastDate} ${displayTitle}`,
  };
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

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
  if (value.length === 4) {
    return value;
  }

  const numericYear = Number(value);
  return String(numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear);
}

function humanizeSegment(value: string): string {
  const words = value
    .split(/[-.]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
