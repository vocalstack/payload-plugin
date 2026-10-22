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
- **Translations and readings**, under every finished transcript: translate it into any of 100 languages, and have the translation read aloud (in a cloned voice, or one of VocalStack's). Saved in the `vocalstack` group as:
  - `translations`: `{ [lang]: { translatedAt, sentences } }`, the transcript's sentences (same ids and times) translated.
  - `speech`: `{ [lang]: { voice, state, error, durationS, requestedAt, renderedAt, sentences } }`. `state` is `queued`, `running`, `failed` or `sealed`; once sealed, `sentences` are the translation in the reading's own timing, with words, for a read-along player.
  - `POST …/vocalstack/translate { langs }` (answers `more: true` when it stopped for time; call again), `DELETE …/vocalstack/translate?lang=`, `POST …/vocalstack/speak { langs, voice? }`, `GET …/vocalstack/speak`, and the public `GET …/vocalstack/audio?lang=`, which redirects to the reading's MP3 (or, with no `lang` or the spoken one, the recording's audio) for anyone who may read the document.
- **Voices** (opt in with `voices`): documents of a collection of people get a sidebar panel to clone that person's voice from a minute of a recording they speak in, or from an uploaded sample, with their permission. Kept in a hidden `vocalstackVoice` group (`voiceId`, `state`: `none`/`training`/`ready`/`failed`, `progress`, `error`, `sampleS`, `consentAt`, `createdAt`), with `GET`/`POST`/`DELETE /api/{collection}/:id/vocalstack/voice`, `…/voice/sources` and `…/voice/preview`.
- **Settings → VocalStack** (a global), where an editor connects an account. The key is stored server-side and is unreadable over the REST and GraphQL APIs.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | none | A `vs_key_…` key with Read and Write. It wins over a key connected in the admin. |
| `collections` | every upload collection that accepts audio | Which upload collections get the button. |
| `audioFields` | none | Audio that isn't an upload document; see below. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `fileURL` | the doc's `url`, made absolute | `({ doc, collection, req }) => string`: the address VocalStack fetches. Point it at your bucket's public URL to skip the Payload file proxy. |
| `access` | signed-in users who can update the doc | Extra check for transcribing, translating, voices and the admin lookups, and for changing the connection. |
| `oneClickConnect` | `false` | Show **Connect VocalStack** (see below). |
| `apiURL` / `dashboardURL` | `https://api.vocalstack.com` / `https://app.vocalstack.com` | |
| `enabled` | `true` | `false` keeps the schema but removes the button and the endpoints. |
| `voices` | none | Collections of people who get a cloned voice; see below. |
| `readings` | `{ slug: 'vocalstack-readings' }` | The upload collection finished readings are kept in, added by the plugin; `overrides: (collection) => collection` adjusts it. `false` streams readings from VocalStack instead. See below for bringing your own. |
| `speechVoice` | VocalStack's default | `({ collection, doc, row, req }) => voice`: the voice a transcript's translations are read in, e.g. its speaker's (`clonedVoiceKey(person.vocalstackVoice)`). |

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

### Voices

```ts
import { clonedVoiceKey, vocalstackPlugin } from '@vocalstack/payload'

vocalstackPlugin({
  voices: [
    {
      collection: 'speakers',
      // Recordings this speaker is in, offered as the sample to clone from.
      recordings: async ({ doc, req }) => {
        const { docs } = await req.payload.find({ collection: 'episodes', where: { speaker: { equals: doc.id } }, req })
        return docs.flatMap((e) => (e.vocalstack?.recordingId ? [{ label: e.title, recordingId: e.vocalstack.recordingId, sentences: e.vocalstack.sentences }] : []))
      },
    },
  ],
  // Read each episode's translations in its speaker's voice, once there is one.
  speechVoice: async ({ doc, req }) => {
    const speaker = await req.payload.findByID({ collection: 'speakers', id: doc.speaker as number, req })
    return clonedVoiceKey(speaker.vocalstackVoice)
  },
})
```

A sample from a recording can only come from the recordings `recordings` returns for that document: cloning, and hearing a stretch first (`GET /:id/vocalstack/voice/clip`), refuse any other.

Cloning needs at least 30 seconds of the person speaking alone (a minute is better, at most two), and the editor confirms they have the person's permission. From a recording, the editor clicks where the stretch starts and hears it before cloning; the plugin takes it from VocalStack. An uploaded sample is sent through your server, so on hosts that cap request bodies (Vercel: 4.5 MB) keep it to a minute or two of MP3 or M4A. Training takes a few minutes; the panel follows it. Deleting the voice deletes it in VocalStack too.

### Translations and readings

Translating an hour-long transcript takes a few minutes; the admin keeps calling until it is done, and what is translated is saved as it goes. A reading is rendered by VocalStack (a few languages at a time per recording) and saved once ready. The reading keeps each sentence where it was said, unless the one before still runs, so a player can follow along with `speech[lang].sentences` (`timedTokens()` works on them as on the transcript).

**Everything is asked for once and kept.** The transcript (text, sentences, word times) and each translation are saved on the document. Translating again only asks for sentences that have none, and reads ones VocalStack already translated back from `/transcript?lang=` rather than translating them again. A finished reading's MP3 is downloaded once and saved as an upload in the `vocalstack-readings` collection (option `readings`), so listeners are served from your storage: `GET …/vocalstack/audio` redirects to that file, or for the spoken language to your own audio file, and only falls back to VocalStack while a reading isn't kept yet. Point your storage adapter at the readings collection, e.g. `s3Storage({ collections: { 'vocalstack-readings': { prefix: 'readings', disablePayloadAccessControl: true } } })` for direct public URLs.

**The readings collection.** By default the plugin adds `vocalstack-readings`: public read, and create, update and delete for signed-in users. Change it with `readings: { overrides: (collection) => ({ ...collection, access: { ... } }) }`, or define an upload collection with that slug (or `readings.slug`) yourself; the plugin then uses yours as it is. It needs to accept `audio/mpeg` and to have text fields `lang`, `recordingId` and `voice`.

When VocalStack does not answer (an outage, an upgrade), the endpoints say *VocalStack is unavailable, try again shortly.* instead of waiting.

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
