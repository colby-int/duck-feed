import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../lib/errors.js';
import {
  authenticateStreamApiKey,
  type StreamApiKeyRecord,
} from '../services/stream-api-keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    streamApiKey?: StreamApiKeyRecord;
  }
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token, extra] = headerValue.trim().split(/\s+/);
  if (!scheme || !token || extra || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

export async function requireStreamApiKey(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    throw new UnauthorizedError('Bearer token required');
  }

  const streamApiKey = await authenticateStreamApiKey(token);
  if (!streamApiKey) {
    throw new UnauthorizedError('Invalid stream API key');
  }

  request.streamApiKey = streamApiKey;
}
