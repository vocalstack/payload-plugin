import type { CollectionSlug, Endpoint, Payload, PayloadRequest } from 'payload'

import { after } from 'next/server.js'
import { createLocalReq } from 'payload'

import type {
  AudioFieldConfig,
  VoiceMode,
  ListenStatus,
  Speech,
  SpeechResponse,
  TranscriptSentence,
  Translation,
  VocalStackFieldData,
  VocalStackPluginOptions,
} from '../types.js'

import { DEFAULT_API_URL, type SpeakAs, UNAVAILABLE, VocalStackAPI, VocalStackAPIError, type VoiceTrack } from '../api.js'
import { allowNewLanguage, forListeners, LANGUAGE_LIMIT, languageList, listenerOptions } from '../languages.js'
import { readingsSlug } from '../readings.js'
import { resolveAPIKey } from '../settings.js'
import { spokenSentences } from '../text.js'
import { apiError, canUpdate, locate, type Target } from './transcribe.js'

const json = (body: unknown, status = 200, headers?: Record<string, string>) => Response.json(body, { headers, status })

// Translating is slow (an hour-long recording takes minutes): batches run side by side, and a call
// stops starting new ones after a while so it answers before the host's time limit.
// What is done is saved each time.
const BATCH = 30
const PARALLEL = 4
const BUDGET_MS = 150_000
// A step of translating: saved when it ends, so whoever watches sees the count go up.
const STEP_MS = 20_000
// How long work carries on after a response (the host's time limit is longer).
const BACKGROUND_MS = 120_000

const LANG = /^[a-z]{2,3}(-[a-z0-9]+)?$/i

/** The transcript's sentences that can be translated: settled, numbered, with text. */
const translatable = (data: VocalStackFieldData): TranscriptSentence[] =>
  ((Array.isArray(data.sentences) ? data.sentences : []) as TranscriptSentence[]).filter((s) => !s.draft && s.id !== undefined && s.text.trim())

/** Whether a language is fully translated (older translations, made before `pending`, are). */
export const isTranslated = (t: null | Translation | undefined): boolean => Boolean(t && !t.pending && !t.error && t.sentences?.length)

/** The languages a transcript has (translated or read, asked for or done), besides the one it was spoken in. */
const languagesInUse = (data: VocalStackFieldData): Set<string> => {
  const used = new Set([...Object.keys(data.translations ?? {}), ...Object.keys(data.speech ?? {})])
  if (data.language) used.delete(data.language)
  return used
}

/** The languages of `langs` that would go past the limit: none when they all fit. */
const pastLimit = (data: VocalStackFieldData, langs: string[]): string[] => {
  const used = languagesInUse(data)
  const fresh = langs.filter((l) => !used.has(l))
  return used.size + fresh.length > LANGUAGE_LIMIT ? fresh : []
}

const limitError = (data: VocalStackFieldData) =>
  json(
    {
      code: 'language_limit_reached',
      error: `This recording is already in ${LANGUAGE_LIMIT} languages, as many as one recording may have. Use one of those, or remove one first.`,
      languages: [...languagesInUse(data)],
    },
    409,
  )

/** VocalStack said no for good (a language it will not do, the language limit): asking again will not help. */
const isPermanent = (err: unknown) => err instanceof VocalStackAPIError && [400, 403, 404, 409, 422].includes(err.status) && err.code !== 'unavailable'

/** Translate what is still missing in `lang`, within the time budget, and save it. Whether some is left, and the field as saved. */
async function translate(api: VocalStackAPI, target: Target, lang: string, deadline: number): Promise<{ data: VocalStackFieldData; more: boolean }> {
  const sentences = translatable(target.data)
  const have = new Map((target.data.translations?.[lang]?.sentences ?? []).map((s) => [s.id, s.text]))
  const missing = sentences.filter((s) => !have.get(s.id)).map((s) => s.id!)
  const batches: number[][] = []
  const got = new Map<number, string>()
  let failure: unknown
  // What VocalStack translated before (for anyone) costs nothing to read back; only the rest is translated.
  if (missing.length) {
    try {
      const stored = await api.storedTranslations(target.data.recordingId!, lang)
      for (const id of missing) if (stored[String(id)]?.trim()) got.set(id, stored[String(id)].trim())
    } catch (err) {
      if (isPermanent(err)) throw err
      // Not readable just now: translate them all instead.
    }
    const left = missing.filter((id) => !got.has(id))
    for (let i = 0; i < left.length; i += BATCH) batches.push(left.slice(i, i + BATCH))
  }
  /** Save what is translated so far (each batch, so whoever watches sees it go up), and at the end whether some is left. */
  const write = (end?: { more: boolean }) =>
    target.save((current) => {
      const before = current.translations?.[lang]
      const known = new Map((before?.sentences ?? []).map((s) => [s.id, s.text]))
      const translation: Translation = {
        ...before,
        error: null,
        sentences: translatable(current).flatMap(({ end, id, speaker, start }) => {
          const text = got.get(id!) ?? known.get(id)
          return text ? [{ end, id, speaker, start, text }] : []
        }),
        translatedAt: new Date().toISOString(),
        ...(end && before?.pending ? { pending: end.more } : {}),
      }
      return { translations: { ...current.translations, [lang]: translation } }
    })
  const worker = async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
      if (Date.now() > deadline || failure) {
        batches.unshift(batch)
        return
      }
      try {
        const { translations } = await api.translation(target.data.recordingId!, lang, batch)
        for (const [id, text] of Object.entries(translations)) if (text?.trim()) got.set(Number(id), text.trim())
        // More to come in this call: show this much now.
        if (batches.length) await write().catch(() => undefined)
      } catch (err) {
        failure ??= err
        batches.unshift(batch)
      }
    }
  }
  // Read back from VocalStack's store: show those straight away, before translating the rest.
  if (got.size && batches.length) await write().catch(() => undefined)
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  // Nothing came back at all: say why, rather than "call again" forever.
  if (failure && !got.size) throw failure
  // Batches not sent (out of time, or after a failure) are what is left. A few sentences
  // VocalStack will not translate (it answers nothing for them) do not keep it going.
  const more = batches.length > 0
  // VocalStack answers an empty set when its translator is down, so for a language with
  // no translation yet that is unavailable too.
  if (missing.length && !got.size && !have.size && !more) throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)

  const wasPending = Boolean(target.data.translations?.[lang]?.pending)
  if (!got.size && !(wasPending && !more)) return { data: target.data, more }
  return { data: await write({ more }), more }
}

/** A file name from the recording's name: `episode-12-ro.mp3`. */
const readingName = (target: Target, lang: string, voice: null | string) =>
  `${(target.name || target.fileName.replace(/\.[^.]+$/, '')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'reading'}-${lang}${voice ? '-' + voice.replace(/[^\w-]+/g, '-') : ''}.mp3`

/**
 * Download a finished reading's MP3 from VocalStack, once, and keep it as an upload in
 * the readings collection, so listeners are served from the site's storage from then on.
 */
async function keepReading(req: PayloadRequest, api: VocalStackAPI, slug: CollectionSlug, target: Target, lang: string, speech: Speech): Promise<Speech> {
  if (speech.audio || speech.state !== 'sealed') return speech
  // The reading's track by its key (`cast:…`), or the default voice for older (`''`) tracks.
  // A key the API does not take (400) is followed by the default.
  const keys = [...new Set([speech.voice || undefined, undefined])]
  let res: Response | undefined
  for (const voice of keys) {
    const src = await api.audioURL(target.data.recordingId!, { kind: 'voice', lang, voice })
    // The first ask makes the MP3 (a long reading takes a while); VocalStack finishes it even
    // when this gives up, and a later look finds it ready.
    res = await fetch(src, { signal: AbortSignal.timeout(90_000) })
    if (res.status !== 400) break
  }
  // The track is not there to keep any more (VocalStack re-reads a reading when its clone is
  // rebuilt, or found nothing to read aloud): follow it as being made again, so the next look
  // reads its state instead of downloading it forever.
  if (res?.status === 404) return { ...speech, done: 0, error: null, requestedAt: new Date().toISOString(), state: 'running' }
  if (!res?.ok) throw new VocalStackAPIError(502, 'unavailable', UNAVAILABLE)
  const data = Buffer.from(await res.arrayBuffer())
  const doc = (await req.payload.create({
    collection: slug,
    data: { lang, recordingId: target.data.recordingId, voice: speech.voice ?? '' },
    file: { data, mimetype: 'audio/mpeg', name: readingName(target, lang, speech.voice), size: data.length },
    overrideAccess: true,
    req,
  })) as unknown as { filename?: null | string; id: number | string; url?: null | string }
  return { ...speech, audio: { filename: doc.filename ?? null, id: doc.id, url: doc.url ?? '' } }
}

/** Readings being downloaded right now, so overlapping status checks fetch each one once. */
const keeping = new Set<string>()

/** Remove a reading's kept file (it is being replaced, or its language dropped). */
async function dropReading(req: PayloadRequest, slug: CollectionSlug | undefined, speech: Speech | undefined) {
  if (!slug || !speech?.audio) return
  await req.payload.delete({ collection: slug, id: speech.audio.id, overrideAccess: true, req }).catch(() => {})
}

/** Delete kept readings of this recording, in these languages, that the field does not point to. */
async function sweepReadings(req: PayloadRequest, slug: CollectionSlug, data: VocalStackFieldData, langs: string[]) {
  if (!data.recordingId || !langs.length) return
  const found = await req.payload.find({
    collection: slug,
    depth: 0,
    limit: 50,
    overrideAccess: true,
    pagination: false,
    req,
    where: { and: [{ recordingId: { equals: data.recordingId } }, { lang: { in: langs } }] },
  })
  const keep = new Set(langs.map((l) => data.speech?.[l]?.audio?.id).filter((id) => id !== undefined).map(String))
  for (const doc of found.docs) if (!keep.has(String(doc.id))) await req.payload.delete({ collection: slug, id: doc.id, overrideAccess: true, req }).catch(() => {})
}

/**
 * The track VocalStack is making for this language: the one keyed as it answered when asked.
 * Older readings were keyed `''`; a new one is keyed by the cast it resolved to (`cast:…`).
 */
function trackFor(tracks: VoiceTrack[], lang: string, speech: Speech) {
  const mine = tracks.filter((t) => t.lang === lang)
  if (speech.voice) return mine.find((t) => keyOf(t) === speech.voice)
  return mine.find((t) => keyOf(t) && t.state !== 'clips') ?? mine.find((t) => t.voiceKey === '')
}

/** A track's key, which `/audio?voice=` takes: its cast (`cast:0=M1;1=F1`), or `''` on older tracks. */
const keyOf = (t: VoiceTrack) => t.voiceKey

/** The key VocalStack gave the reading it just took on for `lang`. */
const askedKey = (tracks: VoiceTrack[] | undefined, lang: string): null | string => {
  const mine = (Array.isArray(tracks) ? tracks : []).filter((t) => t.lang === lang)
  const found = mine.find((t) => keyOf(t) && (t.state === 'queued' || t.state === 'running')) ?? mine.find((t) => keyOf(t))
  return found ? keyOf(found) : null
}

/** The voices readings of this transcript are made in: the site's say (`voiceMode`), else the transcript's toggle. */
async function voiceModeOf(
  req: PayloadRequest,
  collection: CollectionSlug,
  options: VocalStackPluginOptions,
  target: Target,
): Promise<{ as: SpeakAs; fixed: boolean; mode: VoiceMode }> {
  const decided = await options.voiceMode?.({ collection, doc: target.doc, req, row: target.row })
  if (decided === 'cloned' || decided === 'synthetic') return { as: { cloned: decided === 'cloned' }, fixed: true, mode: decided }
  const mode = target.data.voices === 'cloned' ? 'cloned' : 'synthetic'
  return { as: { cloned: mode === 'cloned' }, fixed: false, mode }
}


/** A spoken translation brought up to date from VocalStack's track. */
function settle(speech: Speech, track: undefined | VoiceTrack, translation: Translation | undefined): Speech {
  if (!track) {
    // Asked for but not listed (yet): a job is created with the request, so give it a little while.
    const age = Date.now() - new Date(speech.requestedAt).getTime()
    return age < 120_000 ? speech : { ...speech, error: 'VocalStack has no reading of this language. Try again.', state: 'failed' }
  }
  if (track.state === 'failed') return { ...speech, error: track.error ?? 'The reading failed.', state: 'failed' }
  const readIn = track.voices ?? speech.readIn ?? null
  if (track.state !== 'sealed') return { ...speech, done: track.clips?.length ?? 0, error: null, readIn, state: track.state === 'queued' ? 'queued' : 'running', voice: keyOf(track) || speech.voice }
  return {
    ...speech,
    readIn,
    voice: keyOf(track) || speech.voice,
    done: null,
    durationS: track.durationS ?? null,
    error: null,
    renderedAt: new Date().toISOString(),
    sentences: spokenSentences(translation?.sentences ?? [], track.clipDur ?? {}, track.wordTimes ?? {}),
    state: 'sealed',
  }
}

/** What is left to do on a transcript's languages. */
function waiting(data: VocalStackFieldData, readings: CollectionSlug | undefined) {
  const all = Object.entries(data.speech ?? {})
  return {
    /** Readings VocalStack is making. */
    pending: all.filter(([, s]) => s.state === 'queued' || s.state === 'running'),
    /** Translations still to finish, and readings waiting for theirs. */
    translating: [
      ...new Set([
        ...Object.entries(data.translations ?? {})
          .filter(([, t]) => t.pending)
          .map(([l]) => l),
        ...all.filter(([, s]) => s.state === 'translating').map(([l]) => l),
      ]),
    ],
    /** Finished readings whose file is not kept yet: made before readings were kept, or a download that failed. */
    unkept: readings ? all.filter(([, s]) => s.state === 'sealed' && !s.audio) : [],
  }
}

const hasWork = (data: VocalStackFieldData, readings: CollectionSlug | undefined) => {
  const w = waiting(data, readings)
  return Boolean(w.pending.length || w.translating.length || w.unkept.length)
}

/**
 * Bring readings up to date from VocalStack, and keep each finished one's file (once;
 * after that VocalStack is not asked for it again). The field as saved.
 */
async function refresh(req: PayloadRequest, api: VocalStackAPI, readings: CollectionSlug | undefined, target: Target, key: string): Promise<VocalStackFieldData> {
  const { pending, unkept } = waiting(target.data, readings)
  if ((!pending.length && !unkept.length) || !target.data.recordingId) return target.data
  const next: Record<string, Speech> = {}
  if (pending.length) {
    const tracks = await api.voiceTracks(target.data.recordingId)
    for (const [lang, speech] of pending) {
      const settled = settle(speech, trackFor(tracks, lang, speech), target.data.translations?.[lang])
      if (settled.state !== speech.state || settled.error !== speech.error || settled.done !== speech.done) next[lang] = settled
    }
  }
  if (readings) {
    for (const [lang, speech] of [...unkept, ...Object.entries(next)]) {
      if (keeping.has(`${key}:${lang}`)) continue
      keeping.add(`${key}:${lang}`)
      try {
        next[lang] = await keepReading(req, api, readings, target, lang, next[lang] ?? speech)
      } catch {
        // Not now: it is still playable from VocalStack, and the next look tries again.
      } finally {
        keeping.delete(`${key}:${lang}`)
      }
    }
  }
  if (!Object.keys(next).length) return target.data
  const losers: Speech[] = []
  const saved = await target.save((current) => {
    const merged = { ...current.speech }
    for (const [lang, s] of Object.entries(next)) {
      // Kept by an overlapping request meanwhile (another server): theirs stays, ours goes.
      const theirs = current.speech?.[lang]?.audio
      if (theirs && s.audio && theirs.id !== s.audio.id) {
        losers.push(s)
        merged[lang] = { ...s, audio: theirs }
      } else merged[lang] = s
    }
    return { speech: merged }
  })
  for (const loser of losers) await dropReading(req, readings, loser)
  // Requests on other servers can still both keep a reading: whatever the document
  // does not point to, for these languages of this recording, is a spare copy.
  if (readings) await sweepReadings(req, readings, saved, Object.keys(next))
  return saved
}

/**
 * Carry every language of a transcript forward, as far as `budgetMs` allows: translate what
 * is asked for, step by step (each step saved), ask VocalStack to read each one aloud once its
 * translation is done, then bring readings up to date and keep their files. The field as saved.
 */
async function advance(
  req: PayloadRequest,
  api: VocalStackAPI,
  readings: CollectionSlug | undefined,
  target: Target,
  key: string,
  budgetMs: number,
  speakAs: () => Promise<SpeakAs>,
): Promise<VocalStackFieldData> {
  const deadline = Date.now() + budgetMs
  let data = target.data
  const at = () => ({ ...target, data })

  for (const lang of waiting(data, readings).translating) {
    if (!data.translations?.[lang]?.pending) continue
    try {
      for (let more = true; more && Date.now() < deadline; ) {
        const step = await translate(api, at(), lang, Math.min(deadline, Date.now() + STEP_MS))
        data = step.data
        more = step.more
      }
    } catch (err) {
      // For good (a language VocalStack will not do, the limit): stop. Otherwise say why and try again later.
      const permanent = isPermanent(err)
      const error = err instanceof Error ? err.message : String(err)
      data = await target.save((current) => {
        const t = current.translations?.[lang]
        const s = current.speech?.[lang]
        return {
          translations: { ...current.translations, [lang]: { sentences: [], translatedAt: null, ...t, error, ...(permanent ? { pending: false } : {}) } },
          ...(permanent && s?.state === 'translating' ? { speech: { ...current.speech, [lang]: { ...s, error, state: 'failed' } } } : {}),
        }
      })
    }
  }

  // Readings waiting for a translation that is now done.
  for (const [lang, s] of Object.entries(data.speech ?? {})) {
    if (s.state !== 'translating' || !isTranslated(data.translations?.[lang]) || Date.now() > deadline + 30_000) continue
    try {
      const as = await speakAs()
      const tracks = await api.speak(data.recordingId!, [lang], as)
      const requestedAt = new Date().toISOString()
      const voice = askedKey(tracks, lang)
      data = await target.save((current) => ({
        speech: { ...current.speech, [lang]: { ...current.speech?.[lang], cast: as.cloned ? 'cloned' : 'synthetic', error: null, requestedAt, state: 'queued', voice } },
      }))
    } catch (err) {
      // Busy (a few readings at a time per recording): it stays waiting and is asked for again later.
      if (!isPermanent(err)) continue
      const error = err instanceof Error ? err.message : String(err)
      data = await target.save((current) => ({ speech: { ...current.speech, [lang]: { ...s, error, state: 'failed' } } }))
    }
  }

  return refresh(req, api, readings, at(), key)
}

/**
 * Ask for languages: each is translated (if it is not yet) and, with `speak`, read aloud once
 * translated, in the voice VocalStack picks. Only marks them; `advance` does the work. The field as saved.
 */
async function requestLanguages(target: Target, langs: string[], opts: { speak: (lang: string) => boolean }): Promise<VocalStackFieldData> {
  const requestedAt = new Date().toISOString()
  return target.save((current) => {
    const translations = { ...current.translations }
    const speech = { ...current.speech }
    for (const lang of langs) {
      const t = translations[lang]
      // New, or failed before: ask again. Pending or done: as it is.
      if (!t || (!t.pending && (t.error || !t.sentences?.length))) {
        translations[lang] = { sentences: t?.sentences ?? [], translatedAt: t?.translatedAt ?? null, error: null, pending: true, requestedAt }
      }
      const s = speech[lang]
      if (opts.speak(lang) && (!s || s.state === 'failed')) speech[lang] = { error: null, requestedAt, state: 'translating', voice: null }
    }
    return { speech, translations }
  })
}

/** Where one language stands, for a listener. */
function listenStatus(data: VocalStackFieldData, lang: string, voice: boolean, readings: CollectionSlug | undefined): ListenStatus {
  const total = translatable(data).length
  const t = data.translations?.[lang]
  const s = data.speech?.[lang]
  const state: ListenStatus['state'] = !t ? 'none' : t.pending ? 'translating' : t.error || !t.sentences?.length ? 'failed' : 'ready'
  const speech: ListenStatus['speech'] = !s
    ? null
    : {
        audio: s.audio?.url ?? null,
        done: s.done ?? null,
        error: s.error ?? null,
        state:
          s.state === 'failed'
            ? 'failed'
            : s.state === 'translating'
              ? 'waiting'
              : s.state === 'sealed' && (s.audio || !readings)
                ? 'ready'
                : 'reading',
      }
  return {
    done: Math.min(t?.sentences?.length ?? 0, total),
    error: t?.error ?? null,
    lang,
    speech,
    state,
    total,
    version: [t?.translatedAt ?? '', s?.renderedAt ?? '', s?.audio?.id ?? ''].join('|'),
    voice,
  }
}

/** When each document's languages were last carried forward here, so reads ask VocalStack now and then, not every time. */
const lookedAt = new Map<string, number>()
const LOOK_EVERY_MS = 20_000
/** Documents being carried forward right now on this server. */
const working = new Set<string>()

/**
 * Carry a document's languages forward after the response (kept alive until done), so
 * translations and readings finish for listeners with no one watching them.
 */
function background(
  payload: Payload,
  collection: CollectionSlug,
  options: VocalStackPluginOptions,
  rowFields: AudioFieldConfig[],
  id: number | string,
  where: undefined | { field: string; row: string },
  force = false,
) {
  const key = `${collection}:${id}:${where?.row ?? ''}`
  if (working.has(key)) return
  if (!force && Date.now() - (lookedAt.get(key) ?? 0) < LOOK_EVERY_MS) return
  lookedAt.set(key, Date.now())
  working.add(key)
  const work = async () => {
    const req = await createLocalReq({ urlSuffix: where ? `?${new URLSearchParams(where)}` : '' }, payload)
    req.routeParams = { id }
    const apiKey = await resolveAPIKey(req, options)
    if (!apiKey) return
    const target = await locate(req, collection, options, rowFields, 'admin')
    if (target instanceof Response) return
    await advance(req, new VocalStackAPI(apiKey, options.apiURL ?? DEFAULT_API_URL), readingsSlug(options), target, key, BACKGROUND_MS, async () => {
      const fresh = await locate(req, collection, options, rowFields, 'admin')
      return (await voiceModeOf(req, collection, options, fresh instanceof Response ? target : fresh)).as
    })
  }
  const run = () =>
    work()
      .catch((err) => payload.logger.warn({ err, msg: `VocalStack: could not carry on with the languages of ${key}` }))
      .finally(() => working.delete(key))
  try {
    // On a request: after the response, kept alive until done.
    after(run)
  } catch {
    // Outside a request (a script, or work started by other work): just carry on in the background.
    void run()
  }
}

/** The row a request addresses (`?field=&row=`), for carrying it forward in the background. */
const rowOf = (req: PayloadRequest) => {
  const field = req.searchParams.get('field')
  return field ? { field, row: req.searchParams.get('row') ?? '' } : undefined
}

/**
 * A document was read with work still left on its languages: carry it forward after the
 * response, so a translation or reading is ready for listeners without an editor watching.
 */
export function refreshAfterRead(
  payload: Payload,
  collection: CollectionSlug,
  options: VocalStackPluginOptions,
  rowFields: AudioFieldConfig[],
  id: number | string,
  data: null | undefined | VocalStackFieldData,
  where?: { field: string; row: string },
) {
  if (!data?.recordingId || !hasWork(data, readingsSlug(options))) return
  background(payload, collection, options, rowFields, id, where)
}

/**
 * Translations of a transcript, and spoken readings of them, on the same document or
 * row as the transcript (`?field=&row=` as for transcribing):
 *   POST   /:id/vocalstack/translate  { langs }                  translate (call again while `more`)
 *   DELETE /:id/vocalstack/translate?lang=                       drop a language, spoken reading too
 *   POST   /:id/vocalstack/voices     { voices }                 'cloned' or 'synthetic', for readings from now on
 *   POST   /:id/vocalstack/request    { langs, speak? }          translate and read aloud, carried on by the server
 *   POST   /:id/vocalstack/speak      { langs }                  read translations aloud (VocalStack picks the voice)
 *   GET    /:id/vocalstack/speak                                 where the readings stand
 *   GET    /:id/vocalstack/audio?lang=                           public: the audio, or its reading in `lang`
 * With `listeners` on, for anyone who may read the document:
 *   GET    /:id/vocalstack/listen?lang=                          where a language stands
 *   POST   /:id/vocalstack/listen     { lang }                   ask for a language
 */
export function speechEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[] {
  const apiURL = options.apiURL ?? DEFAULT_API_URL
  const readings = readingsSlug(options)
  const listeners = listenerOptions(options)
  const keyOf = (req: PayloadRequest) => `${collection}:${req.routeParams?.id}:${req.searchParams.get('row') ?? ''}`
  const carryOn = (req: PayloadRequest, force = false) =>
    background(req.payload, collection, options, rowFields, req.routeParams?.id as string, rowOf(req), force)

  /** An editor's target with a finished transcript, and the API to work on it. */
  const editable = async (req: PayloadRequest, verb: string): Promise<Response | { api: VocalStackAPI; target: Target }> => {
    const id = req.routeParams?.id as string
    if (!(await canUpdate(req, collection, id))) return json({ error: `You may not ${verb} this transcript.` }, 403)
    if (options.access && !(await options.access({ req }))) return json({ error: `You may not ${verb} this transcript.` }, 403)
    const apiKey = await resolveAPIKey(req, options)
    if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
    const target = await locate(req, collection, options, rowFields, 'admin')
    if (target instanceof Response) return target
    if (target.data.status !== 'done' || !target.data.recordingId) return json({ error: 'Transcribe the audio first.' }, 409)
    return { api: new VocalStackAPI(apiKey, apiURL), target }
  }

  /** The body's languages (none of them the spoken one), and whether to read them aloud. VocalStack picks the voice. */
  const bodyOf = async (req: PayloadRequest, spoken?: null | string): Promise<undefined | { langs: string[]; speak: boolean }> => {
    const body = (await req.json?.().catch(() => ({}))) as { langs?: unknown; speak?: unknown }
    const langs = Array.isArray(body.langs) ? [...new Set(body.langs.map(String).map((l) => l.toLowerCase()))] : []
    if (!langs.length || langs.some((l) => !LANG.test(l) || l === spoken)) return undefined
    return { langs, speak: body.speak !== false }
  }

  const endpoints: Endpoint[] = [
    {
      method: 'post',
      path: '/:id/vocalstack/translate',
      handler: async (req) => {
        const found = await editable(req, 'translate')
        if (found instanceof Response) return found
        const { api, target } = found
        const asked = await bodyOf(req, target.data.language)
        if (!asked) return json({ error: 'Name the languages to translate into.' }, 400)
        if (pastLimit(target.data, asked.langs).length) return limitError(target.data)
        const deadline = Date.now() + STEP_MS
        try {
          let more = false
          let data = target.data
          for (const lang of asked.langs) {
            if (Date.now() > deadline) {
              more = true
              continue
            }
            const done = await translate(api, { ...target, data }, lang, deadline)
            data = done.data
            more ||= done.more
          }
          return json({ more, vocalstack: data } satisfies SpeechResponse)
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'delete',
      path: '/:id/vocalstack/translate',
      handler: async (req) => {
        const found = await editable(req, 'change')
        if (found instanceof Response) return found
        const lang = req.searchParams.get('lang') ?? ''
        await dropReading(req, readings, found.target.data.speech?.[lang])
        const vocalstack = await found.target.save((current) => {
          const { [lang]: _t, ...translations } = current.translations ?? {}
          const { [lang]: _s, ...speech } = current.speech ?? {}
          return { speech, translations }
        })
        return json({ vocalstack } satisfies SpeechResponse)
      },
    },
    {
      // Readings from now on in speakers' cloned voices, or in stock ones. Readings made before stay as they are.
      method: 'post',
      path: '/:id/vocalstack/voices',
      handler: async (req) => {
        const found = await editable(req, 'change')
        if (found instanceof Response) return found
        const body = (await req.json?.().catch(() => ({}))) as { voices?: unknown }
        if (body.voices !== 'cloned' && body.voices !== 'synthetic') return json({ error: 'Choose cloned or synthetic voices.' }, 400)
        const voices = body.voices
        const vocalstack = await found.target.save(() => ({ voices }))
        return json({ vocalstack } satisfies SpeechResponse)
      },
    },
    {
      method: 'post',
      path: '/:id/vocalstack/request',
      handler: async (req) => {
        const found = await editable(req, 'translate')
        if (found instanceof Response) return found
        const { target } = found
        const asked = await bodyOf(req, target.data.language)
        if (!asked) return json({ error: 'Name the languages to add.' }, 400)
        if (pastLimit(target.data, asked.langs).length) return limitError(target.data)
        const voiced = new Set((await languageList(req, options)).voice)
        const vocalstack = await requestLanguages(target, asked.langs, { speak: (l) => asked.speak && voiced.has(l) })
        carryOn(req, true)
        return json({ vocalstack } satisfies SpeechResponse, 202)
      },
    },
    {
      method: 'post',
      path: '/:id/vocalstack/speak',
      handler: async (req) => {
        const found = await editable(req, 'read out')
        if (found instanceof Response) return found
        const { api, target } = found
        const asked = await bodyOf(req, target.data.language)
        if (!asked) return json({ error: 'Name the languages to read out.' }, 400)
        if (pastLimit(target.data, asked.langs).length) return limitError(target.data)
        try {
          // A reading speaks the translation: those not translated yet are read once they are.
          const ready = asked.langs.filter((l) => isTranslated(target.data.translations?.[l]))
          const later = asked.langs.filter((l) => !ready.includes(l))
          let data = target.data
          if (ready.length) {
            const { as } = await voiceModeOf(req, collection, options, target)
            const tracks = await api.speak(target.data.recordingId!, ready, as)
            for (const lang of ready) await dropReading(req, readings, data.speech?.[lang])
            const requestedAt = new Date().toISOString()
            const cast = as.cloned ? 'cloned' : 'synthetic'
            data = await target.save((current) => ({
              speech: {
                ...current.speech,
                ...Object.fromEntries(ready.map((l) => [l, { cast, error: null, requestedAt, state: 'queued', voice: askedKey(tracks, l) } satisfies Speech])),
              },
            }))
          }
          if (later.length) {
            data = await requestLanguages({ ...target, data }, later, { speak: () => true })
            carryOn(req, true)
          }
          return json({ vocalstack: data } satisfies SpeechResponse, 202)
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/speak',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Sign in first.' }, 401)
        const target = await locate(req, collection, options, rowFields, 'user')
        if (target instanceof Response) return target
        const { fixed, mode } = await voiceModeOf(req, collection, options, target)
        const voiceMode = { fixed, mode }
        const answer = (vocalstack: VocalStackFieldData) => json({ vocalstack, voiceMode } satisfies SpeechResponse)
        if (!target.data.recordingId || !hasWork(target.data, readings)) return answer(target.data)
        // Translating goes on in the background; readings are looked at now.
        if (waiting(target.data, readings).translating.length) carryOn(req)
        if (working.has(keyOf(req))) return answer(target.data)
        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
        try {
          return answer(await refresh(req, new VocalStackAPI(apiKey, apiURL), readings, target, keyOf(req)))
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/audio',
      handler: async (req) => {
        // Public: whoever may read the document may listen, signed in or not.
        const target = await locate(req, collection, options, rowFields, 'user')
        if (target instanceof Response) return target
        const { language, recordingId, speech } = target.data
        if (!recordingId) return json({ error: 'No audio.' }, 404)
        const lang = req.searchParams.get('lang')?.toLowerCase()
        const spoken = !lang || lang === language
        const reading = spoken ? undefined : speech?.[lang]
        if (!spoken && reading?.state !== 'sealed') return json({ error: 'There is no reading in that language.' }, 404)

        // Kept files are served from the site's own storage: no VocalStack request.
        const own = spoken ? await target.url().catch(() => undefined) : reading?.audio?.url
        if (own) {
          return new Response(null, { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400', location: new URL(own, req.url ?? 'http://localhost').toString() }, status: 302 })
        }

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ error: 'Not available.' }, 404)
        try {
          const url = await new VocalStackAPI(apiKey, apiURL).audioURL(recordingId, spoken ? { kind: 'delivery' } : { kind: 'voice', lang, voice: reading?.voice ?? undefined })
          // The signed address lasts a while; hand out the same one for a few minutes.
          return new Response(null, { headers: { 'cache-control': 'public, max-age=300, s-maxage=300', location: url }, status: 302 })
        } catch (err) {
          return apiError(err)
        }
      },
    },
  ]

  if (!listeners) return endpoints

  /** A listener's target: readable by them, with a finished transcript. */
  const readable = async (req: PayloadRequest): Promise<Response | Target> => {
    const target = await locate(req, collection, options, rowFields, 'user')
    if (target instanceof Response) return target
    if (target.data.status !== 'done' || !target.data.recordingId) return json({ error: 'There is no transcript to translate yet.' }, 409)
    return target
  }

  /** Done work may be cached a little; work under way is asked about again. */
  const statusHeaders = (s: ListenStatus): Record<string, string> => ({
    'cache-control': s.state === 'ready' && (!s.speech || s.speech.state === 'ready' || s.speech.state === 'failed') ? 'public, max-age=30, s-maxage=30' : 'no-store',
  })

  return [
    ...endpoints,
    {
      method: 'get',
      path: '/:id/vocalstack/listen',
      handler: async (req) => {
        const target = await readable(req)
        if (target instanceof Response) return target
        const lang = req.searchParams.get('lang')?.toLowerCase() ?? ''
        if (!LANG.test(lang)) return json({ error: 'Which language?' }, 400)
        const voiced = new Set(forListeners(await languageList(req, options), listeners).voice)
        if (hasWork(target.data, readings)) carryOn(req)
        const status = listenStatus(target.data, lang, voiced.has(lang), readings)
        return json(status, 200, statusHeaders(status))
      },
    },
    {
      method: 'post',
      path: '/:id/vocalstack/listen',
      handler: async (req) => {
        const target = await readable(req)
        if (target instanceof Response) return target
        const body = (await req.json?.().catch(() => ({}))) as { lang?: unknown }
        const lang = typeof body.lang === 'string' ? body.lang.toLowerCase() : ''
        if (!LANG.test(lang) || lang === target.data.language) return json({ error: 'Which language?' }, 400)
        const offered = forListeners(await languageList(req, options), listeners)
        if (!offered.translation.includes(lang)) return json({ error: 'That language is not offered here.' }, 400)
        const voiced = offered.voice.includes(lang)
        const speak = listeners.speak !== false && voiced

        // Asked for already (by anyone): nothing new to start.
        const now = listenStatus(target.data, lang, voiced, readings)
        const translationAsked = now.state === 'translating' || now.state === 'ready'
        const speechAsked = !speak || (now.speech && now.speech.state !== 'failed')
        if (translationAsked && speechAsked) {
          if (hasWork(target.data, readings)) carryOn(req)
          return json(now, 200, { 'cache-control': 'no-store' })
        }

        if (pastLimit(target.data, [lang]).length) return limitError(target.data)
        if (listeners.access && !(await listeners.access({ lang, req }))) return json({ error: 'You may not ask for a new language here.' }, 403)
        if (!(await resolveAPIKey(req, options))) return json({ error: 'Translations are not available right now.' }, 503)
        if (!allowNewLanguage(req, listeners.perHour ?? 10)) return json({ error: 'Too many new languages asked for; try again later.' }, 429)

        const data = await requestLanguages(target, [lang], { speak: () => speak })
        carryOn(req, true)
        return json(listenStatus(data, lang, voiced, readings), 202, { 'cache-control': 'no-store' })
      },
    },
  ]
}
