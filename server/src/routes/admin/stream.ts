import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { episodes } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import {
  createStreamApiKey,
  listStreamApiKeys,
  revokeStreamApiKey,
} from '../../services/stream-api-keys.js';
import {
  listRotationQueue,
  moveRotationQueueEntryToFront,
  removeRotationQueueEntry,
  shuffleRotationQueue,
} from '../../services/rotation-queue.js';
import {
  getCurrentRequest,
  getQueue,
  pushQueue,
  skipCurrentTrack,
} from '../../services/liquidsoap.js';

export async function adminStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rotation', async () => {
    return {
      data: await listRotationQueue(),
      error: null,
      meta: null,
    };
  });

  app.post(
    '/rotation/shuffle',
    {
      schema: {
        body: {
          type: 'object',
          required: ['count'],
          additionalProperties: false,
          properties: {
            count: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const { count } = request.body as { count: number };
      return {
        data: await shuffleRotationQueue(count),
        error: null,
        meta: null,
      };
    },
  );

  app.post('/rotation/:id/move-to-front', async (request) => {
    const { id } = request.params as { id: string };
    await moveRotationQueueEntryToFront(id);
    return {
      data: await listRotationQueue(),
      error: null,
      meta: null,
    };
  });

  app.delete('/rotation/:id', async (request) => {
    const { id } = request.params as { id: string };
    await removeRotationQueueEntry(id);
    return {
      data: await listRotationQueue(),
      error: null,
      meta: null,
    };
  });

  app.get('/api-keys', async () => {
    return {
      data: await listStreamApiKeys(),
      error: null,
      meta: null,
    };
  });

  app.post(
    '/api-keys',
    {
      schema: {
        body: {
          type: 'object',
          required: ['label'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { label } = request.body as { label: string };
      return {
        data: await createStreamApiKey(label),
        error: null,
        meta: null,
      };
    },
  );

  app.post('/api-keys/:id/revoke', async (request) => {
    const { id } = request.params as { id: string };
    return {
      data: await revokeStreamApiKey(id),
      error: null,
      meta: null,
    };
  });

  app.get('/queue', async () => {
    return {
      data: await getQueue(),
      error: null,
      meta: null,
    };
  });

  app.post(
    '/queue',
    {
      schema: {
        body: {
          type: 'object',
          required: ['episodeId'],
          additionalProperties: false,
          properties: {
            episodeId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request) => {
      const { episodeId } = request.body as { episodeId: string };
      const [episode] = await db
        .select({
          id: episodes.id,
          title: episodes.title,
          slug: episodes.slug,
          filePath: episodes.filePath,
          status: episodes.status,
        })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1);

      if (!episode) {
        throw new NotFoundError('Episode');
      }
      if (episode.status !== 'ready' || !episode.filePath) {
        throw new ConflictError('Only ready episodes with a library file can be queued');
      }

      return {
        data: await pushQueue(episode.filePath),
        error: null,
        meta: null,
      };
    },
  );

  app.post('/skip', async () => {
    return {
      data: await skipCurrentTrack(),
      error: null,
      meta: null,
    };
  });

  /**
   * Restart the currently playing episode from the beginning.
   *
   * Mechanism: ask Liquidsoap which file is currently playing, push that
   * same file onto the request queue, then skip the current track. Because
   * the main source is `fallback([queue, library])` with track-sensitive
   * switching, Liquidsoap will immediately pick up the just-pushed queue
   * entry — which is the same file, played from byte 0.
   */
  app.post('/restart-current', async () => {
    const current = await getCurrentRequest();
    if (!current?.filePath) {
      throw new ConflictError('No current track to restart');
    }

    const filePath = current.filePath;
    const pushResult = await pushQueue(filePath);
    const skipResult = await skipCurrentTrack();

    return {
      data: {
        restartedFilePath: filePath,
        requestId: pushResult.requestId,
        push: pushResult.raw,
        skip: skipResult.raw,
      },
      error: null,
      meta: null,
    };
  });
}
