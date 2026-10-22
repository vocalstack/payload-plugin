/**
 * The handful of VocalStack API calls the plugin needs, on plain fetch (the
 * SDK is not on npm yet). Contract: https://api.vocalstack.com/v1/openapi.json
 */

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
  voice?: null | string
  voiceKey: string
  /** Each sentence's words as [start, end] within its clip, by sentence id. */
  wordTimes?: Record<string, [number, number][]>
}

export type Languages = {
  languages: { code: string; name: string; native: string; translation: boolean; voice: boolean }[]
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

export class VocalStackAPI {
  constructor(
    private apiKey: string,
    private baseURL = DEFAULT_API_URL,
  ) {}

  /**
   * The raw answer. An engine that is down or does not answer in time (an upgrade, an
   * outage) is one error, `unavailable`, so the admin says so instead of hanging.
   */
  async fetch(method: string, path: string, opts: { body?: BodyInit | object; headers?: Record<string, string>; redirect?: RequestRedirect; timeoutMs?: number } = {}): Promise<Response> {
    const init: RequestInit = {
      headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}`, ...opts.headers },
      method,
      redirect: opts.redirect,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    }
    if (opts.body instanceof FormData) init.body = opts.body
    else if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body)
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
    }
    let res: Response
    try {
      res = await fetch(`${this.baseURL}${path}`, init)
    } catch {
      throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
    }
    if (res.status === 502 || res.status === 504 || (res.status === 503 && !res.headers.get('content-type')?.includes('json'))) {
      throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE)
    }
    return res
  }

  private async request<T>(method: string, path: string, body?: BodyInit | object, headers: Record<string, string> = {}, timeoutMs?: number): Promise<T> {
    const res = await this.fetch(method, path, { body, headers, timeoutMs })
    const data = await res.json().catch(() => undefined)
    if (!res.ok) {
      const err = (data?.error ?? data) as { code?: string; message?: string } | undefined
      throw new VocalStackAPIError(res.status, err?.code ?? 'http_error', err?.message ?? `VocalStack answered ${res.status}`)
    }
    return data as T
  }

  me() {
    return this.request<Record<string, unknown>>('GET', '/v1/me')
  }

  transcribeURL(url: string, opts: { idempotencyKey: string; name: string; spokenLanguage?: string }) {
    return this.request<Transcription>(
      'POST',
      '/v1/transcriptions',
      { name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined, url },
      { 'idempotency-key': opts.idempotencyKey },
    )
  }

  transcribeFile(file: Blob, fileName: string, opts: { idempotencyKey: string; name: string; spokenLanguage?: string }) {
    const form = new FormData()
    form.append('options', JSON.stringify({ name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined }))
    form.append('file', file, fileName)
    return this.request<Transcription>('POST', '/v1/transcriptions', form, { 'idempotency-key': opts.idempotencyKey })
  }

  job(recordingId: string) {
    return this.request<Job>('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/job`)
  }

  /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
  stop(recordingId: string, reason?: string) {
    return this.request<unknown>('POST', `/v1/recordings/${encodeURIComponent(recordingId)}/stop`, { reason: reason ?? null })
  }

  transcript(recordingId: string) {
    return this.request<Transcript>('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/transcript`)
  }

  /**
   * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
   * answers only the sentences it translates in that call, so stored ones are read here.
   */
  async storedTranslations(recordingId: string, lang: string): Promise<Record<string, string>> {
    const t = await this.request<{ sentences: { sentenceId: number; translations?: null | Record<string, string> }[] }>(
      'GET',
      `/v1/recordings/${encodeURIComponent(recordingId)}/transcript?lang=${encodeURIComponent(lang)}`,
    )
    const out: Record<string, string> = {}
    for (const s of t.sentences ?? []) {
      const text = s.translations?.[lang]
      if (text?.trim()) out[String(s.sentenceId)] = text
    }
    return out
  }

  languages() {
    return this.request<Languages>('GET', '/v1/languages')
  }

  /** Sentences translated into `lang`, by sentence id. Untranslated ones are translated now, which takes a while. */
  translation(recordingId: string, lang: string, sentenceIds: number[]) {
    const q = new URLSearchParams({ lang, sentences: sentenceIds.join(',') })
    return this.request<{ lang: string; translations: Record<string, string> }>('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/translation?${q}`, undefined, {}, 180_000)
  }

  /** Render spoken translations, one job per language, in `voice` (the default voice when left out). */
  speak(recordingId: string, langs: string[], voice?: string) {
    return this.request<VoiceTrack[]>('POST', `/v1/recordings/${encodeURIComponent(recordingId)}/voice`, voice ? { langs, voice } : { langs })
  }

  voiceTracks(recordingId: string, lang?: string) {
    return this.request<VoiceTrack[]>('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/voice${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`)
  }

  /** A freshly signed address (an hour) of the recording's audio, or of a spoken translation's. */
  async audioURL(recordingId: string, opts: { format?: 'caf' | 'mp3' | 'ogg'; kind: 'delivery' | 'voice'; lang?: string; voice?: string }): Promise<string> {
    const q = new URLSearchParams({ format: opts.format ?? 'mp3', kind: opts.kind })
    if (opts.lang) q.set('lang', opts.lang)
    if (opts.voice) q.set('voice', opts.voice)
    const res = await this.fetch('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/audio?${q}`, { redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) return new URL(location, this.baseURL).toString()
    const data = (await res.json().catch(() => undefined)) as { code?: string; message?: string } | undefined
    throw new VocalStackAPIError(res.ok ? 502 : res.status, data?.code ?? 'http_error', data?.message ?? `VocalStack answered ${res.status}`)
  }

  /** A stretch of the recording as WAV (16 kHz mono), at most 120 s. */
  async clip(recordingId: string, startS: number, endS: number): Promise<Response> {
    const res = await this.fetch('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/audio/clip?startS=${startS}&endS=${endS}`, { timeoutMs: 60_000 })
    if (!res.ok) await this.raise(res)
    return res
  }

  voice(id: string) {
    return this.request<Voice>('GET', `/v1/voices/${encodeURIComponent(id)}`)
  }

  /** Clone a voice from a recorded sample (30 s or more). Needs the speaker's permission. */
  createVoice(sample: Blob, fileName: string, meta: { consent: boolean; name: string }, idempotencyKey: string) {
    const form = new FormData()
    form.append('meta', JSON.stringify(meta))
    form.append('sample', sample, fileName)
    return this.request<Voice>('POST', '/v1/voices', form, { 'idempotency-key': idempotencyKey }, 120_000)
  }

  deleteVoice(id: string) {
    return this.request<unknown>('DELETE', `/v1/voices/${encodeURIComponent(id)}`)
  }

  availableVoices(lang: string, recordingId?: string) {
    const q = new URLSearchParams({ lang })
    if (recordingId) q.set('recording', recordingId)
    return this.request<{ lang: string; voices: VoiceOption[] }>('GET', `/v1/voices/available?${q}`)
  }

  /** The cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
  voicePreview(id: string, lang?: string, format: 'caf' | 'ogg' = 'ogg') {
    const q = new URLSearchParams({ format })
    if (lang) q.set('lang', lang)
    return this.fetch('GET', `/v1/voices/${encodeURIComponent(id)}/preview?${q}`, { timeoutMs: 60_000 })
  }

  private async raise(res: Response): Promise<never> {
    const data = (await res.json().catch(() => undefined)) as { code?: string; error?: { code?: string; message?: string }; message?: string } | undefined
    const err = data?.error ?? data
    throw new VocalStackAPIError(res.status, err?.code ?? 'http_error', err?.message ?? `VocalStack answered ${res.status}`)
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
