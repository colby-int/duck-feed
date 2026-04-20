/**
 * One-shot importer: read distinct presenters and (title, presenter) pairs from
 * the duckfeed episodes table and upsert matching rows into the CMS `presenters`
 * and `shows` collections. Idempotent — reruns only insert missing rows.
 *
 * Intent: the CMS owns editorial overlays (bio, photo, description); the episode
 * list on a show page should still be joined at render time from duckfeed.
 *
 *   npm --prefix cms run seed:shows
 */

import { config as loadEnv } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPayload } from 'payload'
import { Pool } from 'pg'

import payloadConfig from '../src/payload.config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
loadEnv({ path: path.resolve(dirname, '../.env') })

const DUCKFEED_URL =
  process.env.DUCKFEED_DATABASE_URL ||
  'postgresql://duckfeed:changeme@localhost:5432/duckfeed'

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

type EpisodeRow = {
  title: string
  presenter: string | null
  broadcast_date: string | null
  description: string | null
  artwork_url: string | null
}

async function main() {
  const pool = new Pool({ connectionString: DUCKFEED_URL })
  const payload = await getPayload({ config: await payloadConfig })

  const { rows } = await pool.query<EpisodeRow>(
    `SELECT title, presenter, broadcast_date::text, description, artwork_url
     FROM episodes
     WHERE status = 'ready'
     ORDER BY broadcast_date DESC NULLS LAST, title`,
  )
  console.log(`duckfeed: ${rows.length} ready episodes`)

  // 1. Presenters — unique by name
  const presenterNames = Array.from(
    new Set(
      rows
        .map((r) => (r.presenter ?? '').trim())
        .filter((n) => n.length > 0),
    ),
  )
  const presenterIdBySlug = new Map<string, string | number>()

  for (const name of presenterNames) {
    const slug = slugify(name)
    const existing = await payload.find({
      collection: 'presenters',
      where: { slug: { equals: slug } },
      limit: 1,
    })
    if (existing.docs[0]) {
      presenterIdBySlug.set(slug, existing.docs[0].id)
      continue
    }
    const doc = await payload.create({
      collection: 'presenters',
      data: { name, slug, active: true, order: 0 },
    })
    presenterIdBySlug.set(slug, doc.id)
    console.log(`presenter: + ${name}`)
  }

  // 2. Shows — unique by title; link all presenters ever seen on that title
  const presentersByTitle = new Map<string, Set<string>>()
  const sampleByTitle = new Map<string, EpisodeRow>()
  for (const row of rows) {
    const t = (row.title ?? '').trim()
    if (!t) continue
    if (!presentersByTitle.has(t)) presentersByTitle.set(t, new Set())
    const p = (row.presenter ?? '').trim()
    if (p) presentersByTitle.get(t)!.add(p)
    if (!sampleByTitle.has(t)) sampleByTitle.set(t, row)
  }

  for (const [title, presenterSet] of presentersByTitle) {
    const slug = slugify(title)
    const existing = await payload.find({
      collection: 'shows',
      where: { slug: { equals: slug } },
      limit: 1,
    })
    if (existing.docs[0]) {
      console.log(`show:      = ${title} (exists)`)
      continue
    }

    const presenterIds = Array.from(presenterSet)
      .map((n) => presenterIdBySlug.get(slugify(n)))
      .filter((id): id is string | number => id != null)

    const sample = sampleByTitle.get(title)
    await payload.create({
      collection: 'shows',
      data: {
        title,
        slug,
        active: true,
        presenters: presenterIds,
        schedule: sample?.broadcast_date ? `Last aired ${sample.broadcast_date}` : undefined,
      },
    })
    console.log(`show:      + ${title}`)
  }

  await pool.end()
  console.log('done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
