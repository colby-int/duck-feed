import type { FastifyInstance } from 'fastify';
import { verifyCredentials, createSession, deleteSession } from '../services/auth.js';
import { SESSION_COOKIE, requireAuth } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const user = await verifyCredentials(username, password);
      const session = await createSession(user.id);

      reply.setCookie(SESSION_COOKIE, session.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: session.expiresAt,
      });

      return {
        data: { username: user.username },
        error: null,
        meta: null,
      };
    },
  );

  app.post('/logout', async (request, reply) => {
    const cookie = request.cookies[SESSION_COOKIE];
    if (cookie) {
      await deleteSession(cookie);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { data: { ok: true }, error: null, meta: null };
  });

  app.get(
    '/me',
    { preHandler: requireAuth },
    async (request) => {
      return {
        data: { username: request.user!.username },
        error: null,
        meta: null,
      };
    },
  );
}
