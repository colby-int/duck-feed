// duckfeed API server entry point.

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { attachUser } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { adminRoutes } from './routes/admin/index.js';
import { publicEpisodeRoutes } from './routes/episodes.js';
import { siteSettingsRoutes } from './routes/site-settings.js';
import { streamRoutes } from './routes/stream.js';
import { startPlaybackLogWriter } from './services/playback-log-writer.js';

async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // Security & infrastructure
  await app.register(helmet);
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (
      request.url.startsWith('/api/') &&
      !reply.hasHeader('Cache-Control') &&
      !reply.getHeader('content-type')?.toString().includes('text/event-stream')
    ) {
      reply.header('Cache-Control', 'no-store, max-age=0');
      reply.header('Pragma', 'no-cache');
    }

    return payload;
  });

  // Attach user from session cookie on every request
  app.addHook('preHandler', attachUser);

  // Error handler
  app.setErrorHandler(errorHandler);

  // Routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(siteSettingsRoutes, { prefix: '/api' });
  await app.register(publicEpisodeRoutes, { prefix: '/api/episodes' });
  await app.register(streamRoutes, { prefix: '/api/stream' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT }, 'API server started');
    // Start the playback-log writer after the HTTP server is listening so we
    // never block startup on a Liquidsoap connectivity hiccup.
    startPlaybackLogWriter();
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
