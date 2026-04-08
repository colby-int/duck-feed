import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { episodes, tracks } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';

export async function adminTrackRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/:episodeId/tracks',
    {
      schema: {
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: { episodeId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const { episodeId } = request.params as { episodeId: string };
      await findEpisodeById(episodeId);

      const rows = await db
        .select()
        .from(tracks)
        .where(eq(tracks.episodeId, episodeId))
        .orderBy(asc(tracks.position));

      return { data: rows, error: null, meta: null };
    },
  );

  app.post(
    '/:episodeId/tracks',
    {
      schema: {
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: { episodeId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            artist: { type: 'string' },
            position: { type: 'integer', minimum: 1 },
            startTimeSeconds: { type: 'integer', minimum: 0 },
            endTimeSeconds: { type: 'integer', minimum: 0 },
            source: { type: 'string' },
            acoustidScore: { type: 'number' },
            musicbrainzId: { type: 'string' },
            reviewed: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const { episodeId } = request.params as { episodeId: string };
      const body = request.body as {
        title: string;
        artist?: string;
        position?: number;
        startTimeSeconds?: number;
        endTimeSeconds?: number;
        source?: string;
        acoustidScore?: number;
        musicbrainzId?: string;
        reviewed?: boolean;
      };

      await findEpisodeById(episodeId);

      const [created] = await db
        .insert(tracks)
        .values({
          episodeId,
          title: body.title,
          artist: body.artist,
          position: body.position,
          startTimeSeconds: body.startTimeSeconds,
          endTimeSeconds: body.endTimeSeconds,
          source: body.source ?? 'manual',
          acoustidScore: body.acoustidScore,
          musicbrainzId: body.musicbrainzId,
          reviewed: body.reviewed ?? false,
        })
        .returning();

      reply.status(201);
      return { data: created, error: null, meta: null };
    },
  );

  app.patch(
    '/:episodeId/tracks/:trackId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['episodeId', 'trackId'],
          properties: {
            episodeId: { type: 'string', format: 'uuid' },
            trackId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            artist: { type: ['string', 'null'] },
            position: { type: ['integer', 'null'], minimum: 1 },
            startTimeSeconds: { type: ['integer', 'null'], minimum: 0 },
            endTimeSeconds: { type: ['integer', 'null'], minimum: 0 },
            source: { type: 'string' },
            acoustidScore: { type: ['number', 'null'] },
            musicbrainzId: { type: ['string', 'null'] },
            reviewed: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { episodeId, trackId } = request.params as { episodeId: string; trackId: string };
      const body = request.body as Partial<{
        title: string;
        artist: string | null;
        position: number | null;
        startTimeSeconds: number | null;
        endTimeSeconds: number | null;
        source: string;
        acoustidScore: number | null;
        musicbrainzId: string | null;
        reviewed: boolean;
      }>;

      await findTrackById(episodeId, trackId);

      const [updated] = await db
        .update(tracks)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.artist !== undefined ? { artist: body.artist } : {}),
          ...(body.position !== undefined ? { position: body.position } : {}),
          ...(body.startTimeSeconds !== undefined ? { startTimeSeconds: body.startTimeSeconds } : {}),
          ...(body.endTimeSeconds !== undefined ? { endTimeSeconds: body.endTimeSeconds } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.acoustidScore !== undefined ? { acoustidScore: body.acoustidScore } : {}),
          ...(body.musicbrainzId !== undefined ? { musicbrainzId: body.musicbrainzId } : {}),
          ...(body.reviewed !== undefined ? { reviewed: body.reviewed } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(tracks.id, trackId), eq(tracks.episodeId, episodeId)))
        .returning();

      return { data: updated, error: null, meta: null };
    },
  );

  app.delete(
    '/:episodeId/tracks/:trackId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['episodeId', 'trackId'],
          properties: {
            episodeId: { type: 'string', format: 'uuid' },
            trackId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, trackId } = request.params as { episodeId: string; trackId: string };
      await findTrackById(episodeId, trackId);
      await db.delete(tracks).where(and(eq(tracks.id, trackId), eq(tracks.episodeId, episodeId)));
      reply.status(204);
      return null;
    },
  );
}

async function findEpisodeById(episodeId: string): Promise<void> {
  const [episode] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  if (!episode) {
    throw new NotFoundError('Episode');
  }
}

async function findTrackById(episodeId: string, trackId: string): Promise<void> {
  const [track] = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.episodeId, episodeId)))
    .limit(1);
  if (!track) {
    throw new NotFoundError('Track');
  }
}
