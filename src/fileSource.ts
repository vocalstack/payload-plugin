import type { CollectionSlug, PayloadRequest } from 'payload'

import type { UploadDoc, VocalStackPluginOptions } from './types.js'

/** The absolute address of an upload's file. */
export async function resolveFileURL(
  req: PayloadRequest,
  collection: CollectionSlug,
  doc: UploadDoc,
  options: VocalStackPluginOptions,
): Promise<string | undefined> {
  const custom = await options.fileURL?.({ collection, doc, req })
  const url = custom ?? doc.url
  if (!url) return undefined
  const base = req.payload.config.serverURL || req.origin
  return new URL(url, base).toString()
}

/**
 * Whether VocalStack can fetch this address itself. The API refuses loopback,
 * private and link-local hosts, so for those (local development, an intranet)
 * the plugin sends the bytes instead.
 */
export function isPublicURL(url: string): boolean {
  const { hostname, protocol } = new URL(url)
  if (protocol !== 'https:' && protocol !== 'http:') return false
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))
  }
  if (host.includes(':')) return !(host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
  return true
}

/** The file's bytes, for an upload VocalStack cannot reach by link. */
export async function fetchFile(req: PayloadRequest, url: string): Promise<Blob> {
  // Same-origin files go through Payload's access control: pass the editor's cookie along.
  const sameOrigin = new URL(url).origin === req.origin
  const cookie = req.headers.get('cookie')
  const res = await fetch(url, { headers: sameOrigin && cookie ? { cookie } : {} })
  if (!res.ok) throw new Error(`Could not read the file (${res.status} from ${url})`)
  return res.blob()
}
