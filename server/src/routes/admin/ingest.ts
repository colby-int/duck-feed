import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { desc, eq, lt } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { episodes, ingestJobs } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../lib/pagination.js';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function registerBinaryParsers(app: FastifyInstance): void {
  app.addContentTypeParser(/^audio\/.+$/, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );
}

export async function adminIngestRoutes(app: FastifyInstance): Promise<void> {
  registerBinaryParsers(app);

  app.get(
    '/jobs',
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
          id: ingestJobs.id,
          episodeId: ingestJobs.episodeId,
          status: ingestJobs.status,
          sourcePath: ingestJobs.sourcePath,
          sourceHash: ingestJobs.sourceHash,
          errorMessage: ingestJobs.errorMessage,
          startedAt: ingestJobs.startedAt,
          completedAt: ingestJobs.completedAt,
          createdAt: ingestJobs.createdAt,
          episodeTitle: episodes.title,
          episodePresenter: episodes.presenter,
          episodeSlug: episodes.slug,
        })
        .from(ingestJobs)
        .leftJoin(episodes, eq(episodes.id, ingestJobs.episodeId))
        .where(cursor ? lt(ingestJobs.createdAt, cursor) : undefined)
        .orderBy(desc(ingestJobs.createdAt))
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

  app.post(
    '/upload',
    {
      bodyLimit: MAX_UPLOAD_BYTES,
    },
    async (request, reply) => {
      const filenameHeader = request.headers['x-filename'];
      const filename = Array.isArray(filenameHeader) ? filenameHeader[0] : filenameHeader;
      if (!filename) {
        throw new ValidationError('x-filename header is required');
      }

      const safeFilename = path.basename(filename);
      if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
        throw new ValidationError('Invalid upload filename');
      }

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new ValidationError('Upload body must be a non-empty binary payload');
      }

      const destination = path.join(config.DROPZONE_DIR, safeFilename);
      await fs.mkdir(config.DROPZONE_DIR, { recursive: true });

      try {
        await fs.access(destination);
        throw new ConflictError(`A dropzone file named "${safeFilename}" already exists`);
      } catch (error) {
        if (!(error instanceof Error) || 'code' in error === false || error.code !== 'ENOENT') {
          if (error instanceof ConflictError) {
            throw error;
          }
        }
      }

      await fs.writeFile(destination, body);

      reply.status(202);
      return {
        data: {
          filename: safeFilename,
          path: destination,
        },
        error: null,
        meta: null,
      };
    },
  );
}
