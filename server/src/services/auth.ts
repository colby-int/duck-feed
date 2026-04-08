// Session-based authentication. Bcrypt password hashing.
// Sessions stored in Postgres, identified by an opaque random token in an HttpOnly cookie.

import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, sessions } from '../db/schema.js';
import type { User } from '../db/schema.js';
import { UnauthorizedError } from '../lib/errors.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function verifyCredentials(username: string, password: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user) {
    throw new UnauthorizedError('Invalid username or password');
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid username or password');
  }
  return user;
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function getSession(
  id: string,
): Promise<{ user: User; expiresAt: Date } | null> {
  const [row] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt < new Date()) {
    await deleteSession(id);
    return null;
  }
  return { user: row.user, expiresAt: row.session.expiresAt };
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
