import Image from 'next/image'
import React from 'react'
import { RichText } from '@payloadcms/richtext-lexical/react'

type Block = {
  blockType: string
  [k: string]: any
}

const mediaSrc = (m: any): string | null => {
  if (!m) return null
  if (typeof m === 'string') return null
  if (m.url) return m.url
  return null
}

export function RenderBlocks({ blocks }: { blocks?: Block[] | null }) {
  if (!blocks || blocks.length === 0) return null
  return (
    <div className="space-y-10">
      {blocks.map((block, i) => {
        const key = block.id ?? i
        switch (block.blockType) {
          case 'hero':
            return <HeroBlock key={key} block={block} />
          case 'richText':
            return <RichTextBlock key={key} block={block} />
          case 'imageText':
            return <ImageTextBlock key={key} block={block} />
          case 'embed':
            return <EmbedBlock key={key} block={block} />
          default:
            return null
        }
      })}
    </div>
  )
}

function HeroBlock({ block }: { block: Block }) {
  const src = mediaSrc(block.image)
  const alt = (block.image && block.image.alt) || block.heading || ''
  return (
    <section className="rounded-xl2 bg-card p-8 shadow-whisper">
      <h1 className="text-4xl font-bold">{block.heading}</h1>
      {block.subheading && <p className="mt-2 text-lg opacity-80">{block.subheading}</p>}
      {src && (
        <div className="mt-6 overflow-hidden rounded-lg">
          <Image src={src} alt={alt} width={1200} height={600} className="w-full h-auto" />
        </div>
      )}
    </section>
  )
}

function RichTextBlock({ block }: { block: Block }) {
  if (!block.content) return null
  return (
    <section className="prose-duckfeed">
      <RichText data={block.content} />
    </section>
  )
}

function ImageTextBlock({ block }: { block: Block }) {
  const src = mediaSrc(block.image)
  const alt = (block.image && block.image.alt) || ''
  const imageRight = block.side === 'right'
  return (
    <section className="grid gap-6 md:grid-cols-2 items-center">
      {src && (
        <div className={imageRight ? 'md:order-2' : ''}>
          <Image src={src} alt={alt} width={800} height={600} className="w-full h-auto rounded-lg" />
        </div>
      )}
      {block.content && (
        <div className="prose-duckfeed">
          <RichText data={block.content} />
        </div>
      )}
    </section>
  )
}

function EmbedBlock({ block }: { block: Block }) {
  if (!block.value) return null
  const { provider, value } = block
  const url = String(value).trim()

  let embedSrc: string | null = null
  if (provider === 'mixcloud') {
    try {
      const path = new URL(url).pathname
      embedSrc = `https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(path)}&hide_cover=1&light=1`
    } catch {
      embedSrc = null
    }
  } else if (provider === 'youtube') {
    try {
      const u = new URL(url)
      const id = u.searchParams.get('v') || u.pathname.split('/').pop()
      if (id) embedSrc = `https://www.youtube.com/embed/${id}`
    } catch {
      embedSrc = null
    }
  } else if (provider === 'soundcloud' || provider === 'bandcamp') {
    embedSrc = url
  }

  if (!embedSrc) {
    return (
      <section>
        <a className="underline" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      </section>
    )
  }

  return (
    <section className="aspect-video overflow-hidden rounded-lg">
      <iframe
        src={embedSrc}
        title={provider}
        allow="autoplay; encrypted-media"
        allowFullScreen
        className="h-full w-full border-0"
      />
    </section>
  )
}
