import type { GlobalConfig } from 'payload'

export const SiteInfo: GlobalConfig = {
  slug: 'site-info',
  label: 'Site Info',
  admin: {
    group: 'Editorial',
  },
  access: {
    read: () => true,
  },
  fields: [
    { name: 'tagline', type: 'text' },
    {
      name: 'about',
      type: 'richText',
      admin: { description: 'Short description used on About page / meta tags.' },
    },
    {
      name: 'social',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
      ],
    },
    {
      name: 'footerLinks',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
      ],
    },
  ],
}
