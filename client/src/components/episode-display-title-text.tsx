import { getEpisodeDisplayTitleParts } from '../lib/episode-display-title';

export function EpisodeDisplayTitleText({
  episode,
  className,
  primaryClassName,
  secondaryClassName,
  showPresenter = true,
  singleLineClassName,
  testId,
}: {
  className?: string;
  episode: {
    presenter?: string | null;
    title: string;
  };
  primaryClassName?: string;
  secondaryClassName?: string;
  showPresenter?: boolean;
  singleLineClassName?: string;
  testId?: string;
}) {
  const parts = getEpisodeDisplayTitleParts(episode);

  if (!parts.secondaryTitle) {
    return (
      <span className={className} title={parts.displayTitle}>
        <span className={singleLineClassName ?? primaryClassName} data-testid={testId ? `${testId}-single` : undefined}>
          {showPresenter && parts.presenter ? parts.displayTitle : parts.title}
        </span>
      </span>
    );
  }

  const secondaryLine =
    showPresenter && parts.presenter ? `${parts.secondaryTitle} | ${parts.presenter}` : parts.secondaryTitle;

  return (
    <span className={className} title={parts.displayTitle}>
      <span className={primaryClassName} data-testid={testId ? `${testId}-primary` : undefined}>
        {parts.primaryTitle}
      </span>
      <span className={secondaryClassName} data-testid={testId ? `${testId}-secondary` : undefined}>
        {secondaryLine}
      </span>
    </span>
  );
}
