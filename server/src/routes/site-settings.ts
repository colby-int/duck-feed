import type { FastifyInstance } from 'fastify';
import { getResolvedSiteSettings, readSiteAsset } from '../services/site-settings.js';

export async function siteSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/site-settings', async () => {
    return {
      data: await getResolvedSiteSettings(),
      error: null,
      meta: null,
    };
  });

  app.get('/site-assets/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const asset = await readSiteAsset(filename);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.type(asset.contentType);
    return asset.buffer;
  });
}
