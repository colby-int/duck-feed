import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { adminEpisodeRoutes } from './episodes.js';
import { adminIngestRoutes } from './ingest.js';
import { adminPlaybackRoutes } from './playback.js';
import { adminSiteSettingsRoutes } from './site-settings.js';
import { adminStreamRoutes } from './stream.js';
import { adminTrackRoutes } from './tracks.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  await app.register(adminEpisodeRoutes, { prefix: '/episodes' });
  await app.register(adminTrackRoutes, { prefix: '/episodes' });
  await app.register(adminIngestRoutes, { prefix: '/ingest' });
  await app.register(adminSiteSettingsRoutes, { prefix: '/site-settings' });
  await app.register(adminStreamRoutes, { prefix: '/stream' });
  await app.register(adminPlaybackRoutes, { prefix: '/playback' });
}
