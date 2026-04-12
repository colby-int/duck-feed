// Admin episode CRUD. All routes behind requireAuth (applied at the aggregator).

import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { and, desc, eq, lt, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { episodes, ingestJobs, tracks } from '../../db/schema.js';
import type { Episode } from '../../db/schema.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { tentativeSlug, slugify } from '../../lib/slug.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../lib/pagination.js';
import {
  fingerprintFile,
  persistFingerprintMatches,
  FingerprintingDisabledError,
} from '../../services/fingerprint.js';
import { reconcileMetadata } from '../../services/metadata-reconciler.js';
import { validateMixcloudMetadata } from '../../services/mixcloud-validator.js';

const EPISODE_STATUS = ['pending', 'processing', 'ready', 'error'] as const;

export async function adminEpisodeRoutes(app: FastifyInstance): Promise<void> {
  // === List ===
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
        .select()
        .from(episodes)
        .where(cursor ? lt(episodes.createdAt, cursor) : undefined)
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

  // === Create ===
  app.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            presenter: { type: 'string', minLength: 1, maxLength: 255 },
            slug: { type: 'string', minLength: 1, maxLength: 200 },
            broadcastDate: { type: 'string', format: 'date' },
            description: { type: 'string' },
            mixcloudUrl: { type: 'string', format: 'uri' },
            artworkUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        title: string;
        presenter?: string;
        slug?: string;
        broadcastDate?: string;
        description?: string;
        mixcloudUrl?: string;
        artworkUrl?: string;
      };

      const slug = body.slug ? slugify(body.slug) : tentativeSlug(body.title);
      if (!slug) {
        throw new ConflictError('Slug could not be generated from title');
      }

      // Uniqueness check — the DB also enforces this, but surface a clean 409.
      const [existing] = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.slug, slug))
        .limit(1);
      if (existing) {
        throw new ConflictError(`Episode with slug "${slug}" already exists`);
      }

      const [created] = await db
        .insert(episodes)
        .values({
          title: body.title,
          presenter: body.presenter?.trim() || null,
          slug,
          broadcastDate: body.broadcastDate,
          description: body.description,
          mixcloudUrl: body.mixcloudUrl,
          artworkUrl: body.artworkUrl,
          status: 'pending',
        })
        .returning();

      reply.status(201);
      return { data: created, error: null, meta: null };
    },
  );

  // === Get by id ===
  app.get(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const episode = await findEpisodeById(id);
      const episodeTracks = await db
        .select()
        .from(tracks)
        .where(eq(tracks.episodeId, id))
        .orderBy(asc(tracks.position));
      return {
        data: { ...episode, tracks: episodeTracks },
        error: null,
        meta: null,
      };
    },
  );

  // === Update ===
  app.patch(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            presenter: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
            slug: { type: 'string', minLength: 1, maxLength: 200 },
            broadcastDate: { type: ['string', 'null'], format: 'date' },
            description: { type: ['string', 'null'] },
            mixcloudUrl: { type: ['string', 'null'], format: 'uri' },
            artworkUrl: { type: ['string', 'null'], format: 'uri' },
            status: { type: 'string', enum: EPISODE_STATUS as unknown as string[] },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<{
        title: string;
        presenter: string | null;
        slug: string;
        broadcastDate: string | null;
        description: string | null;
        mixcloudUrl: string | null;
        artworkUrl: string | null;
        status: (typeof EPISODE_STATUS)[number];
      }>;

      const existing = await findEpisodeById(id);

      // If slug changes, enforce uniqueness against other rows.
      let slug = existing.slug;
      if (body.slug && body.slug !== existing.slug) {
        slug = slugify(body.slug);
        const [collision] = await db
          .select({ id: episodes.id })
          .from(episodes)
          .where(and(eq(episodes.slug, slug), eq(episodes.id, id)))
          .limit(1);
        // The above guards "same row" — now check any OTHER row with this slug:
        const [other] = await db
          .select({ id: episodes.id })
          .from(episodes)
          .where(eq(episodes.slug, slug))
          .limit(1);
        if (other && other.id !== id) {
          throw new ConflictError(`Episode with slug "${slug}" already exists`);
        }
        void collision;
      }

      const [updated] = await db
        .update(episodes)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.presenter !== undefined
            ? { presenter: body.presenter?.trim() || null }
            : {}),
          ...(body.slug !== undefined ? { slug } : {}),
          ...(body.broadcastDate !== undefined ? { broadcastDate: body.broadcastDate } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.mixcloudUrl !== undefined ? { mixcloudUrl: body.mixcloudUrl } : {}),
          ...(body.artworkUrl !== undefined ? { artworkUrl: body.artworkUrl } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, id))
        .returning();

      // Return the same shape as GET /:id so the admin UI can replace its
      // local state without losing `tracks` (which would crash the render).
      const episodeTracks = await db
        .select()
        .from(tracks)
        .where(eq(tracks.episodeId, id))
        .orderBy(asc(tracks.position));

      return { data: { ...updated, tracks: episodeTracks }, error: null, meta: null };
    },
  );

  // === Delete ===
  app.delete(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await findEpisodeById(id);

      // Delete the normalised library file so Liquidsoap stops playing it.
      // Best-effort: log if the unlink fails, but still remove the DB row.
      if (existing.filePath) {
        try {
          await fs.unlink(existing.filePath);
          logger.info({ episodeId: id, filePath: existing.filePath }, 'deleted library file');
        } catch (err) {
          logger.warn(
            { err, episodeId: id, filePath: existing.filePath },
            'failed to delete library file (continuing with DB delete)',
          );
        }
      }

      // Tracks cascade via FK. Ingest jobs reference the episode but without cascade,
      // so null out the FK first to keep the job audit trail intact.
      await db.update(ingestJobs).set({ episodeId: null }).where(eq(ingestJobs.episodeId, id));
      await db.delete(episodes).where(eq(episodes.id, id));

      reply.status(204);
      return null;
    },
  );

  // === Reconcile Metadata ===
  app.post(
    '/:id/reconcile',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const episode = await findEpisodeById(id);

      const reconciled = await reconcileMetadata(episode);
      let isValid = false;
      if (reconciled.title) {
        isValid = await validateMixcloudMetadata(reconciled.title);
      }

      await db
        .update(episodes)
        .set({
          title: reconciled.title,
          // Assuming artist might be used later or in a future field
        })
        .where(eq(episodes.id, id));

      return {
        data: { reconciled, isValid },
        error: null,
        meta: null,
      };
    },
  );

  // === Re-trigger fingerprint pipeline ===
  // Manually re-runs AcoustID + MusicBrainz against the normalised library file.
  // Existing acoustid-source tracks are deleted first so re-runs don't duplicate;
  // manual tracks are preserved.
  app.post(
    '/:id/fingerprint',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const episode = await findEpisodeById(id);

      if (episode.status !== 'ready' || !episode.filePath) {
        throw new ConflictError('Episode is not ready for fingerprinting');
      }

      // Drop existing acoustid tracks before re-running so this is idempotent.
      // Manual tracks are left alone — they're operator-curated.
      await db
        .delete(tracks)
        .where(and(eq(tracks.episodeId, id), eq(tracks.source, 'acoustid')));

      let matches;
      try {
        matches = await fingerprintFile(episode.filePath);
      } catch (err) {
        if (err instanceof FingerprintingDisabledError) {
          throw new ConflictError('Fingerprinting is not configured');
        }
        throw err;
      }

      const insertedIds = await persistFingerprintMatches(id, matches);

      logger.info(
        { episodeId: id, matchCount: matches.length, insertedCount: insertedIds.length },
        'fingerprint: manual re-trigger complete',
      );

      return {
        data: { matches, insertedCount: insertedIds.length },
        error: null,
        meta: null,
      };
    },
  );
}

async function findEpisodeById(id: string): Promise<Episode> {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('Episode');
  }
  return row;
}
