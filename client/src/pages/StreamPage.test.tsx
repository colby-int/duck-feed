import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { StreamPage } from './StreamPage';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    requestData: vi.fn(),
  };
});

const requestDataMock = vi.mocked(api.requestData);

describe('StreamPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    const readyEpisodes: api.EpisodeSummary[] = [
      {
        broadcastDate: '2026-04-08',
        createdAt: '2026-04-08T00:00:00.000Z',
        description: null,
        durationSeconds: 3600,
        id: 'episode-1',
        mixcloudUrl: null,
        presenter: 'DJ Example',
        slug: 'episode-1',
        status: 'ready',
        title: 'Episode 1',
      },
    ];

    let apiKeys: api.StreamApiKeyRecord[] = [
      {
        id: 'key-1',
        keyPrefix: 'dfs_abc123',
        label: 'Main site',
        createdAt: '2026-04-08T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];

    requestDataMock.mockReset();
    requestDataMock.mockImplementation(async (path, init) => {
      if (path === '/api/admin/stream/queue' && !init?.method) {
        return ['12'];
      }

      if (path === '/api/admin/episodes?limit=50') {
        return readyEpisodes;
      }

      if (path === '/api/admin/stream/api-keys' && !init?.method) {
        return structuredClone(apiKeys);
      }

      if (path === '/api/admin/stream/api-keys' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { label: string };
        const record: api.StreamApiKeyRecord = {
          id: 'key-2',
          keyPrefix: 'dfs_def456',
          label: body.label,
          createdAt: '2026-04-08T01:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        };
        apiKeys = [record, ...apiKeys];
        return {
          key: 'dfs_secret_value',
          record,
        } satisfies api.CreatedStreamApiKey;
      }

      if (path === '/api/admin/stream/api-keys/key-1/revoke' && init?.method === 'POST') {
        apiKeys = apiKeys.map((apiKey) =>
          apiKey.id === 'key-1'
            ? {
                ...apiKey,
                revokedAt: '2026-04-08T02:00:00.000Z',
              }
            : apiKey,
        );
        return apiKeys.find((apiKey) => apiKey.id === 'key-1');
      }

      if (path === '/api/admin/stream/queue' && init?.method === 'POST') {
        return {
          requestId: '14',
          raw: ['14'],
        };
      }

      if (path === '/api/admin/stream/skip' && init?.method === 'POST') {
        return undefined;
      }

      if (path === '/api/admin/stream/restart-current' && init?.method === 'POST') {
        return {
          requestId: '15',
          restartedFilePath: '/var/lib/duckfeed/library/episode-1.mp3',
        };
      }

      throw new Error(`Unexpected request: ${path} (${init?.method ?? 'GET'})`);
    });
  });

  it('lists, creates, and revokes integration API keys', async () => {
    render(<StreamPage />);

    expect(await screen.findByText('Main site')).toBeInTheDocument();
    expect(screen.getByText('dfs_abc123')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/key label/i), {
      target: { value: 'Companion app' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(await screen.findByText(/save this key now/i)).toBeInTheDocument();
    expect(screen.getByText('dfs_secret_value')).toBeInTheDocument();
    expect(screen.getByText('Companion app')).toBeInTheDocument();
    expect(screen.getByText('dfs_def456')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /revoke main site/i }));

    await waitFor(() => {
      const statuses = screen.getAllByText(/revoked|active/i);
      expect(statuses.some((status) => status.textContent === 'revoked')).toBe(true);
    });
  });
});
