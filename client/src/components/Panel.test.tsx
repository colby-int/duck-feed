import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

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
});
