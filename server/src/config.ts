// Environment configuration with startup validation.
// Fails fast if required variables are missing.

interface Config {
  ICECAST_ADMIN_PASSWORD: string | null;
  ICECAST_ADMIN_USERNAME: string;
  ICECAST_HOST: string;
  ICECAST_PORT: number;
  DUCKHAUS_API_TOKEN: string | null;
  DUCKHAUS_BASE_URL: string | null;
  ROTATION_CACHE_MAX_BYTES: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  LOG_LEVEL: string;
  PORT: number;
  INGEST_MAX_CONCURRENCY: number;
  LIQUIDSOAP_TELNET_HOST: string;
  LIQUIDSOAP_TELNET_PORT: number;
  ACOUSTID_API_KEY: string | null;
  MUSICBRAINZ_CONTACT_URL: string;
  MIXCLOUD_USER_URL: string;
  METADATA_RECOVERY_INTERVAL_MS: number;
  LIBRARY_DIR: string;
  DROPZONE_DIR: string;
  PROCESSING_DIR: string;
  QUARANTINE_DIR: string;
  BRANDING_DIR: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function intEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer for env var ${name}: ${value}`);
  }
  return parsed;
}

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = intEnv(name, fallback);
  if (parsed < 1) {
    throw new Error(`Invalid positive integer for env var ${name}: ${parsed}`);
  }
  return parsed;
}

export const config: Config = {
  ICECAST_ADMIN_PASSWORD: process.env.ICECAST_ADMIN_PASSWORD ?? null,
  ICECAST_ADMIN_USERNAME: optional('ICECAST_ADMIN_USERNAME', 'admin'),
  ICECAST_HOST: optional('ICECAST_HOST', 'icecast'),
  ICECAST_PORT: intEnv('ICECAST_PORT', 8000),
  DUCKHAUS_API_TOKEN: process.env.DUCKHAUS_API_TOKEN ?? null,
  DUCKHAUS_BASE_URL: process.env.DUCKHAUS_BASE_URL ?? null,
  ROTATION_CACHE_MAX_BYTES: positiveIntEnv('ROTATION_CACHE_MAX_BYTES', 3_500_000_000),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
  PORT: intEnv('PORT', 3000),
  INGEST_MAX_CONCURRENCY: positiveIntEnv('INGEST_MAX_CONCURRENCY', 1),
  LIQUIDSOAP_TELNET_HOST: optional('LIQUIDSOAP_TELNET_HOST', 'liquidsoap'),
  LIQUIDSOAP_TELNET_PORT: intEnv('LIQUIDSOAP_TELNET_PORT', 1234),
  ACOUSTID_API_KEY: process.env.ACOUSTID_API_KEY ?? null,
  MUSICBRAINZ_CONTACT_URL: optional(
    'MUSICBRAINZ_CONTACT_URL',
    'https://github.com/your-username/duck-feed',
  ),
  MIXCLOUD_USER_URL: optional('MIXCLOUD_USER_URL', 'https://www.mixcloud.com/duckradio/'),
  METADATA_RECOVERY_INTERVAL_MS: positiveIntEnv('METADATA_RECOVERY_INTERVAL_MS', 3_600_000),
  LIBRARY_DIR: optional('LIBRARY_DIR', '/var/lib/duckfeed/library'),
  DROPZONE_DIR: optional('DROPZONE_DIR', '/var/lib/duckfeed/dropzone'),
  PROCESSING_DIR: optional('PROCESSING_DIR', '/var/lib/duckfeed/processing'),
  QUARANTINE_DIR: optional('QUARANTINE_DIR', '/var/lib/duckfeed/quarantine'),
  BRANDING_DIR: optional('BRANDING_DIR', '/var/lib/duckfeed/branding'),
};
