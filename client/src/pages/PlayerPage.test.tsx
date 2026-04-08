import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { PlayerPage } from './PlayerPage';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    requestData: vi.fn(),
  };
});

vi.mock('../hooks/use-audio-motion', () => ({
  useAudioMotion: () => ({
    activate: vi.fn(),
    motion: {
      driftX: 0,
      intensity: 0,
      isAnalyserAvailable: false,
      isReducedMotion: false,
      shadowOffset: 0,
      waveformBands: new Array(16).fill(0),
    },
  }),
}));

const requestDataMock = vi.mocked(api.requestData);

const archiveFixture: api.EpisodeSummary[] = [
  {
    artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
    broadcastDate: '2025-09-08',
    createdAt: '2026-04-08T00:00:00.000Z',
    description: 'Absolute mixed bag',
    durationSeconds: 3600,
    id: 'episode-1',
    mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
    presenter: 'Wellness Centre',
    slug: 'test-pattern',
    title: 'Test Pattern',
  },
  {
    artworkUrl: 'https://cdn.example.com/night-drive.jpg',
    broadcastDate: '2025-10-01',
    createdAt: '2026-04-07T00:00:00.000Z',
    description: 'Late-night drive time',
    durationSeconds: 3600,
    id: 'episode-2',
    mixcloudUrl: 'https://www.mixcloud.com/example-station/night-drive/',
    presenter: 'DJ Evening',
    slug: 'night-drive',
    title: 'Night Drive',
  },
];

function installEventSourceMock() {
  class EventSourceMock {
    addEventListener = vi.fn();
    close = vi.fn();
  }

  Object.defineProperty(window, 'EventSource', {
    configurable: true,
    value: EventSourceMock,
    writable: true,
  });
}

describe('PlayerPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    installEventSourceMock();
    requestDataMock.mockReset();
    requestDataMock.mockImplementation(async (path) => {
      if (path === '/api/episodes?limit=12') {
        return structuredClone(archiveFixture);
      }

      if (path === '/api/stream/status') {
        return {
          checkedAt: '2026-04-08T00:00:00.000Z',
          librarySize: 2,
          online: true,
          queueLength: 2,
          streamUrl: '/stream',
        };
      }

      if (path === '/api/stream/now-playing') {
        return {
          elapsedSeconds: 120,
          episode: {
            artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
            broadcastDate: '2025-09-08',
            id: 'episode-1',
            mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
            presenter: 'Wellness Centre',
            slug: 'test-pattern',
            title: 'Test Pattern',
          },
          startedAt: '2026-04-08T00:00:00.000Z',
          track: null,
        } satisfies api.NowPlaying;
      }

      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('renders artwork, a Mixcloud CTA, formatted dates, and an open next-up accordion', async () => {
    render(<PlayerPage />);

    const artwork = await screen.findByRole('img', { name: /artwork for test pattern/i });

    expect(artwork).toHaveAttribute('src', 'https://cdn.example.com/test-pattern.jpg');
    expect(screen.getByRole('link', { name: /listen on mixcloud/i })).toHaveAttribute(
      'href',
      'https://www.mixcloud.com/example-station/test-pattern/',
    );
    expect(screen.getByTestId('hero-date')).toHaveTextContent('September 8, 2025');
    expect(screen.getByTestId('hero-presenter-line')).toHaveTextContent('with Wellness Centre');
    expect(screen.getByText('October 1, 2025')).toBeInTheDocument();
    expect(screen.getByTestId('up-next-accordion')).toHaveAttribute('open');
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/now playing/i)).not.toBeInTheDocument();
  });

  it('falls back to the latest archive episode metadata when no now-playing episode is available', async () => {
    requestDataMock.mockImplementation(async (path) => {
      if (path === '/api/episodes?limit=12') {
        return structuredClone(archiveFixture);
      }

      if (path === '/api/stream/status') {
        return {
          checkedAt: '2026-04-08T00:00:00.000Z',
          librarySize: 2,
          online: false,
          queueLength: 0,
          streamUrl: '/stream',
        };
      }

      if (path === '/api/stream/now-playing') {
        return null;
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PlayerPage />);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /artwork for test pattern/i })).toHaveAttribute(
        'src',
        'https://cdn.example.com/test-pattern.jpg',
      );
    });

    expect(screen.getByRole('link', { name: /listen on mixcloud/i })).toHaveAttribute(
      'href',
      'https://www.mixcloud.com/example-station/test-pattern/',
    );
  });

  it('does not borrow artwork from a different archive episode when now-playing artwork is missing', async () => {
    requestDataMock.mockImplementation(async (path) => {
      if (path === '/api/episodes?limit=12') {
        return structuredClone(archiveFixture);
      }

      if (path === '/api/stream/status') {
        return {
          checkedAt: '2026-04-08T00:00:00.000Z',
          librarySize: 2,
          online: true,
          queueLength: 1,
          streamUrl: '/stream',
        };
      }

      if (path === '/api/stream/now-playing') {
        return {
          elapsedSeconds: 120,
          episode: {
            artworkUrl: null,
            broadcastDate: '2025-11-01',
            id: 'episode-live',
            mixcloudUrl: 'https://www.mixcloud.com/example-station/live-set/',
            presenter: 'DJ Current',
            slug: 'live-set',
            title: 'Current Set',
          },
          startedAt: '2026-04-08T00:00:00.000Z',
          track: null,
        } satisfies api.NowPlaying;
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PlayerPage />);

    await waitFor(() => {
      expect(screen.getByTestId('hero-presenter-line')).toHaveTextContent('with DJ Current');
    });

    expect(screen.queryByRole('img', { name: /artwork for current set/i })).not.toBeInTheDocument();
  });
});
