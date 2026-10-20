import type { Endpoint } from 'payload';
import type { VocalStackPluginOptions } from '../types.js';
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
export declare function connectionEndpoints(options: VocalStackPluginOptions): Endpoint[];
