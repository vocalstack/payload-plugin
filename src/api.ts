/**
 * The VocalStack API calls the plugin needs, made through the VocalStack JS SDK
 * (`@vocalstack/js-sdk`). This adapter keeps the plugin's own shapes and one error
 * type, so an engine that is down reads the same everywhere.
 * Contract: https://api.vocalstack.com/v1/openapi.json
 */

import { VocalStack, VocalStackError } from '@vocalstack/js-sdk'

export const DEFAULT_API_URL = 'https://api.vocalstack.com'
export const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com'

export type JobState = 'cropping' | 'done' | 'failed' | 'fetching' | 'queued' | 'stopped' | 'transcribing'

export type Job = {
  error?: null | string
  /** Why a failed job failed; `stopped` when its owner stopped it. */
  errorCode?: null | string
  progress: { pct: number; phase?: null | string; phasePct?: null | number; processedS?: number; totalS?: null | number }
  state: JobState
  transcriptionId: string
}

export type Transcription = {
  id: string
  job?: Job | null
  name: string
}

export type Transcript = {
  lang?: null | string
  segments: { end: number; seq: number; start: number; suppressed?: boolean; words?: { end: number; start: number; text: string }[] | null }[]
  sentences: {
    end: number
    language?: null | string
    sentenceId: number
    speaker: number
    start: number
    suppressed?: boolean
    text: string
  }[]
}

export type SavedSpeaker = {
  cloneId: null | string
  createdAt: string
  draft?: boolean
  error?: null | string
  id: string
  name: string
  progress: number
  sampleS: number
  state: string
}

type Clone = { draft?: boolean; error?: null | string; id: string; progress?: number; sampleS?: number; state?: string }
type RawSpeaker = Partial<Clone> & { createdAt: string; id: string; name: string; voice?: Clone | null }

function savedSpeakerOf(raw: RawSpeaker): SavedSpeaker {
  const clone = 'voice' in raw ? (raw.voice ?? null) : (raw as Clone)
  return {
    cloneId: clone?.id ?? null,
    createdAt: raw.createdAt,
    draft: raw.draft ?? clone?.draft,
    error: clone?.error ?? null,
    id: raw.id,
    name: raw.name,
    progress: clone?.progress ?? 0,
    sampleS: clone?.sampleS ?? 0,
    state: clone?.state ?? 'none',
  }
}

type SpeakerRoute = 'speakers' | 'voices'
const speakerRoutes = new Map<string, SpeakerRoute>()
type SpeakerInit = { audio?: boolean; body?: (route: SpeakerRoute) => unknown; form?: FormData; idempotencyKey?: string; query?: Record<string, string | undefined> }
const both = (rest: string): Record<SpeakerRoute, string> => ({ speakers: `/v1/speakers${rest}`, voices: `/v1/voices${rest}` })

export type VoiceOption = { cloned: boolean; default: boolean; gender?: null | string; id: string; name: string; quality: number; ready?: boolean }

/** A transcription's spoken translation in one language, in one cast of voices. */
export type VoiceTrack = {
  /** Seconds each sentence's clip lasts, by sentence id. */
  clipDur?: Record<string, number>
  clips: number[]
  durationS?: null | number
  error?: null | string
  lang: string
  /** `queued`, `running`, `failed`, `sealed` (the track is ready), or `clips` (sentences only). */
  state: string
  /** The voice it was asked in by name, if it was. */
  voice?: null | string
  /** The track's key: `''` for the default voice on older tracks, else its cast (`cast:0=M1;1=F1`). */
  voiceKey: string
  /** What it is read in: `cloned`, `synthetic`, or `mixed` (some speakers had no usable clone). Null on older tracks. */
  voices?: 'cloned' | 'mixed' | 'synthetic' | null
  /** Each sentence's words as [start, end] within its clip, by sentence id. */
  wordTimes?: Record<string, [number, number][]>
}

/** How a reading is voiced: in the speakers' cloned voices where VocalStack has them, or in stock voices. */
export type SpeakAs = { cloned: boolean }

export type Language = { code: string; name: string; native: string; translation: boolean; voice: boolean }

export type Languages = {
  languages: Language[]
  translation: string[]
  voice: string[]
}

export const UNAVAILABLE = 'VocalStack is unavailable, try again shortly.'

/** A stored transcription the connected key cannot see: made in another workspace (the workspace was changed), or deleted. */
export const NOT_IN_WORKSPACE =
  'This transcript is not in the connected VocalStack workspace: it was made in another workspace, or deleted in VocalStack. Transcribe the file again to work with it here.'

const isGone = (status: number | undefined, message: string) => status === 404 && /^no such (transcription|job)\b/i.test(message.trim())

export class VocalStackAPIError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** How long a call may take before VocalStack counts as unavailable. Translating and cloning are slow. */
function timeoutFor(url: string, method = 'GET'): number {
  const path = new URL(url).pathname
  if (path.endsWith('/translation')) return 180_000
  if (method === 'POST' && (path === '/v1/speakers' || path === '/v1/voices')) return 120_000
  if (path.endsWith('/audio/clip') || path.endsWith('/preview')) return 60_000
  return 30_000
}

/** One error type: an engine that is down or slow (an upgrade, an outage) is `unavailable`. */
function toAPIError(err: unknown): VocalStackAPIError {
  if (err instanceof VocalStackAPIError) return err
  if (err instanceof VocalStackError) {
    const down = err.code === 'unavailable' || (err.code === 'internal' && (err.status === 502 || err.status === 503 || err.status === 504))
    if (down) return new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
    if (isGone(err.status, err.message)) return new VocalStackAPIError(404, 'not_found', NOT_IN_WORKSPACE)
    return new VocalStackAPIError(err.status ?? 500, err.code, err.message)
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
  return new VocalStackAPIError(500, 'http_error', err instanceof Error ? err.message : String(err))
}

const call = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (err) {
    throw toAPIError(err)
  }
}

export class VocalStackAPI {
  readonly sdk: VocalStack
  readonly #apiKey: string
  readonly #baseURL: string

  constructor(apiKey: string, baseURL = DEFAULT_API_URL) {
    this.#apiKey = apiKey
    this.#baseURL = baseURL.replace(/\/+$/, '')
    this.sdk = new VocalStack({
      apiKey,
      baseUrl: baseURL,
      // One retry of a busy or restarting API; the admin and listeners ask again anyway.
      maxRetries: 1,
      fetch: (input, init) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutFor(String(input instanceof Request ? input.url : input), init?.method)) }),
    })
  }

  me() {
    return call(() => this.sdk.me.get() as unknown as Promise<Record<string, unknown>>)
  }

  transcribeURL(url: string, opts: { idempotencyKey: string; name: string; spokenLanguage?: string }) {
    return call(
      () =>
        this.sdk.transcriptions.create(
          { name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined, url } as never,
          { idempotencyKey: opts.idempotencyKey },
        ) as unknown as Promise<Transcription>,
    )
  }

  transcribeFile(file: Blob, fileName: string, opts: { idempotencyKey: string; name: string; spokenLanguage?: string }) {
    return call(
      () =>
        this.sdk.transcriptions.create(
          { file, fileName, name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined } as never,
          { idempotencyKey: opts.idempotencyKey },
        ) as unknown as Promise<Transcription>,
    )
  }

  async job(transcriptionId: string) {
    try {
      return await call(() => this.sdk.transcriptions.job(transcriptionId) as unknown as Promise<Job>)
    } catch (err) {
      // Any "not found" for a job that was started here means this key cannot see it (a wrong address says "no route").
      if (err instanceof VocalStackAPIError && err.status === 404 && !/^no route\b/i.test(err.message)) throw new VocalStackAPIError(404, 'not_found', NOT_IN_WORKSPACE)
      throw err
    }
  }

  /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
  stop(transcriptionId: string, reason?: string) {
    return call(() => this.sdk.transcriptions.stop(transcriptionId, reason) as Promise<unknown>)
  }

  transcript(transcriptionId: string) {
    return call(() => this.sdk.transcriptions.transcript(transcriptionId) as unknown as Promise<Transcript>)
  }

  /**
   * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
   * answers only the sentences it translates in that call, so stored ones are read here.
   */
  async storedTranslations(transcriptionId: string, lang: string): Promise<Record<string, string>> {
    const t = (await call(() => this.sdk.transcriptions.transcript(transcriptionId, { lang }))) as unknown as {
      sentences?: { sentenceId: number; translations?: null | Record<string, string> }[]
    }
    const out: Record<string, string> = {}
    for (const s of t.sentences ?? []) {
      const text = s.translations?.[lang]
      if (text?.trim()) out[String(s.sentenceId)] = text
    }
    return out
  }

  languages() {
    return call(() => this.sdk.languages.list() as unknown as Promise<Languages>)
  }

  /** Sentences translated into `lang`, by sentence id. Untranslated ones are translated now, which takes a while. */
  translation(transcriptionId: string, lang: string, sentenceIds: number[]) {
    return call(() => this.sdk.transcriptions.translation(transcriptionId, lang, sentenceIds))
  }

  /**
   * Read translations aloud, one job per language. `cloned` reads each speaker in their own cloned
   * voice where VocalStack can use one (a clone of that speaker, made with their permission, or the
   * clone of a saved speaker VocalStack recognised as them) and in a stock voice otherwise; `synthetic` reads
   * everyone in stock voices. Each track says which it got (`voices`: cloned, synthetic or mixed).
   * A clone only ever reads words its own speaker said.
   */
  speak(transcriptionId: string, langs: string[], as: SpeakAs = { cloned: false }): Promise<VoiceTrack[]> {
    return call(() => this.sdk.transcriptions.requestVoice(transcriptionId, { langs, voices: as.cloned ? 'cloned' : 'synthetic' }) as unknown as Promise<VoiceTrack[]>)
  }

  voiceTracks(transcriptionId: string, lang?: string) {
    return call(() => this.sdk.transcriptions.voice(transcriptionId, lang) as unknown as Promise<VoiceTrack[]>)
  }

  /** An address of the transcription's audio, or of a spoken translation's, that works for an hour or so. */
  async audioURL(transcriptionId: string, opts: { format?: 'caf' | 'mp3' | 'ogg'; kind: 'delivery' | 'voice'; lang?: string; voice?: string }): Promise<string> {
    const format = opts.format ?? 'mp3'
    if (opts.kind === 'delivery') return call(() => this.sdk.transcriptions.audio(transcriptionId, { format, kind: 'delivery' }))
    // A reading in a named voice: a short-lived media token carries the voice in the address.
    const { token } = await call(() => this.sdk.transcriptions.mediaToken(transcriptionId))
    return this.sdk.transcriptions.audioSrc(transcriptionId, { format, kind: 'voice', lang: opts.lang, media: token, voice: opts.voice })
  }

  /** A stretch of the transcription's audio as WAV (16 kHz mono), at most 120 s. */
  clip(transcriptionId: string, startS: number, endS: number): Promise<Response> {
    return call(() => this.sdk.transcriptions.audioClip(transcriptionId, startS, endS))
  }

  async #speakerRequest(method: string, paths: Partial<Record<SpeakerRoute, string>>, init: SpeakerInit = {}): Promise<Response> {
    const first = speakerRoutes.get(this.#baseURL) ?? 'speakers'
    const order: SpeakerRoute[] = first === 'speakers' ? ['speakers', 'voices'] : ['voices', 'speakers']
    const query = Object.entries(init.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined)
    const qs = query.length ? `?${new URLSearchParams(query)}` : ''
    let last: Response | undefined
    for (const route of order) {
      const path = paths[route]
      if (!path) continue
      const url = `${this.#baseURL}${path}${qs}`
      const headers: Record<string, string> = { accept: init.audio ? '*/*' : 'application/json', authorization: `Bearer ${this.#apiKey}` }
      if (init.body) headers['content-type'] = 'application/json'
      if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey
      const body = init.form ?? (init.body ? JSON.stringify(init.body(route)) : undefined)
      const res = await call(() => fetch(url, { body, headers, method, signal: AbortSignal.timeout(timeoutFor(url, method)) }))
      if (res.status !== 404) {
        speakerRoutes.set(this.#baseURL, route)
        return res
      }
      last = res
    }
    if (!last) throw new VocalStackAPIError(404, 'not_found', 'Not found.')
    return last
  }

  async #speaker(method: string, paths: Partial<Record<SpeakerRoute, string>>, init?: SpeakerInit): Promise<SavedSpeaker> {
    const res = await this.#speakerRequest(method, paths, init)
    const body = (await res.json().catch(() => null)) as null | (RawSpeaker & { code?: string; message?: string })
    if (res.ok && body) return savedSpeakerOf(body)
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
    throw new VocalStackAPIError(res.status, body?.code ?? 'http_error', body?.message ?? `VocalStack answered ${res.status}`)
  }

  savedSpeaker(id: string) {
    // An empty id would read GET /v1/speakers/, the list, as if it were one speaker.
    if (!id) return Promise.reject(new VocalStackAPIError(404, 'not_found', 'No such speaker.'))
    return this.#speaker('GET', both(`/${encodeURIComponent(id)}`))
  }

  /** Save a speaker from a recorded sample (30 s or more), cloning their voice. Needs the speaker's permission. */
  createSpeaker(sample: Blob, fileName: string, meta: { consent: boolean; name: string }, idempotencyKey: string) {
    const form = new FormData()
    form.append('meta', JSON.stringify(meta))
    form.append('sample', sample, fileName)
    return this.#speaker('POST', both(''), { form, idempotencyKey })
  }

  /**
   * Save a speaker from stretches of a transcription (5–60 s in all), cloning their voice.
   * `draft` makes a trial to hear first; keep it with `keepSpeaker`, or delete it. Saved speakers
   * are the ones VocalStack looks for first when it works out who speaks in a new transcription.
   */
  speakerFromAppearance(
    opts: { draft: boolean; name: string; spans: { end: number; start: number }[]; speaker: number; transcriptionId: string },
    idempotencyKey: string,
  ) {
    const { speaker, ...rest } = opts
    return this.#speaker('POST', { speakers: '/v1/speakers/from-appearance' }, {
      body: () => ({ ...rest, appearance: speaker, consent: true, library: true }),
      idempotencyKey,
    })
  }

  /** Keep a trial speaker, as `name`, with the speaker's permission. */
  keepSpeaker(id: string, name: string) {
    return this.#speaker('PATCH', both(`/${encodeURIComponent(id)}`), { body: () => ({ consent: true, draft: false, library: true, name }) })
  }

  async deleteSpeaker(id: string): Promise<void> {
    const res = await this.#speakerRequest('DELETE', both(`/${encodeURIComponent(id)}`))
    if (res.ok) return
    const body = (await res.json().catch(() => null)) as null | { code?: string; message?: string }
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
    throw new VocalStackAPIError(res.status, body?.code ?? 'http_error', body?.message ?? `VocalStack answered ${res.status}`)
  }

  /** The saved speaker's cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
  speakerVoicePreview(id: string, lang?: string, format: 'caf' | 'ogg' = 'ogg') {
    return this.#speakerRequest('GET', both(`/${encodeURIComponent(id)}/preview`), { audio: true, query: { format, lang } })
  }

  availableVoices(lang: string, transcriptionId?: string) {
    return call(() => this.sdk.voices.available(lang, { transcription: transcriptionId }) as unknown as Promise<{ lang: string; voices: VoiceOption[] }>)
  }
}

/** A short label for the connected account, from whatever `/v1/me` carries. */
export function accountLabel(me: Record<string, unknown>): string | undefined {
  const pick = (o: unknown, ...keys: string[]): string | undefined => {
    if (!o || typeof o !== 'object') return undefined
    for (const k of keys) {
      const v = (o as Record<string, unknown>)[k]
      if (typeof v === 'string' && v) return v
    }
  }
  return pick(me.principal, 'name', 'displayName') ?? pick(me.organization, 'name') ?? pick(me.user, 'email', 'name') ?? pick(me, 'email', 'name', 'displayName')
}
