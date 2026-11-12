import type { Endpoint, PayloadRequest } from 'payload'

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { ConnectionResponse, VocalStackPluginOptions } from '../types.js'
import type { Workspace } from '../workspace.js'

import { accountLabel, DEFAULT_API_URL, DEFAULT_DASHBOARD_URL, VocalStackAPI, VocalStackAPIError } from '../api.js'
import { readSettings, writeSettings } from '../settings.js'
import { workspaceOf } from '../workspace.js'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const base64url = (b: Buffer) => b.toString('base64url')
const CONNECT_TTL_MS = 10 * 60 * 1000

/** What VocalStack says a key belongs to: its workspace, and a label for it. */
type Owner = { account?: string; workspace?: Workspace }

const OWNER_FRESH_MS = 60_000
const OWNER_RETRY_MS = 15_000
const OWNER_TIMEOUT_MS = 6_000
const owners = new Map<string, { owner?: Owner; until: number }>()
const ownerKey = (apiKey: string, apiURL: string) => createHash('sha256').update(`${apiURL}\n${apiKey}`).digest('hex')

/** Forget what was read from `/v1/me` (tests). */
export const forgetOwners = () => owners.clear()

const ownerOf = (me: Record<string, unknown>, apiURL: string): Owner => {
  const workspace = workspaceOf(me.workspace, apiURL)
  return { account: workspace?.name ?? accountLabel(me), workspace }
}

function remember(apiKey: string, apiURL: string, owner: Owner | undefined, ms = OWNER_FRESH_MS): void {
  if (owners.size > 50) owners.clear()
  owners.set(ownerKey(apiKey, apiURL), { owner, until: Date.now() + ms })
}

/**
 * The key's workspace as `/v1/me` has it now, so a new name or icon set in the VocalStack
 * Dashboard reaches the admin. Asked at most once a minute per key; `undefined` when
 * VocalStack did not answer in time.
 */
async function lookUpOwner(apiKey: string, apiURL: string): Promise<Owner | undefined> {
  const hit = owners.get(ownerKey(apiKey, apiURL))
  if (hit && Date.now() < hit.until) return hit.owner
  const owner = await Promise.race([
    new VocalStackAPI(apiKey, apiURL).me().then((me) => ownerOf(me, apiURL), () => undefined),
    new Promise<undefined>((resolve) => {
      const timer: unknown = setTimeout(resolve, OWNER_TIMEOUT_MS)
      ;(timer as { unref?: () => void }).unref?.()
    }),
  ])
  // Through a blip the last good answer stays, and VocalStack is asked again sooner.
  const last = owner ?? hit?.owner
  remember(apiKey, apiURL, last, owner ? OWNER_FRESH_MS : OWNER_RETRY_MS)
  return last
}

/**
 * One-click connect, as OAuth 2.0 authorization code + PKCE (RFC 7636) whose
 * token is a VocalStack API key:
 *
 * 1. POST /api/vocalstack/connect   → state + verifier stored here; the admin opens
 *    {dashboard}/connect?response_type=code&redirect_uri=…&state=…&code_challenge=…
 * 2. The person clicks Authenticate on the dashboard, which redirects to
 *    /api/vocalstack/callback?code=…&state=…
 * 3. The callback redeems the code server-to-server at {api}/v1/connect/token with
 *    the verifier and stores the key it answers. The key never passes through a browser.
 */
export function connectionEndpoints(options: VocalStackPluginOptions): Endpoint[] {
  const apiURL = options.apiURL ?? DEFAULT_API_URL
  const dashboardURL = options.dashboardURL ?? DEFAULT_DASHBOARD_URL
  const canManage = async (req: PayloadRequest) => Boolean(req.user) && (options.access ? await options.access({ req }) : true)
  const callbackURL = (req: PayloadRequest) => `${req.payload.config.serverURL || req.origin}${req.payload.config.routes.api}/vocalstack/callback`

  return [
    {
      method: 'get',
      path: '/vocalstack/connection',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Sign in first.' }, 401)
        if (options.apiKey) {
          const owner = await lookUpOwner(options.apiKey, apiURL)
          return json({ account: owner?.account, connected: true, source: 'options', workspace: owner?.workspace } satisfies ConnectionResponse)
        }
        const settings = await readSettings(req)
        if (!settings.apiKey) return json({ account: settings.account ?? undefined, connected: false } satisfies ConnectionResponse)
        const owner = await lookUpOwner(settings.apiKey, apiURL)
        // The stored label follows a rename, so it is still right when VocalStack cannot be asked.
        if (owner?.account && owner.account !== settings.account) await writeSettings(req, { account: owner.account }).catch(() => undefined)
        return json({ account: owner?.account ?? settings.account ?? undefined, connected: true, source: 'admin', workspace: owner?.workspace } satisfies ConnectionResponse)
      },
    },
    {
      // Paste a key (the fallback, and the way to connect until the dashboard ships /connect).
      method: 'post',
      path: '/vocalstack/key',
      handler: async (req) => {
        if (!(await canManage(req))) return json({ error: 'You may not change the VocalStack connection.' }, 403)
        const body = (await req.json?.().catch(() => ({}))) as { apiKey?: string }
        const apiKey = body.apiKey?.trim()
        if (!apiKey?.startsWith('vs_key_')) return json({ error: 'A VocalStack API key starts with vs_key_.' }, 400)
        try {
          const owner = ownerOf(await new VocalStackAPI(apiKey, apiURL).me(), apiURL)
          await writeSettings(req, { account: owner.account ?? null, apiKey })
          remember(apiKey, apiURL, owner)
          return json({ account: owner.account, connected: true, source: 'admin', workspace: owner.workspace } satisfies ConnectionResponse)
        } catch (err) {
          const message = err instanceof VocalStackAPIError && err.status === 401 ? 'VocalStack refused that key.' : String((err as Error).message)
          return json({ error: message }, 400)
        }
      },
    },
    {
      method: 'delete',
      path: '/vocalstack/key',
      handler: async (req) => {
        if (!(await canManage(req))) return json({ error: 'You may not change the VocalStack connection.' }, 403)
        await writeSettings(req, { account: null, apiKey: null })
        return json({ connected: Boolean(options.apiKey), source: options.apiKey ? 'options' : undefined } satisfies ConnectionResponse)
      },
    },
    {
      // Give up a connect that was started: its link stops working, and the key in use stays.
      method: 'delete',
      path: '/vocalstack/connect',
      handler: async (req) => {
        if (!(await canManage(req))) return json({ error: 'You may not change the VocalStack connection.' }, 403)
        await writeSettings(req, { connectExpiresAt: null, connectState: null, connectVerifier: null })
        return json({ ok: true })
      },
    },
    {
      method: 'post',
      path: '/vocalstack/connect',
      handler: async (req) => {
        if (!(await canManage(req))) return json({ error: 'You may not change the VocalStack connection.' }, 403)
        const state = base64url(randomBytes(24))
        const verifier = base64url(randomBytes(48))
        const challenge = base64url(createHash('sha256').update(verifier).digest())
        await writeSettings(req, { connectExpiresAt: new Date(Date.now() + CONNECT_TTL_MS).toISOString(), connectState: state, connectVerifier: verifier })

        const site = new URL(req.payload.config.serverURL || req.origin)
        const url = new URL('/connect', dashboardURL)
        url.search = new URLSearchParams({
          client_name: `${site.host} (Payload CMS)`,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          redirect_uri: callbackURL(req),
          response_type: 'code',
          scope: 'read write',
          state,
        }).toString()
        return json({ url: url.toString() })
      },
    },
    {
      method: 'get',
      path: '/vocalstack/callback',
      handler: async (req) => {
        const params = req.searchParams
        const settings = await readSettings(req)
        const expected = settings.connectState ?? ''
        const state = params.get('state') ?? ''
        const fresh = settings.connectExpiresAt && new Date(settings.connectExpiresAt).getTime() > Date.now()
        const matches = expected.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected))

        if (!req.user) return page('Sign in to the admin panel in this browser, then connect again.', false)
        if (!matches || !fresh || !settings.connectVerifier) return page('This connect link has expired. Start again from the admin panel.', false)
        await writeSettings(req, { connectExpiresAt: null, connectState: null, connectVerifier: null })
        if (params.get('error')) return page(params.get('error') === 'access_denied' ? 'Connection cancelled.' : `VocalStack said: ${params.get('error_description') ?? params.get('error')}`, false)

        const res = await fetch(`${apiURL}/v1/connect/token`, {
          body: new URLSearchParams({ code: params.get('code') ?? '', code_verifier: settings.connectVerifier, grant_type: 'authorization_code', redirect_uri: callbackURL(req) }),
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
        })
        const token = (await res.json().catch(() => ({}))) as { access_token?: string; account?: { name?: string }; error_description?: string; workspace?: unknown }
        // Nothing was stored yet: a refused or cancelled connect leaves the key in use as it was.
        if (!res.ok || !token.access_token) return page(`VocalStack did not issue a key: ${token.error_description ?? res.status}`, false)

        let workspace = workspaceOf(token.workspace, apiURL)
        let account = workspace?.name ?? token.account?.name
        if (!workspace) {
          // An API from before workspaces were named on this answer: ask /v1/me.
          const owner = ownerOf(await new VocalStackAPI(token.access_token, apiURL).me().catch(() => ({})), apiURL)
          workspace = owner.workspace
          account = workspace?.name ?? account ?? owner.account
        }
        await writeSettings(req, { account: account ?? null, apiKey: token.access_token })
        remember(token.access_token, apiURL, { account, workspace })
        if (workspace) return page(`Connected to the VocalStack workspace ${workspace.name}.`, true)
        return page(account ? `Connected to VocalStack as ${account}.` : 'Connected to VocalStack.', true)
      },
    },
  ]
}

const escapeHTML = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The tab the dashboard sends back to: tell the admin tab, then close. */
function page(message: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VocalStack</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#131326}@media(prefers-color-scheme:dark){body{background:#131326;color:#eee}}main{text-align:center;padding:0 16px}main img{height:28px;width:auto}p{max-width:28rem;margin:24px auto 0}</style></head>
<body><main><picture><source media="(prefers-color-scheme: dark)" srcset="https://vocalstack.com/assets/logo-dark.svg"><img alt="VocalStack" height="28" src="https://vocalstack.com/assets/logo-light.svg"></picture><p>${escapeHTML(message)}${ok ? '<br><br>You can close this tab.' : ''}</p></main>
<script>try{new BroadcastChannel('vocalstack').postMessage(${JSON.stringify({ ok, type: 'connect' })})}catch(e){}${ok ? 'setTimeout(function(){window.close()},1200)' : ''}</script></body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' }, status: ok ? 200 : 400 })
}
