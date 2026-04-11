import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const siteSettingsMock = vi.hoisted(() => ({
  getResolvedSiteSettings: vi.fn(),
  readSiteAsset: vi.fn(),
}));

vi.mock('../../src/services/site-settings.js', () => siteSettingsMock);

describe('public site settings routes', () => {
  beforeEach(() => {
    vi.resetModules();
    siteSettingsMock.getResolvedSiteSettings.mockReset();
    siteSettingsMock.readSiteAsset.mockReset();

    siteSettingsMock.getResolvedSiteSettings.mockResolvedValue({
      backgroundColor: '#112233',
      containerColor: '#445566',
      faviconUrl: '/api/site-assets/custom-favicon.png',
      logoUrl: '/api/site-assets/custom-logo.png',
      textColor: '#778899',
    });
    siteSettingsMock.readSiteAsset.mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      contentType: 'image/png',
    });
  });

  it('returns resolved public appearance settings in the standard API envelope', async () => {
    const { siteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const app = Fastify();
    await app.register(siteSettingsRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/site-settings',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        backgroundColor: '#112233',
        containerColor: '#445566',
        faviconUrl: '/api/site-assets/custom-favicon.png',
        logoUrl: '/api/site-assets/custom-logo.png',
        textColor: '#778899',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('serves uploaded branding assets publicly', async () => {
    const { siteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const app = Fastify();
    await app.register(siteSettingsRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/site-assets/custom-logo.png',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.body).toBe('png-bytes');
    expect(siteSettingsMock.readSiteAsset).toHaveBeenCalledWith('custom-logo.png');

    await app.close();
  });
});
