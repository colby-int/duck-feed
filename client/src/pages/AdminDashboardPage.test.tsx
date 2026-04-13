import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { AdminDashboardPage } from './AdminDashboardPage';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    requestData: vi.fn(),
  };
});

const requestDataMock = vi.mocked(api.requestData);

describe('AdminDashboardPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    requestDataMock.mockReset();
    requestDataMock.mockImplementation(async (path) => {
      if (path === '/api/stream/status') {
        return {
          checkedAt: '2026-04-12T00:00:00.000Z',
          librarySize: 28,
          online: true,
          queueLength: 3,
          streamUrl: '/stream',
        };
      }

      if (path === '/api/stream/now-playing') {
        return {
          elapsedSeconds: 42,
          episode: {
            artworkUrl: null,
            broadcastDate: '2026-04-12',
            id: 'episode-1',
            mixcloudUrl: null,
            presenter: 'Presenters With Extremely Long Compound Names That Need To Wrap Cleanly',
            slug: 'episode-1',
            title:
              'A Very Long Now Playing Title That Previously Escaped The Dashboard Container Instead Of Wrapping - Valentines Day Special',
          },
          startedAt: '2026-04-12T00:00:00.000Z',
          track: null,
        };
      }

      if (path === '/api/admin/ingest/jobs?limit=5') {
        return [
          {
            completedAt: null,
            createdAt: '2026-04-12T00:00:00.000Z',
            episodeId: 'episode-2',
            episodePresenter:
              'The Incredibly Long Presenter Name That Used To Blow Out The Recent Jobs Table',
            episodeTitle:
              'A Very Long Recent Job Episode Title That Needs Explicit Wrapping In The Dashboard Table - Valentines Day Special',
            errorMessage: null,
            id: 'job-1',
            sourcePath:
              '/var/lib/duckfeed/dropzone/2026/04/12/some-extremely-long-subdirectory-name/and-another/deeply/nested/path/with-a-file-name-that-should-never-force-the-table-wider-than-its-panel.wav',
            startedAt: '2026-04-12T00:00:00.000Z',
            status: 'copying',
          },
        ];
      }

      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('renders long separated titles as split title lines in dashboard cards and rows', async () => {
    render(<AdminDashboardPage />);

    const nowPlayingPrimary = await screen.findByText(
      /A Very Long Now Playing Title That Previously Escaped The Dashboard Container Instead Of Wrapping/i,
    );
    expect(nowPlayingPrimary).toBeInTheDocument();
    expect(
      screen.getByText(/Valentines Day Special \| Presenters With Extremely Long Compound Names That Need To Wrap Cleanly/i),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/A Very Long Recent Job Episode Title That Needs Explicit Wrapping In The Dashboard Table/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Valentines Day Special \| The Incredibly Long Presenter Name That Used To Blow Out The Recent Jobs Table/i),
    ).toBeInTheDocument();

    const sourceCell = screen
      .getByText(/file-name-that-should-never-force-the-table-wider-than-its-panel\.wav/i)
      .closest('td');
    expect(sourceCell).toHaveClass('break-all');
  });
});
