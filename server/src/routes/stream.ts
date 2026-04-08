import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireStreamApiKey } from '../middleware/stream-api-auth.js';
import {
  getCurrentNowPlaying,
  getIntegrationStreamMetadata,
  getStreamQueue,
  getStreamStatus,
} from '../services/stream-state.js';

function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function getPublicStreamSseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  };
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async () => {
    return {
      data: await getStreamStatus(),
      error: null,
      meta: null,
    };
  });

  app.get('/now-playing', async () => {
    return {
      data: await getCurrentNowPlaying(),
      error: null,
      meta: null,
    };
  });

  app.get('/events', async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, getPublicStreamSseHeaders());

    const publish = async (): Promise<void> => {
      writeSseEvent(reply, 'stream-status', await getStreamStatus());
      writeSseEvent(reply, 'now-playing', await getCurrentNowPlaying());
    };

    await publish();
    const interval = setInterval(() => {
      void publish();
    }, 15_000);

    reply.raw.on('close', () => {
      clearInterval(interval);
      reply.raw.end();
    });
  });

  await app.register(
    async (integrationApp) => {
      integrationApp.addHook('preHandler', requireStreamApiKey);

      integrationApp.get('/metadata', async () => {
        return {
          data: await getIntegrationStreamMetadata(),
          error: null,
          meta: null,
        };
      });

      integrationApp.get('/now-playing', async () => {
        return {
          data: await getCurrentNowPlaying(),
          error: null,
          meta: null,
        };
      });

      integrationApp.get('/queue', async () => {
        return {
          data: await getStreamQueue(),
          error: null,
          meta: null,
        };
      });
    },
    { prefix: '/integration' },
  );
}
