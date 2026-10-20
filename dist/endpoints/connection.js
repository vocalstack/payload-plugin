import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { accountLabel, DEFAULT_API_URL, DEFAULT_DASHBOARD_URL, VocalStackAPI, VocalStackAPIError } from '../api.js';
import { readSettings, writeSettings } from '../settings.js';
const json = (body, status = 200) => Response.json(body, { status });
const base64url = (b) => b.toString('base64url');
const CONNECT_TTL_MS = 10 * 60 * 1000;
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
export function connectionEndpoints(options) {
    const apiURL = options.apiURL ?? DEFAULT_API_URL;
    const dashboardURL = options.dashboardURL ?? DEFAULT_DASHBOARD_URL;
    const canManage = async (req) => Boolean(req.user) && (options.access ? await options.access({ req }) : true);
    const callbackURL = (req) => `${req.payload.config.serverURL || req.origin}${req.payload.config.routes.api}/vocalstack/callback`;
    return [
        {
            method: 'get',
            path: '/vocalstack/connection',
            handler: async (req) => {
                if (!req.user)
                    return json({ error: 'Sign in first.' }, 401);
                if (options.apiKey)
                    return json({ connected: true, source: 'options' });
                const settings = await readSettings(req);
                return json({ account: settings.account ?? undefined, connected: Boolean(settings.apiKey), source: settings.apiKey ? 'admin' : undefined });
            },
        },
        {
            // Paste a key (the fallback, and the way to connect until the dashboard ships /connect).
            method: 'post',
            path: '/vocalstack/key',
            handler: async (req) => {
                if (!(await canManage(req)))
                    return json({ error: 'You may not change the VocalStack connection.' }, 403);
                const body = (await req.json?.().catch(() => ({})));
                const apiKey = body.apiKey?.trim();
                if (!apiKey?.startsWith('vs_key_'))
                    return json({ error: 'A VocalStack API key starts with vs_key_.' }, 400);
                try {
                    const account = accountLabel(await new VocalStackAPI(apiKey, apiURL).me()) ?? null;
                    await writeSettings(req, { account, apiKey });
                    return json({ account: account ?? undefined, connected: true, source: 'admin' });
                }
                catch (err) {
                    const message = err instanceof VocalStackAPIError && err.status === 401 ? 'VocalStack refused that key.' : String(err.message);
                    return json({ error: message }, 400);
                }
            },
        },
        {
            method: 'delete',
            path: '/vocalstack/key',
            handler: async (req) => {
                if (!(await canManage(req)))
                    return json({ error: 'You may not change the VocalStack connection.' }, 403);
                await writeSettings(req, { account: null, apiKey: null });
                return json({ connected: Boolean(options.apiKey), source: options.apiKey ? 'options' : undefined });
            },
        },
        {
            method: 'post',
            path: '/vocalstack/connect',
            handler: async (req) => {
                if (!(await canManage(req)))
                    return json({ error: 'You may not change the VocalStack connection.' }, 403);
                const state = base64url(randomBytes(24));
                const verifier = base64url(randomBytes(48));
                const challenge = base64url(createHash('sha256').update(verifier).digest());
                await writeSettings(req, { connectExpiresAt: new Date(Date.now() + CONNECT_TTL_MS).toISOString(), connectState: state, connectVerifier: verifier });
                const site = new URL(req.payload.config.serverURL || req.origin);
                const url = new URL('/connect', dashboardURL);
                url.search = new URLSearchParams({
                    client_name: `${site.host} (Payload CMS)`,
                    code_challenge: challenge,
                    code_challenge_method: 'S256',
                    redirect_uri: callbackURL(req),
                    response_type: 'code',
                    scope: 'read write',
                    state,
                }).toString();
                return json({ url: url.toString() });
            },
        },
        {
            method: 'get',
            path: '/vocalstack/callback',
            handler: async (req) => {
                const params = req.searchParams;
                const settings = await readSettings(req);
                const expected = settings.connectState ?? '';
                const state = params.get('state') ?? '';
                const fresh = settings.connectExpiresAt && new Date(settings.connectExpiresAt).getTime() > Date.now();
                const matches = expected.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
                if (!req.user)
                    return page('Sign in to the admin panel in this browser, then connect again.', false);
                if (!matches || !fresh || !settings.connectVerifier)
                    return page('This connect link has expired. Start again from the admin panel.', false);
                await writeSettings(req, { connectExpiresAt: null, connectState: null, connectVerifier: null });
                if (params.get('error'))
                    return page(params.get('error') === 'access_denied' ? 'Connection cancelled.' : `VocalStack said: ${params.get('error_description') ?? params.get('error')}`, false);
                const res = await fetch(`${apiURL}/v1/connect/token`, {
                    body: new URLSearchParams({ code: params.get('code') ?? '', code_verifier: settings.connectVerifier, grant_type: 'authorization_code', redirect_uri: callbackURL(req) }),
                    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
                    method: 'POST',
                });
                const token = (await res.json().catch(() => ({})));
                if (!res.ok || !token.access_token)
                    return page(`VocalStack did not issue a key: ${token.error_description ?? res.status}`, false);
                const account = token.account?.name ?? accountLabel(await new VocalStackAPI(token.access_token, apiURL).me().catch(() => ({}))) ?? null;
                await writeSettings(req, { account, apiKey: token.access_token });
                return page(account ? `Connected to VocalStack as ${account}.` : 'Connected to VocalStack.', true);
            },
        },
    ];
}
const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The tab the dashboard sends back to: tell the admin tab, then close. */
function page(message, ok) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VocalStack</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#131326}@media(prefers-color-scheme:dark){body{background:#131326;color:#eee}}main{text-align:center;padding:0 16px}main img{height:28px;width:auto}p{max-width:28rem;margin:24px auto 0}</style></head>
<body><main><picture><source media="(prefers-color-scheme: dark)" srcset="https://vocalstack.com/assets/logo-dark.svg"><img alt="VocalStack" height="28" src="https://vocalstack.com/assets/logo-light.svg"></picture><p>${escapeHTML(message)}${ok ? '<br><br>You can close this tab.' : ''}</p></main>
<script>try{new BroadcastChannel('vocalstack').postMessage(${JSON.stringify({ ok, type: 'connect' })})}catch(e){}${ok ? 'setTimeout(function(){window.close()},1200)' : ''}</script></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' }, status: ok ? 200 : 400 });
}
