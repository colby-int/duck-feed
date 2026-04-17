import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { liveScheduleEntry, liveSource } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { refreshLiveSnapshot } from '../../services/live-supervisor.js';

const DAY_MIN = 1;
const DAY_MAX = 7;
const MINUTE_MIN = 0;
const MINUTE_MAX = 1440;

function validateWindow(startMinute: number, endMinute: number): void {
  if (startMinute < MINUTE_MIN || startMinute >= MINUTE_MAX) {
    throw new ValidationError('startMinute must be in 0..1439');
  }
  if (endMinute <= MINUTE_MIN || endMinute > MINUTE_MAX) {
    throw new ValidationError('endMinute must be in 1..1440');
  }
  if (endMinute <= startMinute) {
    throw new ValidationError('endMinute must be greater than startMinute');
  }
}

function validateDayOfWeek(dayOfWeek: number): void {
  if (dayOfWeek < DAY_MIN || dayOfWeek > DAY_MAX) {
    throw new ValidationError('dayOfWeek must be 1 (Mon) through 7 (Sun)');
  }
}

function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new ValidationError('url must be a valid http(s) URL');
  }
}

async function ensureLiveSource(): Promise<void> {
  // Guarantee exactly one row exists (id=1) so PUT can always upsert.
  await db
    .insert(liveSource)
    .values({ id: 1 })
    .onConflictDoNothing({ target: liveSource.id });
}

export async function adminLiveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live-source', async () => {
    await ensureLiveSource();
    const [row] = await db.select().from(liveSource).limit(1);
    return { data: row ?? null, error: null, meta: null };
  });

  app.put(
    '/live-source',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: ['string', 'null'] },
            displayName: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as {
        url?: string | null;
        displayName?: string | null;
      };

      if (typeof body.url === 'string' && body.url.length > 0) {
        validateUrl(body.url);
      }

      await ensureLiveSource();
      const [updated] = await db
        .update(liveSource)
        .set({
          url: body.url === undefined ? sql`"url"` : body.url,
          displayName:
            body.displayName === undefined ? sql`"display_name"` : body.displayName,
          updatedAt: new Date(),
        })
        .where(eq(liveSource.id, 1))
        .returning();

      await refreshLiveSnapshot();
      return { data: updated, error: null, meta: null };
    },
  );

  app.get('/live-schedule', async () => {
    const rows = await db.select().from(liveScheduleEntry);
    return { data: rows, error: null, meta: null };
  });

  app.post(
    '/live-schedule',
    {
      schema: {
        body: {
          type: 'object',
          required: ['dayOfWeek', 'startMinute', 'endMinute'],
          additionalProperties: false,
          properties: {
            dayOfWeek: { type: 'integer', minimum: DAY_MIN, maximum: DAY_MAX },
            startMinute: { type: 'integer', minimum: MINUTE_MIN, maximum: MINUTE_MAX - 1 },
            endMinute: { type: 'integer', minimum: MINUTE_MIN + 1, maximum: MINUTE_MAX },
            enabled: { type: 'boolean' },
            note: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as {
        dayOfWeek: number;
        startMinute: number;
        endMinute: number;
        enabled?: boolean;
        note?: string | null;
      };
      validateDayOfWeek(body.dayOfWeek);
      validateWindow(body.startMinute, body.endMinute);

      const [inserted] = await db
        .insert(liveScheduleEntry)
        .values({
          dayOfWeek: body.dayOfWeek,
          startMinute: body.startMinute,
          endMinute: body.endMinute,
          enabled: body.enabled ?? true,
          note: body.note ?? null,
        })
        .returning();

      await refreshLiveSnapshot();
      return { data: inserted, error: null, meta: null };
    },
  );

  app.patch(
    '/live-schedule/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dayOfWeek: { type: 'integer', minimum: DAY_MIN, maximum: DAY_MAX },
            startMinute: { type: 'integer', minimum: MINUTE_MIN, maximum: MINUTE_MAX - 1 },
            endMinute: { type: 'integer', minimum: MINUTE_MIN + 1, maximum: MINUTE_MAX },
            enabled: { type: 'boolean' },
            note: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<{
        dayOfWeek: number;
        startMinute: number;
        endMinute: number;
        enabled: boolean;
        note: string | null;
      }>;

      const [existing] = await db
        .select()
        .from(liveScheduleEntry)
        .where(eq(liveScheduleEntry.id, id))
        .limit(1);
      if (!existing) {
        throw new NotFoundError('Live schedule entry');
      }

      const merged = {
        dayOfWeek: body.dayOfWeek ?? existing.dayOfWeek,
        startMinute: body.startMinute ?? existing.startMinute,
        endMinute: body.endMinute ?? existing.endMinute,
      };
      validateDayOfWeek(merged.dayOfWeek);
      validateWindow(merged.startMinute, merged.endMinute);

      const [updated] = await db
        .update(liveScheduleEntry)
        .set({
          ...merged,
          enabled: body.enabled ?? existing.enabled,
          note: body.note === undefined ? existing.note : body.note,
          updatedAt: new Date(),
        })
        .where(eq(liveScheduleEntry.id, id))
        .returning();

      await refreshLiveSnapshot();
      return { data: updated, error: null, meta: null };
    },
  );

  app.delete('/live-schedule/:id', async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await db
      .delete(liveScheduleEntry)
      .where(eq(liveScheduleEntry.id, id))
      .returning();
    if (deleted.length === 0) {
      throw new NotFoundError('Live schedule entry');
    }

    await refreshLiveSnapshot();
    return { data: { id }, error: null, meta: null };
  });
}
