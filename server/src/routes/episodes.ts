import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes, tracks } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { decodeCursor, encodeCursor, parseLimit } from '../lib/pagination.js';

export async function publicEpisodeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
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
          id: episodes.id,
          title: episodes.title,
          presenter: episodes.presenter,
          slug: episodes.slug,
          artworkUrl: episodes.artworkUrl,
          broadcastDate: episodes.broadcastDate,
          description: episodes.description,
          durationSeconds: episodes.durationSeconds,
          mixcloudUrl: episodes.mixcloudUrl,
          createdAt: episodes.createdAt,
        })
        .from(episodes)
        .where(
          and(
            eq(episodes.status, 'ready'),
            cursor ? lt(episodes.createdAt, cursor) : undefined,
          ),
        )
        .orderBy(desc(episodes.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!.createdAt) : null;

      return {
        data: items,
        error: null,
        meta: { limit, nextCursor, hasMore },
      };
    },
  );

  app.get(
    '/:slug',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug'],
          properties: {
            slug: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const [episode] = await db
        .select({
          id: episodes.id,
          title: episodes.title,
          presenter: episodes.presenter,
          slug: episodes.slug,
          artworkUrl: episodes.artworkUrl,
          broadcastDate: episodes.broadcastDate,
          description: episodes.description,
          durationSeconds: episodes.durationSeconds,
          mixcloudUrl: episodes.mixcloudUrl,
          createdAt: episodes.createdAt,
        })
        .from(episodes)
        .where(and(eq(episodes.slug, slug), eq(episodes.status, 'ready')))
        .limit(1);

      if (!episode) {
        throw new NotFoundError('Episode');
      }

      const episodeTracks = await db
        .select({
          id: tracks.id,
          episodeId: tracks.episodeId,
          title: tracks.title,
          artist: tracks.artist,
          position: tracks.position,
        })
        .from(tracks)
        .where(eq(tracks.episodeId, episode.id))
        .orderBy(asc(tracks.position));

      return {
        data: { ...episode, tracks: episodeTracks },
        error: null,
        meta: null,
      };
    },
  );
}
