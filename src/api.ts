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
  recordingId: string
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

export type Voice = {
  createdAt: string
  /** A trial voice, to hear before it is kept. */
  draft?: boolean
  error?: null | string
  id: string
  name: string
  progress: number
  sampleS: number
  /** `training`, `ready` or `failed`. */
  state: string
}

export type VoiceOption = { cloned: boolean; default: boolean; gender?: null | string; id: string; name: string; quality: number; ready?: boolean }

/** A recording's spoken translation in one language and voice (`voiceKey` is `''` for the default voice). */
export type VoiceTrack = {
  /** Seconds each sentence's clip lasts, by sentence id. */
  clipDur?: Record<string, number>
  clips: number[]
  durationS?: null | number
  error?: null | string
  lang: string
  /** `queued`, `running`, `failed`, `sealed` (the track is ready), or `clips` (sentences only). */
  state: string
  /** `synthetic` or `cloned` (the API's voice modes); older APIs answer a voice name here, or nothing. */
  voice?: null | string
  voiceKey: string
  /** Each sentence's words as [start, end] within its clip, by sentence id. */
  wordTimes?: Record<string, [number, number][]>
}

export type Language = { code: string; name: string; native: string; translation: boolean; voice: boolean }

export type Languages = {
  languages: Language[]
  translation: string[]
  voice: string[]
}

export const UNAVAILABLE = 'VocalStack is unavailable, try again shortly.'

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
  if (method === 'POST' && path === '/v1/voices') return 120_000
  if (path.endsWith('/audio/clip') || path.endsWith('/preview')) return 60_000
  return 30_000
}

/** One error type: an engine that is down or slow (an upgrade, an outage) is `unavailable`. */
function toAPIError(err: unknown): VocalStackAPIError {
  if (err instanceof VocalStackAPIError) return err
  if (err instanceof VocalStackError) {
    const down = err.code === 'unavailable' || (err.code === 'internal' && (err.status === 502 || err.status === 503 || err.status === 504))
    if (down) return new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
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

  constructor(apiKey: string, baseURL = DEFAULT_API_URL) {
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

  job(recordingId: string) {
    return call(() => this.sdk.jobs.get(recordingId) as unknown as Promise<Job>)
  }

  /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
  stop(recordingId: string, reason?: string) {
    return call(() => this.sdk.recordings.stop(recordingId, reason) as Promise<unknown>)
  }

  transcript(recordingId: string) {
    return call(() => this.sdk.recordings.transcript(recordingId) as unknown as Promise<Transcript>)
  }

  /**
   * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
   * answers only the sentences it translates in that call, so stored ones are read here.
   */
  async storedTranslations(recordingId: string, lang: string): Promise<Record<string, string>> {
    const t = (await call(() => this.sdk.recordings.transcript(recordingId, { lang }))) as unknown as {
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
  translation(recordingId: string, lang: string, sentenceIds: number[]) {
    return call(() => this.sdk.recordings.translation(recordingId, lang, sentenceIds))
  }

  /**
   * Render spoken translations, one job per language, in the recording's default cast: VocalStack
   * picks each speaker's voice. `cloned` lets it use speakers' own cloned voices (each made with
   * that speaker's permission); otherwise it reads in stock voices.
   */
  async speak(recordingId: string, langs: string[], opts: { cloned?: boolean } = {}) {
    const render = (body: object) => call(() => this.sdk.recordings.renderVoice(recordingId, body as never) as unknown as Promise<VoiceTrack[]>)
    try {
      return await render({ langs, voice: opts.cloned ? 'cloned' : 'synthetic' })
    } catch (err) {
      // An API from before `voice: 'synthetic' | 'cloned'` takes it for a voice id: there, consent turns clones on.
      if (!(err instanceof VocalStackAPIError && err.status === 400 && /no voice '(cloned|synthetic)'/.test(err.message))) throw err
      return render({ consent: opts.cloned ? true : undefined, langs })
    }
  }

  voiceTracks(recordingId: string, lang?: string) {
    return call(() => this.sdk.recordings.voice(recordingId, lang) as unknown as Promise<VoiceTrack[]>)
  }

  /** An address of the recording's audio, or of a spoken translation's, that works for an hour or so. */
  async audioURL(recordingId: string, opts: { format?: 'caf' | 'mp3' | 'ogg'; kind: 'delivery' | 'voice'; lang?: string; voice?: string }): Promise<string> {
    const format = opts.format ?? 'mp3'
    if (opts.kind === 'delivery') return call(() => this.sdk.recordings.audioUrl(recordingId, { format, kind: 'delivery' }))
    // A reading in a named voice: a short-lived media token carries the voice in the address.
    const { token } = await call(() => this.sdk.recordings.mediaToken(recordingId))
    return this.sdk.recordings.audioSrc(recordingId, { format, kind: 'voice', lang: opts.lang, media: token, voice: opts.voice })
  }

  /** A stretch of the recording as WAV (16 kHz mono), at most 120 s. */
  clip(recordingId: string, startS: number, endS: number): Promise<Response> {
    return call(() => this.sdk.recordings.clip(recordingId, startS, endS))
  }

  voice(id: string) {
    return call(() => this.sdk.voices.get(id) as unknown as Promise<Voice>)
  }

  /** Clone a voice from a recorded sample (30 s or more). Needs the speaker's permission. */
  createVoice(sample: Blob, fileName: string, meta: { consent: boolean; name: string }, idempotencyKey: string) {
    return call(() => this.sdk.voices.create({ ...meta, fileName, sample } as never, { idempotencyKey }) as unknown as Promise<Voice>)
  }

  /**
   * Clone a speaker's voice from stretches of a transcribed recording (5–60 s in all). `draft`
   * makes a trial voice to hear first; keep it with `keepVoice`, or delete it.
   */
  voiceFromSpeaker(opts: { draft: boolean; name: string; recordingId: string; spans: { end: number; start: number }[]; speaker: number }, idempotencyKey: string) {
    return call(() => this.sdk.voices.createFromSpeaker({ ...opts, consent: true, library: false } as never, { idempotencyKey }) as unknown as Promise<Voice>)
  }

  /** Keep a trial voice, as `name`, with the speaker's permission. */
  keepVoice(id: string, name: string) {
    return call(() => this.sdk.voices.update(id, { consent: true, draft: false, name } as never) as unknown as Promise<Voice>)
  }

  deleteVoice(id: string) {
    return call(() => this.sdk.voices.delete(id) as Promise<unknown>)
  }

  availableVoices(lang: string, recordingId?: string) {
    return call(() => this.sdk.voices.available(lang, { recording: recordingId }) as unknown as Promise<{ lang: string; voices: VoiceOption[] }>)
  }

  /** The cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
  voicePreview(id: string, lang?: string, format: 'caf' | 'ogg' = 'ogg') {
    return call(() => this.sdk.voices.clonePreview(id, { format, lang }))
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
