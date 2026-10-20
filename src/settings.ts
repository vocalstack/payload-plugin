import type { GlobalConfig, PayloadRequest } from 'payload'

import type { VocalStackPluginOptions } from './types.js'

export const SETTINGS_SLUG = 'vocalstack'

const hidden = { admin: { hidden: true }, access: { read: () => false, update: () => false } } as const

/**
 * Where a key connected from the admin lives. Nothing here is readable or
 * writable over the REST/GraphQL APIs: only the plugin's endpoints touch it
 * (with `overrideAccess`), so the key never reaches a browser.
 */
export const settingsGlobal = (options: VocalStackPluginOptions): GlobalConfig => ({
  slug: SETTINGS_SLUG,
  label: 'VocalStack',
  admin: {
    group: 'Settings',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    update: () => false,
  },
  fields: [
    {
      name: 'connection',
      type: 'ui',
      admin: {
        components: {
          Field: { clientProps: { oneClickConnect: Boolean(options.oneClickConnect) }, path: '@vocalstack/payload/client#ConnectionPanel' },
        },
      },
    },
    { name: 'apiKey', type: 'text', ...hidden },
    { name: 'account', type: 'text', ...hidden },
    // A pending one-click connect: PKCE verifier and state, for ten minutes.
    { name: 'connectState', type: 'text', ...hidden },
    { name: 'connectVerifier', type: 'text', ...hidden },
    { name: 'connectExpiresAt', type: 'date', ...hidden },
  ],
})

export type StoredSettings = {
  account?: null | string
  apiKey?: null | string
  connectExpiresAt?: null | string
  connectState?: null | string
  connectVerifier?: null | string
}

export async function readSettings(req: PayloadRequest): Promise<StoredSettings> {
  return (await req.payload.findGlobal({ slug: SETTINGS_SLUG, overrideAccess: true, req })) as StoredSettings
}

export async function writeSettings(req: PayloadRequest, data: StoredSettings): Promise<void> {
  await req.payload.updateGlobal({ slug: SETTINGS_SLUG, data, overrideAccess: true, req })
}

/** The key to call VocalStack with: the plugin option first, then a connected one. */
export async function resolveAPIKey(req: PayloadRequest, options: VocalStackPluginOptions): Promise<string | undefined> {
  if (options.apiKey) return options.apiKey
  return (await readSettings(req)).apiKey ?? undefined
}
