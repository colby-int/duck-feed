import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import React from 'react'
import { RichText } from '@payloadcms/richtext-lexical/react'

import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type Params = { slug: string }

export default async function ArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })

  const { docs } = await payload.find({
    collection: 'articles',
    where: { slug: { equals: slug }, _status: { equals: 'published' } },
    limit: 1,
    depth: 2,
  })

  const article: any = docs[0]
  if (!article) return notFound()

  const heroSrc: string | null = article.hero && typeof article.hero === 'object' ? article.hero.url ?? null : null
  const heroAlt: string = (article.hero && article.hero.alt) || article.title

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav className="mb-8 text-sm">
        <Link className="underline opacity-70" href="/">
          ← Home
        </Link>
      </nav>

      <article>
        <header className="mb-6">
          <h1 className="text-4xl font-bold">{article.title}</h1>
          <div className="mt-2 text-sm opacity-70">
            {article.author && typeof article.author === 'object' && article.author.name}
            {article.publishedAt && (
              <span>
                {article.author && ' · '}
                {new Date(article.publishedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </header>

        {heroSrc && (
          <div className="mb-8 overflow-hidden rounded-lg">
            <Image src={heroSrc} alt={heroAlt} width={1200} height={600} className="w-full h-auto" />
          </div>
        )}

        {article.excerpt && <p className="mb-6 text-lg opacity-80">{article.excerpt}</p>}

        {article.body && (
          <div className="prose-duckfeed">
            <RichText data={article.body} />
          </div>
        )}
      </article>
    </main>
  )
}
