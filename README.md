# @vocalstack/payload

VocalStack for [Payload CMS](https://payloadcms.com) 3: a **Transcribe** button on every audio upload. The transcript is saved on the document as text plus timed sentences.

Read more about the [VocalStack transcription plugin for Payload CMS](https://vocalstack.com/payload-cms-transcription-plugin/) on the [VocalStack website](https://vocalstack.com/).

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
- **Translations and readings**, under every finished transcript: translate it into up to 10 of VocalStack's 100 languages (VocalStack's limit per recording), and have each translation read aloud where VocalStack has a voice for it. VocalStack picks the voices; a toggle on each transcript chooses between **synthetic** voices and the speakers' own **cloned** voices (where they have one, made with their permission), saved as `voices`. One click in the admin does both; the server carries on until it is done, with no one watching. Saved in the `vocalstack` group as:
  - `translations`: `{ [lang]: { translatedAt, sentences, pending?, error?, requestedAt? } }`, the transcript's sentences (same ids and times) translated. `pending` while the server is still translating it.
  - `speech`: `{ [lang]: { voice, cast, readIn, state, error, durationS, requestedAt, renderedAt, sentences, audio } }`. `state` is `translating` (waiting for its translation), `queued`, `running`, `failed` or `sealed`; once sealed, `sentences` are the translation in the reading's own timing, with words, for a read-along player, and `audio` is the MP3 kept in your storage.
  - `POST …/vocalstack/voices { voices: 'synthetic' | 'cloned' }`, `POST …/vocalstack/request { langs, speak? }` (translate, and read aloud unless `speak: false`; carried on by the server), `POST …/vocalstack/translate { langs }` (one step; answers `more: true` when it stopped for time), `DELETE …/vocalstack/translate?lang=`, `POST …/vocalstack/speak { langs }`, `GET …/vocalstack/speak`, and the public `GET …/vocalstack/audio?lang=`, which redirects to the reading's MP3 (or, with no `lang` or the spoken one, the recording's audio) for anyone who may read the document.
- **Languages for listeners** (opt in with `listeners`): visitors pick any language VocalStack offers, and it is made for them and kept for everyone after. `GET /api/vocalstack/languages` is public, `POST …/vocalstack/listen { lang }` asks for a language and `GET …/vocalstack/listen?lang=` says where it stands; see below.
- **Speakers** (opt in with `speakers`): documents of a collection of people get a sidebar panel that saves that person as a VocalStack speaker and clones their voice, from a minute of a recording they speak in or from an uploaded sample, with their permission. Kept in a hidden `vocalstackSpeaker` group (`speakerId`, `cloneId`, `state` of the voice: `none`/`training`/`ready`/`failed`, `progress`, `error`, `sampleS`, `consentAt`, `createdAt`), with `GET`/`POST`/`DELETE /api/{collection}/:id/vocalstack/speaker`, `…/speaker/sources` and `…/speaker/preview`.
- **Settings → VocalStack** (a global), where an editor connects an account. The key is stored server-side and is unreadable over the REST and GraphQL APIs.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | none | A `vs_key_…` key with Read and Write. It wins over a key connected in the admin. |
| `collections` | every upload collection that accepts audio | Which upload collections get the button. |
| `audioFields` | none | Audio that isn't an upload document; see below. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `fileURL` | the doc's `url`, made absolute | `({ doc, collection, req }) => string`: the address VocalStack fetches. Point it at your bucket's public URL to skip the Payload file proxy. |
| `access` | signed-in users who can update the doc | Extra check for transcribing, translating, speakers, voices and the admin lookups, and for changing the connection. |
| `oneClickConnect` | `false` | Show **Connect VocalStack** (see below). |
| `updateCheck` | `true` | Say in the admin when a newer version is on npm; see below. `false` makes no outbound call. |
| `apiURL` / `dashboardURL` | `https://api.vocalstack.com` / `https://app.vocalstack.com` | |
| `enabled` | `true` | `false` keeps the schema but removes the button and the endpoints. |
| `speakers` | none | Collections of people saved as VocalStack speakers, each with a cloned voice; see below. (`voices`, its name in 0.5, still works.) |
| `readings` | `{ slug: 'vocalstack-readings' }` | The upload collection finished readings are kept in, added by the plugin; `overrides: (collection) => collection` adjusts it. `false` streams readings from VocalStack instead. See below for bringing your own. |
| `listeners` | off | `true`, or `{ languages?, speak?, access?, perHour? }`: let visitors ask for a transcript in their language; see below. |
| `voiceMode` | the transcript's toggle | `({ collection, doc, req, row }) => 'synthetic' \| 'cloned' \| undefined`: the site decides how transcripts are read aloud, and the toggle is hidden. See below. |

### Updates

The plugin is part of your site's code, so it can't update itself: a new version means changing `package.json`, rebuilding and deploying, and sometimes a migration. It does tell you when one is out. The server asks npm for the newest `@vocalstack/payload` at most every 6 hours (`GET /api/vocalstack/version`, signed-in users), and while a newer one is out the admin nav shows a notice linking to **Settings → VocalStack**, which shows both versions, the release notes and the steps. `VERSION` (from `@vocalstack/payload`) is the installed one.

To have updates proposed for you, let Renovate or Dependabot open a pull request for each release:

```json
// renovate.json
{ "extends": ["config:recommended"], "packageRules": [{ "matchPackageNames": ["@vocalstack/payload"], "labels": ["vocalstack"] }] }
```

After updating, run `payload generate:importmap`, and with Postgres or SQLite `payload migrate:create`.

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

### Speakers

```ts
import { vocalstackPlugin } from '@vocalstack/payload'

vocalstackPlugin({
  speakers: [
    {
      collection: 'speakers',
      // Recordings this speaker is in, offered as the sample to clone from.
      recordings: async ({ doc, req }) => {
        const { docs } = await req.payload.find({ collection: 'episodes', where: { speaker: { equals: doc.id } }, req })
        return docs.flatMap((e) => (e.vocalstack?.recordingId ? [{ label: e.title, recordingId: e.vocalstack.recordingId, sentences: e.vocalstack.sentences, transcriptionId: e.vocalstack.transcriptionId }] : []))
      },
    },
  ],
})
```

A sample from a recording can only come from the recordings `recordings` returns for that document: cloning, and hearing a stretch first (`GET /:id/vocalstack/speaker/clip`), refuse any other. Pass each recording's `transcriptionId` too, or the plugin looks it up.

Cloning needs at least 30 seconds of the person speaking alone (a minute is better, at most two), and the editor confirms they have the person's permission. From a recording, the editor clicks where the stretch starts and hears it before cloning; the plugin takes it from VocalStack. An uploaded sample is sent through your server, so on hosts that cap request bodies (Vercel: 4.5 MB) keep it to a minute or two of MP3 or M4A. Training takes a few minutes; the panel follows it. Deleting the speaker deletes them and their voice in VocalStack too. When VocalStack transcribes a new recording, it checks who speaks against your saved speakers first.

A cloned voice only ever reads words its own speaker said. With `cloned` (from the toggle, or from `voiceMode` once a person has a voice), each speaker VocalStack has matched to a clone is read in it: the speaker it was made from, or one VocalStack recognised as the same person when it transcribed the recording. Everyone else is read in a stock voice. VocalStack doesn't always recognise a speaker, and recordings transcribed before the voice existed are not matched, so a reading reports what it got as `speech[lang].readIn`: `cloned`, `synthetic`, or `mixed`.

```ts
voiceMode: async ({ doc, req }) => {
  const speaker = await req.payload.findByID({ collection: 'speakers', id: doc.speaker, depth: 0, req })
  return speakerData(speaker).state === 'ready' ? 'cloned' : 'synthetic'
}
```

`speakerData(doc)` (from `@vocalstack/payload`) reads the `vocalstackSpeaker` group, or the `vocalstackVoice` group of a document 0.5 saved and nobody has opened since.

### Upgrading from 0.5

0.6 follows VocalStack's rename of saved voices to **speakers** (`/v1/speakers`; a speaker's voice is only the sound, its clone). It talks to VocalStack before and after that change: it calls `/v1/speakers` first and falls back to `/v1/voices` on a 404, so nothing needs doing on the day the API changes.

- **Option**: `voices` is now `speakers`. `voices` is still read when `speakers` is not set. Types: `SpeakerCollectionConfig`, `SpeakerSource`, `SpeakerFieldData`, `CloneState` (the old names are deprecated aliases).
- **Fields**: speaker collections get a new hidden group, `vocalstackSpeaker` (`speakerId`, `cloneId`, and the fields `vocalstackVoice` had). The `vocalstackVoice` group stays in the schema and is kept in step (`voiceId` is the clone's id) for one more minor version, so code reading it keeps working; move it to `speakerData(doc)` or `vocalstackSpeaker`. The sidebar field is now `vocalstackSpeakerPanel` (a UI field, nothing stored).
- **Data**: nothing is lost. A document still holding only `vocalstackVoice` is read through it and copied into `vocalstackSpeaker` the first time its panel opens. To copy them all at once, call `migrateSpeakerFields({ collection, payload, req })` from a migration:

```ts
// migrations/20261107_vocalstack_speakers.ts, after `payload migrate:create`
import { migrateSpeakerFields } from '@vocalstack/payload'
import type { MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ payload, req }: MigrateUpArgs) {
  await migrateSpeakerFields({ collection: 'speakers', payload, req })
}
```

- **Run** `payload generate:importmap` (the panel's component is now `SpeakerField`), and with Postgres or SQLite `payload migrate:create` for the new columns (the old ones are kept).
- **Endpoints**: `/:id/vocalstack/speaker…` replaces `/:id/vocalstack/voice…`; the old paths still answer. Answers carry `vocalstackSpeaker` (and `vocalstackVoice` as before).

### Translations and readings

Translating an hour-long transcript takes a few minutes. The server does it in steps of about 20 seconds, each saved as it goes, and carries on after each response whenever the document is read or its progress is asked for, so an editor can close the page (and a translation started by a listener finishes on its own). A recording has at most 10 languages besides its spoken one; asking for an 11th answers 409 `language_limit_reached`. A reading is rendered by VocalStack (a few languages at a time per recording) and saved once ready. The reading keeps each sentence where it was said, unless the one before still runs, so a player can follow along with `speech[lang].sentences` (`timedTokens()` works on them as on the transcript).

**Everything is asked for once and kept.** The transcript (text, sentences, word times) and each translation are saved on the document. Translating again only asks for sentences that have none, and reads ones VocalStack already translated back from `/transcript?lang=` rather than translating them again. A finished reading's MP3 is downloaded once and saved as an upload in the `vocalstack-readings` collection (option `readings`), so listeners are served from your storage: `GET …/vocalstack/audio` redirects to that file, or for the spoken language to your own audio file, and only falls back to VocalStack while a reading isn't kept yet. Point your storage adapter at the readings collection, e.g. `s3Storage({ collections: { 'vocalstack-readings': { prefix: 'readings', disablePayloadAccessControl: true } } })` for direct public URLs.

**The readings collection.** By default the plugin adds `vocalstack-readings`: public read, and create, update and delete for signed-in users. Change it with `readings: { overrides: (collection) => ({ ...collection, access: { ... } }) }`, or define an upload collection with that slug (or `readings.slug`) yourself; the plugin then uses yours as it is. It needs to accept `audio/mpeg` and to have text fields `lang`, `recordingId` and `voice`.

### Languages for listeners

With `listeners: true`, anyone who may read a document can ask for its transcript in another language, from your own site:

```ts
// What can be asked for: { languages: [{ code, name, native, translation, voice }], translation, voice }
await fetch('/api/vocalstack/languages')
// Ask (on an array row add ?field=&row= as for transcribing). Asked already: answers where it stands.
await fetch(`/api/sermons/${id}/vocalstack/listen`, { method: 'POST', body: JSON.stringify({ lang: 'pl' }) })
// Follow it: { state: 'translating' | 'ready' | 'failed' | 'none', done, total, voice, speech: { state, audio }, version }
await fetch(`/api/sermons/${id}/vocalstack/listen?lang=pl`)
```

The translation is saved on the document, and where VocalStack can read the language aloud, the reading follows (in the voice VocalStack picks) and its MP3 is kept in the readings collection. Once `speech.state` is `ready`, `speech.audio` is that file in your own storage. Nothing is made twice: a language someone already asked for is answered from the document. Visitors can only ask for languages VocalStack offers (narrowed by `languages`), within the 10-language limit, and each one (by IP address) can ask for `perHour` new languages an hour (10 by default); `access: ({ lang, req }) => boolean` adds your own check. The language list keeps working when VocalStack can't be reached: the plugin falls back to its last answer, or to the list it ships with.

**Your site keeps working without VocalStack.** Everything a listener reads or hears (the transcript, every translation, every reading's MP3 and word timings) is served from your database and storage. VocalStack is only needed to make something new.

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

## Releasing

Bump `version` in `package.json` and push to `main`. The `publish` workflow publishes that version to npm (trusted publishing, with provenance), tags `v<version>` and creates the GitHub release. A version npm already has is skipped. A prerelease (`0.5.0-beta.1`) goes to the `next` dist-tag. Nobody publishes from a laptop.
