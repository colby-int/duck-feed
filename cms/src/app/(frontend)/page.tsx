import { getPayload } from 'payload'
import Link from 'next/link'
import React from 'react'

import config from '@/payload.config'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const [pages, articles, presenters] = await Promise.all([
    payload.find({ collection: 'pages', limit: 50, sort: 'title' }),
    payload.find({
      collection: 'articles',
      limit: 20,
      sort: '-publishedAt',
      where: { _status: { equals: 'published' } },
    }),
    payload.find({
      collection: 'presenters',
      limit: 50,
      sort: 'order',
      where: { active: { equals: true } },
    }),
  ])

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-12">
        <h1 className="text-4xl font-bold">Duck Feed</h1>
        <p className="mt-2 opacity-80">24/7 internet radio — editorial pages (preview).</p>
      </header>

      <Section title="Pages">
        {pages.docs.length === 0 ? (
          <Empty>No pages yet — create one in the admin.</Empty>
        ) : (
          <ul className="space-y-2">
            {pages.docs.map((p: any) => (
              <li key={p.id}>
                <Link className="underline" href={`/${p.slug}`}>
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Articles">
        {articles.docs.length === 0 ? (
          <Empty>No published articles yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {articles.docs.map((a: any) => (
              <li key={a.id}>
                <Link className="underline" href={`/articles/${a.slug}`}>
                  {a.title}
                </Link>
                {a.publishedAt && (
                  <span className="ml-2 text-sm opacity-70">
                    {new Date(a.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Presenters">
        {presenters.docs.length === 0 ? (
          <Empty>No presenters yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {presenters.docs.map((p: any) => (
              <li key={p.id}>
                <Link className="underline" href={`/presenters/${p.slug}`}>
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="mt-16 border-t border-ink/20 pt-6 text-sm opacity-70">
        <Link className="underline" href="/admin">
          Admin panel →
        </Link>
      </footer>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="opacity-70 italic">{children}</p>
}
