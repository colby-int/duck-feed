import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { ValidationError } from '../../lib/errors.js';
import {
  getResolvedSiteSettings,
  replaceSiteAsset,
  updateSiteAppearanceColors,
} from '../../services/site-settings.js';

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

function registerImageParsers(app: FastifyInstance): void {
  app.addContentTypeParser(/^image\/.+$/, { parseAs: 'buffer' }, (_request, body, done) => {
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

function readFilenameHeader(headers: Record<string, string | string[] | undefined>): string {
  const filenameHeader = headers['x-filename'];
  const filename = Array.isArray(filenameHeader) ? filenameHeader[0] : filenameHeader;
  if (!filename) {
    throw new ValidationError('x-filename header is required');
  }

  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
    throw new ValidationError('Invalid upload filename');
  }

  return safeFilename;
}

export async function adminSiteSettingsRoutes(app: FastifyInstance): Promise<void> {
  registerImageParsers(app);

  app.get('/', async () => {
    return {
      data: await getResolvedSiteSettings(),
      error: null,
      meta: null,
    };
  });

  app.patch(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['backgroundColor', 'containerColor', 'textColor'],
          additionalProperties: false,
          properties: {
            backgroundColor: { type: 'string', minLength: 7, maxLength: 7 },
            containerColor: { type: 'string', minLength: 7, maxLength: 7 },
            textColor: { type: 'string', minLength: 7, maxLength: 7 },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as {
        backgroundColor: string;
        containerColor: string;
        textColor: string;
      };
      return {
        data: await updateSiteAppearanceColors(body),
        error: null,
        meta: null,
      };
    },
  );

  app.post(
    '/logo',
    {
      bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
    },
    async (request) => {
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        throw new ValidationError('Upload body must be a binary payload');
      }

      return {
        data: await replaceSiteAsset({
          body,
          contentType: String(request.headers['content-type'] ?? 'application/octet-stream'),
          filename: readFilenameHeader(request.headers),
          kind: 'logo',
        }),
        error: null,
        meta: null,
      };
    },
  );

  app.post(
    '/favicon',
    {
      bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
    },
    async (request) => {
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        throw new ValidationError('Upload body must be a binary payload');
      }

      return {
        data: await replaceSiteAsset({
          body,
          contentType: String(request.headers['content-type'] ?? 'application/octet-stream'),
          filename: readFilenameHeader(request.headers),
          kind: 'favicon',
        }),
        error: null,
        meta: null,
      };
    },
  );
}
