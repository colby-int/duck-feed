import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  date,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// === Episodes ===
export const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  presenter: text('presenter'),
  slug: text('slug').notNull().unique(),
  broadcastDate: date('broadcast_date'),
  description: text('description'),
  durationSeconds: integer('duration_seconds'),
  filePath: text('file_path'), // path within /library
  originalFilename: text('original_filename'),
  mixcloudUrl: text('mixcloud_url'),
  artworkUrl: text('artwork_url'),
  status: text('status').notNull().default('pending'),
  // status values: pending | processing | ready | error
  autoQueuedAt: timestamp('auto_queued_at', { withTimezone: true }),
  autoQueueRequestId: text('auto_queue_request_id'),
  loudnessLufs: real('loudness_lufs'),
  fileHash: text('file_hash'), // SHA-256 of normalised file
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Tracks ===
export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  episodeId: uuid('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  title: text('title'),
  artist: text('artist'),
  position: integer('position'),
  startTimeSeconds: integer('start_time_seconds'),
  endTimeSeconds: integer('end_time_seconds'),
  source: text('source').notNull().default('manual'),
  // source values: manual | acoustid | imported
  acoustidScore: real('acoustid_score'),
  musicbrainzId: text('musicbrainz_id'),
  reviewed: boolean('reviewed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Playback Log ===
export const playbackLog = pgTable('playback_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  episodeId: uuid('episode_id')
    .notNull()
    .references(() => episodes.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  listenerPeak: integer('listener_peak'),
  listenerTotal: integer('listener_total'),
  listenerSamples: integer('listener_samples'),
  rotationOutcome: text('rotation_outcome'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Rotation Queue ===
export const rotationQueueEntries = pgTable('rotation_queue_entries', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  episodeId: uuid('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  source: text('source').notNull().default('auto'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Ingest Jobs ===
export const ingestJobs = pgTable('ingest_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  episodeId: uuid('episode_id').references(() => episodes.id),
  status: text('status').notNull().default('queued'),
  // status values: queued | copying | normalising | fingerprinting | complete | failed
  sourcePath: text('source_path').notNull(),
  sourceHash: text('source_hash'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Users (admin) ===
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Sessions ===
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // secure random token
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Stream API Keys ===
export const streamApiKeys = pgTable('stream_api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  label: text('label').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Site Settings ===
export const siteSettings = pgTable('site_settings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  backgroundColor: text('background_color'),
  containerColor: text('container_color'),
  textColor: text('text_color'),
  logoAssetPath: text('logo_asset_path'),
  faviconAssetPath: text('favicon_asset_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === Relations ===
export const episodesRelations = relations(episodes, ({ many }) => ({
  tracks: many(tracks),
  playbackLog: many(playbackLog),
  rotationQueueEntries: many(rotationQueueEntries),
  ingestJobs: many(ingestJobs),
}));

export const tracksRelations = relations(tracks, ({ one }) => ({
  episode: one(episodes, {
    fields: [tracks.episodeId],
    references: [episodes.id],
  }),
}));

export const playbackLogRelations = relations(playbackLog, ({ one }) => ({
  episode: one(episodes, {
    fields: [playbackLog.episodeId],
    references: [episodes.id],
  }),
}));

export const rotationQueueEntriesRelations = relations(rotationQueueEntries, ({ one }) => ({
  episode: one(episodes, {
    fields: [rotationQueueEntries.episodeId],
    references: [episodes.id],
  }),
}));

export const ingestJobsRelations = relations(ingestJobs, ({ one }) => ({
  episode: one(episodes, {
    fields: [ingestJobs.episodeId],
    references: [episodes.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// === Inferred types ===
export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type PlaybackLogEntry = typeof playbackLog.$inferSelect;
export type NewPlaybackLogEntry = typeof playbackLog.$inferInsert;
export type RotationQueueEntry = typeof rotationQueueEntries.$inferSelect;
export type NewRotationQueueEntry = typeof rotationQueueEntries.$inferInsert;
export type IngestJob = typeof ingestJobs.$inferSelect;
export type NewIngestJob = typeof ingestJobs.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type StreamApiKey = typeof streamApiKeys.$inferSelect;
export type NewStreamApiKey = typeof streamApiKeys.$inferInsert;
export type SiteSettings = typeof siteSettings.$inferSelect;
export type NewSiteSettings = typeof siteSettings.$inferInsert;
