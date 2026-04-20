import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'text' },
    { name: 'image', type: 'upload', relationTo: 'media' },
  ],
}

export const RichTextBlock: Block = {
  slug: 'richText',
  labels: { singular: 'Rich Text', plural: 'Rich Text Blocks' },
  fields: [{ name: 'content', type: 'richText' }],
}

export const ImageText: Block = {
  slug: 'imageText',
  labels: { singular: 'Image + Text', plural: 'Image + Text Blocks' },
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true },
    {
      name: 'side',
      type: 'select',
      defaultValue: 'left',
      options: [
        { label: 'Image left', value: 'left' },
        { label: 'Image right', value: 'right' },
      ],
    },
    { name: 'content', type: 'richText' },
  ],
}

export const Embed: Block = {
  slug: 'embed',
  labels: { singular: 'Embed', plural: 'Embeds' },
  fields: [
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'Mixcloud', value: 'mixcloud' },
        { label: 'SoundCloud', value: 'soundcloud' },
        { label: 'YouTube', value: 'youtube' },
        { label: 'Bandcamp', value: 'bandcamp' },
        { label: 'Raw HTML', value: 'html' },
      ],
    },
    {
      name: 'value',
      type: 'textarea',
      required: true,
      admin: { description: 'URL for providers, or raw iframe/HTML for "Raw HTML".' },
    },
  ],
}
