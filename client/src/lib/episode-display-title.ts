const TITLE_SUBHEADING_MIN_LENGTH = 48;
const TITLE_SUBHEADING_SEPARATOR_PATTERN = /\s[-–—]\s/g;

export interface EpisodeDisplayTitleParts {
  displayTitle: string;
  presenter: string | null;
  primaryTitle: string;
  secondaryTitle: string | null;
  title: string;
}

function splitEpisodeTitle(title: string): Pick<EpisodeDisplayTitleParts, 'primaryTitle' | 'secondaryTitle'> {
  if (title.length < TITLE_SUBHEADING_MIN_LENGTH) {
    return {
      primaryTitle: title,
      secondaryTitle: null,
    };
  }

  const separatorMatches = Array.from(title.matchAll(TITLE_SUBHEADING_SEPARATOR_PATTERN));
  const lastSeparator = separatorMatches.at(-1);
  const separatorIndex = lastSeparator?.index;

  if (!lastSeparator || separatorIndex == null) {
    return {
      primaryTitle: title,
      secondaryTitle: null,
    };
  }

  const primaryTitle = title.slice(0, separatorIndex).trim();
  const secondaryTitle = title.slice(separatorIndex + lastSeparator[0].length).trim();

  if (!primaryTitle || !secondaryTitle) {
    return {
      primaryTitle: title,
      secondaryTitle: null,
    };
  }

  return {
    primaryTitle,
    secondaryTitle,
  };
}

export function getEpisodeDisplayTitleParts(episode: {
  presenter?: string | null;
  title: string;
}): EpisodeDisplayTitleParts {
  const trimmedTitle = episode.title.trim();
  const trimmedPresenter = episode.presenter?.trim() ?? '';
  const presenter = trimmedPresenter || null;
  const { primaryTitle, secondaryTitle } = splitEpisodeTitle(trimmedTitle);

  return {
    displayTitle: presenter ? `${trimmedTitle} | ${presenter}` : trimmedTitle,
    presenter,
    primaryTitle,
    secondaryTitle,
    title: trimmedTitle,
  };
}

export function formatEpisodeDisplayTitle(episode: {
  presenter?: string | null;
  title: string;
}): string {
  const { displayTitle } = getEpisodeDisplayTitleParts(episode);

  return displayTitle;
}
