// Admin playback log route. Exposes the recorded episode-transition history
// from the playback_log table, paginated by started_at desc.

import type { FastifyInstance } from 'fastify';
import { desc, eq, lt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { episodes, playbackLog } from '../../db/schema.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../lib/pagination.js';

export async function adminPlaybackRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/log',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { cursor?: string; limit?: number };
      const limit = parseLimit(q.limit);
      const cursor = decodeCursor(q.cursor);

      const rows = await db
        .select({
          id: playbackLog.id,
          startedAt: playbackLog.startedAt,
          endedAt: playbackLog.endedAt,
          listenerPeak: playbackLog.listenerPeak,
          listenerSamples: playbackLog.listenerSamples,
          listenerTotal: playbackLog.listenerTotal,
          rotationOutcome: playbackLog.rotationOutcome,
          episodeId: episodes.id,
          episodeTitle: episodes.title,
          episodeSlug: episodes.slug,
        })
        .from(playbackLog)
        .innerJoin(episodes, eq(episodes.id, playbackLog.episodeId))
        .where(cursor ? lt(playbackLog.startedAt, cursor) : undefined)
        .orderBy(desc(playbackLog.startedAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && items.length > 0
          ? encodeCursor(items[items.length - 1]!.startedAt)
          : null;

      return {
        data: items,
        error: null,
        meta: { limit, nextCursor, hasMore },
      };
    },
  );
}
