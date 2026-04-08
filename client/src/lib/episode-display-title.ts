export function formatEpisodeDisplayTitle(episode: {
  presenter?: string | null;
  title: string;
}): string {
  const trimmedTitle = episode.title.trim();
  const trimmedPresenter = episode.presenter?.trim() ?? '';

  if (!trimmedPresenter) {
    return trimmedTitle;
  }

  return `${trimmedTitle} | ${trimmedPresenter}`;
}
