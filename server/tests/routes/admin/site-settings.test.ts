import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const siteSettingsMock = vi.hoisted(() => ({
  getResolvedSiteSettings: vi.fn(),
  replaceSiteAsset: vi.fn(),
  updateSiteAppearanceColors: vi.fn(),
}));

vi.mock('../../../src/services/site-settings.js', () => siteSettingsMock);

describe('admin site settings routes', () => {
  beforeEach(() => {
    vi.resetModules();
    siteSettingsMock.getResolvedSiteSettings.mockReset();
    siteSettingsMock.updateSiteAppearanceColors.mockReset();
    siteSettingsMock.replaceSiteAsset.mockReset();

    siteSettingsMock.getResolvedSiteSettings.mockResolvedValue({
      backgroundColor: '#E68E49',
      containerColor: '#2C398C',
      faviconUrl: '/favicon-32x32.png',
      logoUrl: '/logo.png',
      textColor: '#141413',
    });
    siteSettingsMock.updateSiteAppearanceColors.mockResolvedValue({
      backgroundColor: '#101820',
      containerColor: '#2E7D32',
      faviconUrl: '/favicon-32x32.png',
      logoUrl: '/logo.png',
      textColor: '#F8F4E8',
    });
    siteSettingsMock.replaceSiteAsset.mockResolvedValue({
      backgroundColor: '#101820',
      containerColor: '#2E7D32',
      faviconUrl: '/api/site-assets/custom-favicon.png',
      logoUrl: '/api/site-assets/custom-logo.png',
      textColor: '#F8F4E8',
    });
  });

  it('returns the current appearance settings', async () => {
    const { adminSiteSettingsRoutes } = await import('../../../src/routes/admin/site-settings.js');
    const app = Fastify();
    await app.register(adminSiteSettingsRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        backgroundColor: '#E68E49',
        containerColor: '#2C398C',
        faviconUrl: '/favicon-32x32.png',
        logoUrl: '/logo.png',
        textColor: '#141413',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('updates the editable appearance colors', async () => {
    const { adminSiteSettingsRoutes } = await import('../../../src/routes/admin/site-settings.js');
    const app = Fastify();
    await app.register(adminSiteSettingsRoutes);

    const response = await app.inject({
      method: 'PATCH',
      payload: {
        backgroundColor: '#101820',
        containerColor: '#2E7D32',
        textColor: '#F8F4E8',
      },
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(siteSettingsMock.updateSiteAppearanceColors).toHaveBeenCalledWith({
      backgroundColor: '#101820',
      containerColor: '#2E7D32',
      textColor: '#F8F4E8',
    });
    expect(response.json()).toEqual({
      data: {
        backgroundColor: '#101820',
        containerColor: '#2E7D32',
        faviconUrl: '/favicon-32x32.png',
        logoUrl: '/logo.png',
        textColor: '#F8F4E8',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('stores a replacement logo upload', async () => {
    const { adminSiteSettingsRoutes } = await import('../../../src/routes/admin/site-settings.js');
    const app = Fastify();
    await app.register(adminSiteSettingsRoutes);

    const response = await app.inject({
      body: Buffer.from('logo-bytes'),
      headers: {
        'content-type': 'image/png',
        'x-filename': 'new-logo.png',
      },
      method: 'POST',
      url: '/logo',
    });

    expect(response.statusCode).toBe(200);
    expect(siteSettingsMock.replaceSiteAsset).toHaveBeenCalledWith({
      body: Buffer.from('logo-bytes'),
      contentType: 'image/png',
      filename: 'new-logo.png',
      kind: 'logo',
    });
    expect(response.json()).toEqual({
      data: {
        backgroundColor: '#101820',
        containerColor: '#2E7D32',
        faviconUrl: '/api/site-assets/custom-favicon.png',
        logoUrl: '/api/site-assets/custom-logo.png',
        textColor: '#F8F4E8',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('stores a replacement favicon upload', async () => {
    const { adminSiteSettingsRoutes } = await import('../../../src/routes/admin/site-settings.js');
    const app = Fastify();
    await app.register(adminSiteSettingsRoutes);

    const response = await app.inject({
      body: Buffer.from('favicon-bytes'),
      headers: {
        'content-type': 'image/png',
        'x-filename': 'favicon.png',
      },
      method: 'POST',
      url: '/favicon',
    });

    expect(response.statusCode).toBe(200);
    expect(siteSettingsMock.replaceSiteAsset).toHaveBeenCalledWith({
      body: Buffer.from('favicon-bytes'),
      contentType: 'image/png',
      filename: 'favicon.png',
      kind: 'favicon',
    });

    await app.close();
  });
});
