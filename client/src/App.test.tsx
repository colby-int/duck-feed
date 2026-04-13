import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api/client';
import { App } from './App';

vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getSiteAppearance: vi.fn(),
    requestData: vi.fn(),
  };
});

const getCurrentUserMock = vi.mocked(api.getCurrentUser);
const getSiteAppearanceMock = vi.mocked(api.getSiteAppearance);
const requestDataMock = vi.mocked(api.requestData);

describe('App', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    document.documentElement.style.cssText = '';
    document.head.innerHTML = `
      <link rel="icon" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    `;
    getCurrentUserMock.mockReset();
    getSiteAppearanceMock.mockReset();
    requestDataMock.mockReset();
    getCurrentUserMock.mockRejectedValue(new Error('not logged in'));
    getSiteAppearanceMock.mockResolvedValue({
      backgroundColor: '#112233',
      containerColor: '#445566',
      faviconUrl: '/api/site-assets/custom-favicon.png',
      logoUrl: '/api/site-assets/custom-logo.png',
      textColor: '#ddeeff',
    });
    requestDataMock.mockImplementation(async (path) => {
      if (path === '/api/episodes?limit=12') {
        return [];
      }

      if (path === '/api/stream/status') {
        return {
          checkedAt: '2026-04-11T00:00:00.000Z',
          librarySize: 0,
          online: false,
          queueLength: 0,
          streamUrl: '/stream',
        } satisfies api.StreamStatus;
      }

      if (path === '/api/stream/now-playing') {
        return null;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('renders the public player route with runtime appearance settings applied', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /duckfeed radio/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByRole('img', { name: /duckfeed/i })[0]).toHaveAttribute(
        'src',
        '/api/site-assets/custom-logo.png',
      );
      expect(document.documentElement.style.getPropertyValue('--site-color-brand')).toBe('17 34 51');
      expect(document.documentElement.style.getPropertyValue('--site-color-container')).toBe('68 85 102');
      expect(document.documentElement.style.getPropertyValue('--site-color-text')).toBe('221 238 255');
      expect([...document.head.querySelectorAll('link[rel="icon"]')]).toHaveLength(2);
      expect(
        [...document.head.querySelectorAll('link[rel="icon"]')].every(
          (node) => node.getAttribute('href') === '/api/site-assets/custom-favicon.png',
        ),
      ).toBe(true);
      expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toHaveAttribute(
        'href',
        '/api/site-assets/custom-favicon.png',
      );
    });
  });

  it('renders the admin login route with the shared runtime branding', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('not logged in'));

    render(
      <MemoryRouter initialEntries={['/admin/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /duckfeed/i })).toHaveAttribute('src', '/api/site-assets/custom-logo.png');
  });

  it('falls back to a light background text color when the chosen text color is unreadable on the page background', async () => {
    getSiteAppearanceMock.mockResolvedValue({
      backgroundColor: '#101820',
      containerColor: '#2e7d32',
      faviconUrl: '/api/site-assets/custom-favicon.png',
      logoUrl: '/api/site-assets/custom-logo.png',
      textColor: '#141413',
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: /duckfeed radio/i });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--site-color-brand-text')).toBe('248 244 232');
    });
  });
});
