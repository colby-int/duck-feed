import type { CollectionConfig } from 'payload'
import { slugField } from '../fields/slug'

export const Shows: CollectionConfig = {
  slug: 'shows',
  labels: { singular: 'Show', plural: 'Shows' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'active', 'updatedAt'],
    group: 'Editorial',
  },
  access: {
    read: () => true,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField('title'),
    {
      name: 'artwork',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'presenters',
      type: 'relationship',
      relationTo: 'presenters',
      hasMany: true,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'schedule',
      type: 'text',
      admin: {
        description: 'Human-readable schedule, e.g. "Every other Thursday, 8–10pm".',
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: { position: 'sidebar' },
    },
  ],
}
