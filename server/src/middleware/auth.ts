import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from '../services/auth.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { User } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export const SESSION_COOKIE = 'duckfeed_session';

export async function attachUser(request: FastifyRequest): Promise<void> {
  const cookie = request.cookies[SESSION_COOKIE];
  if (!cookie) return;
  const session = await getSession(cookie);
  if (session) {
    request.user = session.user;
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) {
    throw new UnauthorizedError();
  }
}
