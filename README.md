# @vocalstack/payload

VocalStack for [Payload CMS](https://payloadcms.com) 3: a **Transcribe** button on every audio upload. The transcript is saved on the document as text plus timed sentences.

## Install

```sh
pnpm add @vocalstack/payload
```

```ts
// payload.config.ts
import { vocalstackPlugin } from '@vocalstack/payload'

export default buildConfig({
  plugins: [
    vocalstackPlugin({
      // Optional. Without it, connect from Admin → Settings → VocalStack.
      apiKey: process.env.VOCALSTACK_API_KEY,
    }),
  ],
})
```

Then run `payload generate:importmap`. The plugin adds fields to the targeted collections and a `vocalstack` global, so with Postgres also run `payload migrate:create`.

## What it adds

- **Every upload collection that accepts audio** (`audio/*`, a wildcard, or no restriction), or the ones in `collections`, gets:
  - a sidebar **Transcribe** button, shown on `audio/*` documents only. It shows progress and survives a reload mid-job, and **Stop** ends a job you no longer want: the document goes back to how it was (an earlier transcript stays), and VocalStack keeps what it transcribed before the stop.
  - a `vocalstack` group:
    - `transcript`: text you can edit; paragraphs break on a speaker change or a pause.
    - `sentences`: `[{ start, end, speaker, text }]` in seconds.
    - `status`, `language`, `error`, `recordingId`, `transcriptionId` and `transcribedAt`.
  - `POST /api/{collection}/:id/vocalstack/transcribe`, `POST …/vocalstack/stop`, `GET …/vocalstack/status` and `GET …/vocalstack/stream` (live progress as Server-Sent Events).
- **Settings → VocalStack** (a global), where an editor connects an account. The key is stored server-side and is unreadable over the REST and GraphQL APIs.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | none | A `vs_key_…` key with Read and Write. It wins over a key connected in the admin. |
| `collections` | every upload collection that accepts audio | Which upload collections get the button. |
| `audioFields` | none | Audio that isn't an upload document; see below. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `fileURL` | the doc's `url`, made absolute | `({ doc, collection, req }) => string`: the address VocalStack fetches. Point it at your bucket's public URL to skip the Payload file proxy. |
| `access` | signed-in users who can update the doc | Extra check for transcribing and for changing the connection. |
| `oneClickConnect` | `false` | Show **Connect VocalStack** (see below). |
| `apiURL` / `dashboardURL` | `https://api.vocalstack.com` / `https://app.vocalstack.com` | |
| `enabled` | `true` | `false` keeps the schema but removes the button and the endpoints. |

### Audio that isn't an upload

Imported content often points at files by name or link instead of upload documents. `audioFields` gives each row of an array field its own button and `vocalstack` transcript:

```ts
vocalstackPlugin({
  audioFields: [
    {
      collection: 'episodes',
      field: 'attachments', // a top-level array (tabs, rows and collapsibles are looked through)
      condition: (row) => row.type === 'file',
      audioURL: ({ row }) => (row.filename ? `https://cdn.example.com/episodes/${encodeURIComponent(String(row.filename))}` : undefined),
    },
  ],
})
```

Rows are addressed by their id: `POST /api/episodes/:id/vocalstack/transcribe?field=attachments&row=<row id>`. A new row needs saving first.

**How the audio reaches VocalStack.** If the file has a public address, VocalStack fetches it (`POST /v1/transcriptions { url }`). Otherwise (localhost, a private network) the plugin uploads the bytes. Either way the job runs on VocalStack, and the admin polls every 3 s. The account is billed per second, with a 5-minute minimum per transcription.

## One-click connect (protocol)

The alternative to pasting a key: **Connect VocalStack** opens the dashboard in a new tab, the person clicks **Authenticate**, and the tab closes. This is OAuth 2.0 authorization code + PKCE (RFC 7636) with an API key as the access token. There is no client registration: the consent screen shows the `redirect_uri` host instead.

```
CMS admin                           CMS server                         app.vocalstack.com / api.vocalstack.com
──────────                          ──────────                         ───────────────────────────────────────
click Connect ── POST /api/vocalstack/connect ─▶ state, verifier (10 min)
◀──────────── { url } ──────────────
new tab ─▶ GET app/connect?response_type=code&client_name=…&redirect_uri=…&state=…
                                    &code_challenge=…&code_challenge_method=S256&scope=read write
           (sign in if needed; pick the organization; "example.com wants to transcribe with VocalStack")
           click Authenticate ─▶ API stores a single-use grant (code hash, challenge, redirect, scopes, principal; 2 min)
           ◀── 302 redirect_uri?code=…&state=…
tab ─────── GET /api/vocalstack/callback ─▶ check state (+ admin session)
                                    POST api/v1/connect/token (form) ─▶ grant_type=authorization_code, code,
                                                                        code_verifier, redirect_uri
                                                                        verify, burn the code, create the key
                                    ◀── { access_token: "vs_key_…", token_type: "api_key", key_id, account: { name } }
                                    stores the key (never sent to a browser)
tab: "Connected", BroadcastChannel('vocalstack') ─▶ admin refreshes; tab closes
```

Cancel redirects with `?error=access_denied&state=…`. The key appears in the dashboard's API keys list as `example.com (Payload CMS)`, where it can be revoked.
