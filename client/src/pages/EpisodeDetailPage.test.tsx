import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { EpisodeDetailPage } from './EpisodeDetailPage';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    approveTrack: vi.fn(),
    deleteEpisode: vi.fn(),
    deleteTrack: vi.fn(),
    requestData: vi.fn(),
    triggerEpisodeFingerprint: vi.fn(),
    updateTrack: vi.fn(),
  };
});

const requestDataMock = vi.mocked(api.requestData);

const detailFixture: api.EpisodeDetail = {
  autoQueuedAt: null,
  autoQueueRequestId: null,
  broadcastDate: '2026-04-08',
  createdAt: '2026-04-08T00:00:00.000Z',
  description: 'Existing notes',
  durationSeconds: 1800,
  filePath: '/var/lib/duckfeed/library/example.mp3',
  id: 'episode-1',
  mixcloudUrl: 'https://www.mixcloud.com/example/show/',
  presenter: 'DJ Example',
  slug: 'example-show',
  status: 'ready',
  title: 'Example Show',
  tracks: [],
};

function renderEpisodeDetailPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/episodes/episode-1']}>
      <Routes>
        <Route element={<EpisodeDetailPage />} path="/admin/episodes/:id" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EpisodeDetailPage', () => {
  beforeEach(() => {
    requestDataMock.mockReset();
    requestDataMock.mockImplementation(async (path, init) => {
      if (path === '/api/admin/episodes/episode-1' && !init) {
        return structuredClone(detailFixture);
      }

      if (path === '/api/admin/episodes/episode-1' && init?.method === 'PATCH') {
        return {
          ...detailFixture,
          ...JSON.parse(String(init.body)),
        };
      }

      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not clobber in-progress edits when the background poll refreshes', async () => {
    // Install fake timers before render so the polling setInterval is
    // intercepted. `shouldAdvanceTime` keeps testing-library's waitFor alive.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderEpisodeDetailPage();

    const titleInput = (await screen.findByDisplayValue('Example Show')) as HTMLInputElement;

    titleInput.focus();
    expect(document.activeElement).toBe(titleInput);
    fireEvent.change(titleInput, { target: { value: 'Partial edit' } });
    expect(titleInput.value).toBe('Partial edit');

    // Advance past the 5s polling interval. The mocked GET resolves with
    // the stale server state ("Example Show"). The page must NOT overwrite
    // the value the user is typing into the focused input.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    expect(titleInput.value).toBe('Partial edit');
    expect(document.activeElement).toBe(titleInput);
  });

  it('saves metadata when the title field loses focus', async () => {
    renderEpisodeDetailPage();

    const titleInput = await screen.findByDisplayValue('Example Show');

    fireEvent.change(titleInput, { target: { value: 'Updated Show' } });
    fireEvent.blur(titleInput);

    await waitFor(() => {
      expect(requestDataMock).toHaveBeenCalledWith(
        '/api/admin/episodes/episode-1',
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
    });

    const patchCall = requestDataMock.mock.calls.find(
      ([path, init]) => path === '/api/admin/episodes/episode-1' && init?.method === 'PATCH',
    );

    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      title: 'Updated Show',
    });
  });
});
