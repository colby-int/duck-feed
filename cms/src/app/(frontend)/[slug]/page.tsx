import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import React from 'react'

import config from '@/payload.config'
import { RenderBlocks } from '../RenderBlocks'

export const dynamic = 'force-dynamic'

type Params = { slug: string }

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })

  const { docs } = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug }, _status: { equals: 'published' } },
    limit: 1,
    depth: 2,
  })

  const page = docs[0]
  if (!page) return notFound()

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav className="mb-8 text-sm">
        <Link className="underline opacity-70" href="/">
          ← Home
        </Link>
      </nav>
      <h1 className="mb-8 text-4xl font-bold">{page.title}</h1>
      <RenderBlocks blocks={page.layout as any} />
    </main>
  )
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
  })
  return { title: docs[0]?.title ?? 'Page' }
}
