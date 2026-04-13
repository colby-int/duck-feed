import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EpisodeDisplayTitleText } from './episode-display-title-text';
import { Panel } from './Panel';

afterEach(() => {
  cleanup();
});

describe('Panel', () => {
  it('applies the shared admin surface text token to its content wrapper', () => {
    const { container } = render(
      <Panel subtitle="library" title="Episodes">
        <div>Panel body</div>
      </Panel>,
    );

    expect(screen.getByRole('heading', { name: 'Episodes' })).toBeInTheDocument();
    expect(container.querySelector('.bg-card.text-ink')).not.toBeNull();
  });

  it('renders structured title content inside the shared heading shell', () => {
    render(
      <Panel
        subtitle="episode"
        title={
          <EpisodeDisplayTitleText
            episode={{
              presenter: 'DJ Reservoir',
              title: 'Duck Feed Late Night Archive Transmission - Valentines Day Special',
            }}
            primaryClassName="block"
            secondaryClassName="mt-1 block text-[1rem]"
          />
        }
      >
        <div>Panel body</div>
      </Panel>,
    );

    expect(screen.getByRole('heading', { name: /Duck Feed Late Night Archive Transmission/i })).toHaveTextContent(
      'Duck Feed Late Night Archive Transmission',
    );
    expect(screen.getByText('Valentines Day Special | DJ Reservoir')).toBeInTheDocument();
  });
});
