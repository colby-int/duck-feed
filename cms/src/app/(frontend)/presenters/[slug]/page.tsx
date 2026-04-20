import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import React from 'react'
import { RichText } from '@payloadcms/richtext-lexical/react'

import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type Params = { slug: string }

export default async function PresenterPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })

  const { docs } = await payload.find({
    collection: 'presenters',
    where: { slug: { equals: slug }, active: { equals: true } },
    limit: 1,
    depth: 2,
  })

  const presenter: any = docs[0]
  if (!presenter) return notFound()

  const photoSrc: string | null =
    presenter.photo && typeof presenter.photo === 'object' ? presenter.photo.url ?? null : null

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav className="mb-8 text-sm">
        <Link className="underline opacity-70" href="/">
          ← Home
        </Link>
      </nav>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {photoSrc && (
          <div className="w-full md:w-48 shrink-0 overflow-hidden rounded-xl2">
            <Image
              src={photoSrc}
              alt={presenter.photo.alt || presenter.name}
              width={400}
              height={400}
              className="h-auto w-full"
            />
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-4xl font-bold">{presenter.name}</h1>
          {presenter.bio && (
            <div className="mt-4 prose-duckfeed">
              <RichText data={presenter.bio} />
            </div>
          )}
          {Array.isArray(presenter.socials) && presenter.socials.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-3 text-sm">
              {presenter.socials.map((s: any, i: number) => (
                <li key={i}>
                  <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                    {s.platform}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
