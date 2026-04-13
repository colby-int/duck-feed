import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EpisodeDisplayTitleText } from './episode-display-title-text';

afterEach(() => {
  cleanup();
});

describe('EpisodeDisplayTitleText', () => {
  it('renders long separated titles as a primary line with a smaller secondary line', () => {
    render(
      <EpisodeDisplayTitleText
        episode={{
          presenter: 'DJ Reservoir',
          title: 'Duck Feed Late Night Archive Transmission - Valentines Day Special',
        }}
        primaryClassName="primary-line"
        secondaryClassName="secondary-line"
        testId="episode-title"
      />,
    );

    expect(screen.getByTestId('episode-title-primary')).toHaveTextContent(
      'Duck Feed Late Night Archive Transmission',
    );
    expect(screen.getByTestId('episode-title-secondary')).toHaveTextContent(
      'Valentines Day Special | DJ Reservoir',
    );
    expect(screen.getByTestId('episode-title-secondary')).toHaveClass('secondary-line');
  });

  it('renders unsplit titles on a single line', () => {
    render(
      <EpisodeDisplayTitleText
        episode={{
          presenter: 'DJ Reservoir',
          title: 'Duck Feed - Live',
        }}
        primaryClassName="primary-line"
        secondaryClassName="secondary-line"
        testId="episode-title"
      />,
    );

    expect(screen.getByTestId('episode-title-single')).toHaveTextContent('Duck Feed - Live | DJ Reservoir');
    expect(screen.queryByTestId('episode-title-secondary')).not.toBeInTheDocument();
  });
});
