# Duck Feed Overview

Duck Feed is a self-hosted radio stack for the Duck Radio archive. It combines:

1. 24/7 streaming through Liquidsoap and Icecast.
2. A Fastify API and React SPA for public listening, administration, and metadata.
3. Two content pipelines: local ingest and optional Duckhaus sync/cache.

## Service Topology

### Duck Feed stack

- `postgres`: stores episodes, tracks, playback history, auth, appearance settings, stream API keys, and live schedule state.
- `server`: serves the API and runs the stream poller, playback log writer, and live-source supervisor.
- `ingest-worker`: handles file ingest, normalization, validation, fingerprinting, publishing, and rotation management.
- `metadata-worker`: repairs and backfills episode metadata from Mixcloud's JSON API.
- `client`: serves the public player and admin UI.
- `liquidsoap`: manages archive playback, queued requests, and live-source switching.
- `icecast`: publishes the audio stream.
- `nginx`: acts as the edge proxy for app, API, and stream traffic.

### Optional Duckhaus integration

Duckhaus is an upstream archive service that can:

- discover new Mixcloud episodes
- download raw audio
- prepare broadcast-ready MP3s
- maintain a catalog of prepared episodes
- serve authenticated catalog and file endpoints to trusted consumers

Duck Feed uses Duckhaus only when the relevant integration environment variables are configured.

## Stream Modes

Duck Feed supports three stream states:

- `archive`: Liquidsoap plays queued requests first, then library audio from local storage.
- `live`: the server evaluates a weekly Adelaide-time schedule and instructs Liquidsoap to relay an external live source.
- `offline`: the API reports Liquidsoap as unreachable.

Archive playback is disk-first and remains independent of the database and API once audio is present locally. Live-source switching is coordinated by the API process.

## Content Sources

### Local ingest

- audio can arrive through the admin upload flow or the watched dropzone
- source files are copied before processing
- the worker normalizes, validates, fingerprints, and publishes stream-ready audio to the local library
- successful ingests are eligible for immediate queueing and later rotation

### Optional Duckhaus sync and cache

- the rotation manager syncs Duckhaus catalog metadata into Postgres
- episodes can exist in the database before their audio is cached locally
- prepared audio is downloaded on demand when needed for playback
- cached audio is pruned to stay within a configured byte budget

Duck Feed therefore works as a local ingest system, a Duckhaus-backed hot cache, or both at the same time.

## Core Data Model

The primary tables are:

- `episodes`
- `tracks`
- `playback_log`
- `rotation_queue_entries`
- `ingest_jobs`
- `users`
- `sessions`
- `stream_api_keys`
- `live_source`
- `live_schedule_entry`
- `site_settings`

Two architectural details matter:

- episode rows can exist without a locally cached audio file
- rotation, playback history, and ingest state are all tracked independently in the database

## Public, Admin, and Integration Surfaces

### Public API and player

- `/`
- `/api/episodes`
- `/api/site-settings`
- `/api/site-assets/:filename`
- `/api/stream`
- `/api/stream/status`
- `/api/stream/now-playing`
- `/api/stream/events`

### Admin API and UI

- `/admin/*`
- `/api/auth/*`
- `/api/admin/episodes*`
- `/api/admin/ingest*`
- `/api/admin/stream*`
- `/api/admin/playback*`
- `/api/admin/site-settings*`
- `/api/admin/live-source`
- `/api/admin/live-schedule`

### Read-only integration API

- `/api/stream/integration/metadata`
- `/api/stream/integration/now-playing`
- `/api/stream/integration/queue`

## Lasting Constraints

1. Stream delivery is primary: Liquidsoap and Icecast must keep archive audio on air even if the API, UI, or database is unhealthy.
2. Source files are immutable: ingest always copies before processing.
3. Frontend failure is isolated from stream delivery.
4. Duckhaus is optional: Duck Feed remains usable with local ingest alone.
5. Edge routing can be split across app, API, and stream origins through local-only deployment overrides.
