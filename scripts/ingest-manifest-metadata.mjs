import path from 'node:path';

const STRUCTURED_FILENAME =
  /^(?<day>\d{2})(?<month>\d{2})(?<year>\d{2}|\d{4})_(?<title>[^_]+)_(?<presenter>[^_]+)\.mp3$/i;

export function parseMixcloudEpisodeTitle(value) {
  const sourceTitle = value.trim();
  if (!sourceTitle) {
    return null;
  }

  const parts = sourceTitle.split('|').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return null;
  }

  const [title, presenter, rawDate] = parts;
  const broadcastDate = parseLooseBroadcastDate(rawDate);
  if (!broadcastDate) {
    return null;
  }

  return {
    broadcastDate,
    presenter,
    sourceTitle,
    title,
  };
}

export function resolveStructuredFilenameMetadata(filename, sourceTitle = '') {
  const stem = path.basename(filename);
  const match = STRUCTURED_FILENAME.exec(stem);
  if (!match?.groups) {
    return null;
  }

  const { day, month, year, title, presenter } = match.groups;
  const broadcastDate = toIsoDate(day, month, normalizeYear(year));
  if (!broadcastDate) {
    return null;
  }

  const fallback = {
    broadcastDate,
    presenter: humanizeStructuredSegment(presenter),
    title: humanizeStructuredSegment(title),
  };
  const exactSplit = splitSourceTitle(sourceTitle, title, presenter);

  return exactSplit
    ? {
        broadcastDate,
        presenter: exactSplit.presenter,
        title: exactSplit.title,
      }
    : fallback;
}

function splitSourceTitle(sourceTitle, rawTitleSegment, rawPresenterSegment) {
  const trimmedSourceTitle = sourceTitle.trim();
  if (!trimmedSourceTitle) {
    return null;
  }

  const tokens = trimmedSourceTitle.split(/\s+/g).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  const expectedTitle = condenseSegment(rawTitleSegment);
  const expectedPresenter = condenseSegment(rawPresenterSegment);

  for (let index = 1; index < tokens.length; index += 1) {
    const title = tokens.slice(0, index).join(' ').trim();
    const presenter = tokens.slice(index).join(' ').trim();
    if (!title || !presenter) {
      continue;
    }

    if (
      condenseSegment(title) === expectedTitle &&
      condenseSegment(presenter) === expectedPresenter
    ) {
      return { presenter, title };
    }
  }

  return null;
}

function condenseSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseLooseBroadcastDate(value) {
  const parts = value
    .trim()
    .split(/[^0-9]+/g)
    .filter(Boolean);

  if (parts.length !== 3) {
    return null;
  }

  const [rawDay, rawMonth, rawYear] = parts;
  const day = rawDay.padStart(2, '0');
  const month = rawMonth.padStart(2, '0');
  const year = normalizeYear(rawYear);

  return toIsoDate(day, month, year);
}

function toIsoDate(day, month, year) {
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

function normalizeYear(value) {
  if (value.length === 4) {
    return value;
  }

  const numericYear = Number.parseInt(value, 10);
  return String(numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear);
}

function humanizeStructuredSegment(value) {
  return value
    .split(/[-.]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
