import { createHash, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { streamApiKeys } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export interface StreamApiKeyRecord {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedStreamApiKey {
  key: string;
  record: StreamApiKeyRecord;
}

function hashStreamApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function serializeStreamApiKey(row: {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): StreamApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new ValidationError('Label is required');
  }
  return trimmed;
}

function generateStreamApiKeySecret(): string {
  return `dfs_${randomBytes(24).toString('base64url')}`;
}

export async function listStreamApiKeys(): Promise<StreamApiKeyRecord[]> {
  const rows = await db
    .select({
      id: streamApiKeys.id,
      label: streamApiKeys.label,
      keyPrefix: streamApiKeys.keyPrefix,
      createdAt: streamApiKeys.createdAt,
      lastUsedAt: streamApiKeys.lastUsedAt,
      revokedAt: streamApiKeys.revokedAt,
    })
    .from(streamApiKeys)
    .orderBy(desc(streamApiKeys.createdAt));

  return rows.map(serializeStreamApiKey);
}

export async function createStreamApiKey(label: string): Promise<CreatedStreamApiKey> {
  const normalizedLabel = normalizeLabel(label);
  const key = generateStreamApiKeySecret();
  const now = new Date();
  const [row] = await db
    .insert(streamApiKeys)
    .values({
      label: normalizedLabel,
      keyPrefix: key.slice(0, 12),
      keyHash: hashStreamApiKey(key),
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: streamApiKeys.id,
      label: streamApiKeys.label,
      keyPrefix: streamApiKeys.keyPrefix,
      createdAt: streamApiKeys.createdAt,
      lastUsedAt: streamApiKeys.lastUsedAt,
      revokedAt: streamApiKeys.revokedAt,
    });

  return {
    key,
    record: serializeStreamApiKey(row),
  };
}

export async function revokeStreamApiKey(id: string): Promise<StreamApiKeyRecord> {
  const now = new Date();
  const [row] = await db
    .update(streamApiKeys)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(eq(streamApiKeys.id, id))
    .returning({
      id: streamApiKeys.id,
      label: streamApiKeys.label,
      keyPrefix: streamApiKeys.keyPrefix,
      createdAt: streamApiKeys.createdAt,
      lastUsedAt: streamApiKeys.lastUsedAt,
      revokedAt: streamApiKeys.revokedAt,
    });

  if (!row) {
    throw new NotFoundError('Stream API key');
  }

  return serializeStreamApiKey(row);
}

export async function authenticateStreamApiKey(key: string): Promise<StreamApiKeyRecord | null> {
  const [row] = await db
    .select({
      id: streamApiKeys.id,
      label: streamApiKeys.label,
      keyPrefix: streamApiKeys.keyPrefix,
      createdAt: streamApiKeys.createdAt,
      lastUsedAt: streamApiKeys.lastUsedAt,
      revokedAt: streamApiKeys.revokedAt,
    })
    .from(streamApiKeys)
    .where(eq(streamApiKeys.keyHash, hashStreamApiKey(key)))
    .limit(1);

  if (!row || row.revokedAt) {
    return null;
  }

  const now = new Date();
  await db
    .update(streamApiKeys)
    .set({
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(eq(streamApiKeys.id, row.id));

  return serializeStreamApiKey({
    ...row,
    lastUsedAt: now,
  });
}
