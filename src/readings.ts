import type { CollectionConfig, CollectionSlug } from 'payload'

import type { VocalStackPluginOptions } from './types.js'

/** The upload collection finished readings are saved in, or none. */
export const readingsSlug = (options: VocalStackPluginOptions): CollectionSlug | undefined =>
  options.readings === false ? undefined : (options.readings?.slug ?? ('vocalstack-readings' as CollectionSlug))

/** Spoken readings, kept as MP3 uploads so they are served from the site's own storage. */
export const readingsCollection = (slug: CollectionSlug): CollectionConfig => ({
  slug,
  labels: { plural: 'Readings', singular: 'Reading' },
  admin: {
    description: 'Translations read aloud, saved from VocalStack once they are ready. Made and removed from the transcript.',
    group: 'VocalStack',
    useAsTitle: 'filename',
  },
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  upload: { mimeTypes: ['audio/mpeg'] },
  fields: [
    { name: 'lang', type: 'text', admin: { readOnly: true } },
    { name: 'recordingId', type: 'text', admin: { readOnly: true } },
    { name: 'voice', type: 'text', admin: { readOnly: true } },
  ],
})
