<p align="center">
  <img src="client/public/favicon-96x96.png" width="100" alt="duckfeed logo" />
</p>



# duckfeed 


### a modular & simple stack for streaming audio. 

#### designed for listening to the <a href='https://www.duckradio.live/'> duck! radio </a> archives.

###
<p align="left">
<img src="docs/screenshots/streampage.png" width="450">

###  see a frontend via the demo stream <a href='https://duckfeed.cmr.my'> here.</a>  

## 

- **Modular by design**: run the full stack together, or split the frontend, API, and streaming services as needed. Liquidsoap + Icecast keep serving audio even if the SPA or admin/API layer is unavailable.


- **Frontend player**: public stream page with live now-playing data, play/pause controls, waveform visualiser, next-up queue, stream URL copy, Mixcloud links, and runtime branding support.


- **Admin management**: session-authenticated admin UI for dashboard monitoring, appearance/branding changes, episode editing, ingest uploads and job history, track review, stream queue controls, and integration key management.


- **Ingest + processing**: upload via admin or drop files into the watched dropzone, then copy, normalise, fingerprint, enrich, and prepare audio for the `/library` without mutating source files.


- **Security + auth**: protected `/api/admin/*` routes, hashed-password login, signed sessions, revocable read-only integration API keys, and a self-hosted stack with no required external SaaS.


##

## Stack

- **Backend**: Node.js, TypeScript, Fastify, Drizzle ORM
- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Database**: PostgreSQL 16
- **Streaming**: Liquidsoap + Icecast2
- **Audio tooling**: ffmpeg, fpcalc, AcoustID, MusicBrainz
- **Infra**: Docker Compose, Nginx


## Quick start

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Set a real `SESSION_SECRET` in `.env`:

   ```bash
   openssl rand -hex 32
   ```

3. Start the stack:

   ```bash
   make dev
   ```

4. In another terminal, run the database migration and seed an admin user:

   ```bash
   docker compose exec server npm run db:migrate
   docker compose exec server npx tsx scripts/seed.ts
   ```

5. Open the public player at `http://localhost`, the admin UI at `http://localhost/admin`, and the direct stream at `http://localhost/stream`.

To ingest audio, upload through `/admin/ingest` or copy files into `./volumes/dropzone/`.

To change the station branding at runtime, use `/admin/appearance` to edit the shared background/container/text colors and upload a replacement logo or favicon. Uploaded branding files persist in `./volumes/branding/`.

## Environment

Required in `.env`:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL`
- `SESSION_SECRET`
- `ICECAST_SOURCE_PASSWORD`
- `ICECAST_ADMIN_PASSWORD`

Optional:

- `ACOUSTID_API_KEY` enables fingerprint-based track suggestions.
- `MUSICBRAINZ_CONTACT_URL` sets the public contact URL used in MusicBrainz requests.
- `BRANDING_DIR` overrides where uploaded logo/favicon assets are stored inside the server container.

## Production notes

- `docker-compose.prod.yml` keeps PostgreSQL, the API, and Icecast off public host ports while leaving Nginx on port 80.
- The checked-in Nginx config is intentionally generic and HTTP-only. Keep host-specific TLS and routing in local-only overrides instead of replacing `nginx/conf.d/default.conf`.
- `make build` and `make deploy` automatically include `docker-compose.prod.local.yml` when that file exists.
- For split-origin deployments such as `app`, `api`, and `stream` on separate hosts or subdomains:
  copy `docker-compose.prod.local.example.yml` to `docker-compose.prod.local.yml`, then add the host TLS server blocks under `nginx/conf.d-extra/*.conf`. Both locations stay out of git.
- In split-origin production, set `ICECAST_HOSTNAME` in `.env` to the public stream host and create `client/.env.production` from the example so the SPA uses the public API and stream origins instead of same-origin defaults.
- If the client needs different origins for the API or stream, copy `client/.env.production.example` to `client/.env.production` before building the client image.

## Stream metadata integration API

External sites and apps can query the live stream metadata through revocable read-only API keys.

- Manage keys in the admin UI at `/admin/stream`
- Or use the CLI from the repo root:

```bash
make stream-api-key-list
make stream-api-key-create LABEL="Partner app"
make stream-api-key-revoke ID=<uuid>
```

- Send the key as `Authorization: Bearer <key>`
- Primary endpoint: `GET /api/stream/integration/metadata`
- Focused endpoints:
  - `GET /api/stream/integration/now-playing`
  - `GET /api/stream/integration/queue`

Example:

```bash
curl \
  -H "Authorization: Bearer dfs_your_key_here" \
  http://localhost/api/stream/integration/metadata
```

The combined metadata payload returns `status`, `nowPlaying`, `queue`, and `generatedAt`.

Build and deploy with:

```bash
make build
make deploy
```

If production uses local-only TLS overrides, create them before the first deploy:

```bash
cp docker-compose.prod.local.example.yml docker-compose.prod.local.yml
mkdir -p nginx/conf.d-extra
```

## Common commands

```bash
make dev           # start the full stack in development mode
make stop          # stop development services
make test          # run server and client test suites
make lint          # run lint checks
make typecheck     # run TypeScript checks
make db-migrate    # run pending DB migrations from the host
make stream-api-key-list    # list integration API keys from the running server container
make stream-api-key-create  # create an integration API key
make stream-api-key-revoke  # revoke an integration API key
make backup        # create a PostgreSQL backup
```

## Project layout

- `server/` Fastify API, worker, schema, migrations, tests
  - Note: `server/src/services/mixcloud-validator.ts` is specifically tailored for the Duck Radio use case.
- `client/` React SPA for the public player and admin UI
- `liquidsoap/` stream rotation and queue logic
- `icecast/` Icecast configuration
- `nginx/` reverse-proxy config for the app and stream
- `volumes/` local runtime data for dropzone, processing, library, and uploaded branding assets

## License

MIT
