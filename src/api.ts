/**
 * The handful of VocalStack API calls the plugin needs, on plain fetch (the
 * SDK is not on npm yet). Contract: https://api.vocalstack.com/v1/openapi.json
 */

export const DEFAULT_API_URL = 'https://api.vocalstack.com'
export const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com'

export type JobState = 'cropping' | 'done' | 'failed' | 'fetching' | 'queued' | 'transcribing'

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

  private async request<T>(method: string, path: string, body?: BodyInit | object, headers: Record<string, string> = {}): Promise<T> {
    const init: RequestInit = { headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}`, ...headers }, method }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      init.body = JSON.stringify(body)
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
    }
    const res = await fetch(`${this.baseURL}${path}`, init)
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
