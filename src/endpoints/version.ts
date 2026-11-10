import type { Endpoint } from 'payload'

import type { VersionResponse, VocalStackPluginOptions } from '../types.js'

import { PACKAGE_NAME, VERSION } from '../version.js'

const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2F')}/latest`
const RELEASES = 'https://github.com/vocalstack/payload-plugin/releases/tag/v'
/** npm asked again after this long. */
const FRESH_MS = 6 * 60 * 60 * 1000
/** After a failed ask, wait this long before the next. */
const RETRY_MS = 15 * 60 * 1000

type Parsed = { core: number[]; pre: string[] }
const parse = (v: string): Parsed | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim())
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] } : null
}

/** Semver order: below 0 when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!
  // A prerelease comes before its release.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

// Per server process: one ask to npm shared by every admin, and by every page.
let known: { at: number; ok: boolean; v: null | string } | undefined
let asking: Promise<null | string> | undefined

async function fromNpm(): Promise<null | string> {
  try {
    const r = await fetch(REGISTRY, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const v = String(((await r.json()) as { version?: unknown }).version ?? '')
    return parse(v) ? v : null
  } catch {
    return null
  }
}

/** The newest version on npm: the last answer while it is fresh, the last good one when npm can't be reached. */
async function latest(): Promise<null | string> {
  if (known && Date.now() - known.at < (known.ok ? FRESH_MS : RETRY_MS)) return known.v
  asking ??= fromNpm().then((v) => {
    asking = undefined
    known = { at: Date.now(), ok: Boolean(v), v: v ?? known?.v ?? null }
    return known.v
  })
  return asking
}

export function versionEndpoint(options: VocalStackPluginOptions): Endpoint {
  return {
    method: 'get',
    path: '/vocalstack/version',
    handler: async (req) => {
      if (!req.user) return Response.json({ error: 'Sign in first.' }, { status: 401 })
      const v = options.updateCheck === false ? null : await latest()
      const state = !v ? 'unknown' : compareVersions(VERSION, v) < 0 ? 'outdated' : 'current'
      return Response.json(
        { current: VERSION, latest: v, releaseURL: state === 'outdated' ? `${RELEASES}${v}` : undefined, state } satisfies VersionResponse,
        { headers: { 'cache-control': 'private, max-age=300' } },
      )
    },
  }
}
