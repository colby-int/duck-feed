export function formatEpisodeDisplayTitle(title: string, presenter?: string | null): string {
  const trimmedTitle = title.trim();
  const trimmedPresenter = presenter?.trim() ?? '';

  if (!trimmedPresenter) {
    return trimmedTitle;
  }

  return `${trimmedTitle} | ${trimmedPresenter}`;
}
