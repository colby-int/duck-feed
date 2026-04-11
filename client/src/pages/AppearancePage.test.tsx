import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { App } from '../App';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getSiteAppearance: vi.fn(),
    requestData: vi.fn(),
    updateSiteAppearance: vi.fn(),
    uploadSiteFavicon: vi.fn(),
    uploadSiteLogo: vi.fn(),
  };
});

const getCurrentUserMock = vi.mocked(api.getCurrentUser);
const getSiteAppearanceMock = vi.mocked(api.getSiteAppearance);
const updateSiteAppearanceMock = vi.mocked(api.updateSiteAppearance);
const uploadSiteLogoMock = vi.mocked(api.uploadSiteLogo);
const uploadSiteFaviconMock = vi.mocked(api.uploadSiteFavicon);

describe('AppearancePage', () => {
  beforeEach(() => {
    let appearance: api.SiteAppearance = {
      backgroundColor: '#E68E49',
      containerColor: '#2C398C',
      faviconUrl: '/favicon-32x32.png',
      logoUrl: '/logo.png',
      textColor: '#141413',
    };

    getCurrentUserMock.mockReset();
    getSiteAppearanceMock.mockReset();
    updateSiteAppearanceMock.mockReset();
    uploadSiteLogoMock.mockReset();
    uploadSiteFaviconMock.mockReset();

    getCurrentUserMock.mockResolvedValue({
      username: 'admin',
    });
    getSiteAppearanceMock.mockImplementation(async () => appearance);
    updateSiteAppearanceMock.mockImplementation(async (next) => {
        appearance = {
          ...appearance,
          ...next,
        };
        return appearance;
    });
    uploadSiteLogoMock.mockImplementation(async () => {
      appearance = {
        ...appearance,
        logoUrl: '/api/site-assets/fresh-logo.png',
      };
      return appearance;
    });
    uploadSiteFaviconMock.mockImplementation(async () => {
      appearance = {
        ...appearance,
        faviconUrl: '/api/site-assets/fresh-favicon.png',
      };
      return appearance;
    });
  });

  it('loads, updates, and uploads appearance settings from the admin page', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/appearance']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /appearance/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/background color/i), {
      target: { value: '#101820' },
    });
    fireEvent.change(screen.getByLabelText(/container color/i), {
      target: { value: '#2e7d32' },
    });
    fireEvent.change(screen.getByLabelText(/text color/i), {
      target: { value: '#f8f4e8' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save appearance/i }));

    await waitFor(() => {
      expect(updateSiteAppearanceMock).toHaveBeenCalledWith({
        backgroundColor: '#101820',
        containerColor: '#2e7d32',
        textColor: '#f8f4e8',
      });
    });

    const logoFile = new File(['logo'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/logo file/i), {
      target: { files: [logoFile] },
    });
    fireEvent.click(screen.getByRole('button', { name: /upload logo/i }));

    const faviconFile = new File(['favicon'], 'favicon.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/favicon file/i), {
      target: { files: [faviconFile] },
    });
    fireEvent.click(screen.getByRole('button', { name: /upload favicon/i }));

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /current site logo/i })).toHaveAttribute(
        'src',
        '/api/site-assets/fresh-logo.png',
      );
      expect(document.head.querySelector('link[rel="icon"]')).toHaveAttribute(
        'href',
        '/api/site-assets/fresh-favicon.png',
      );
    });
  });
});
