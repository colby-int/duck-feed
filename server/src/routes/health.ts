import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const checks: Record<string, { ok: boolean; error?: string }> = {
      api: { ok: true },
      database: { ok: false },
    };

    try {
      await db.execute(sql`SELECT 1`);
      checks.database.ok = true;
    } catch (err) {
      checks.database.error = err instanceof Error ? err.message : String(err);
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return {
      data: { status: allOk ? 'ok' : 'degraded', checks },
      error: null,
      meta: null,
    };
  });
}
