import type { Endpoint, PayloadRequest } from 'payload'

import { addDataAndFileToRequest } from 'payload'
import { randomUUID } from 'node:crypto'

import type { VoiceCollectionConfig, VoiceFieldData, VoiceSource, VoiceState, VocalStackPluginOptions } from '../types.js'

import { type Languages, type Voice, DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../api.js'
import { resolveAPIKey } from '../settings.js'
import { apiError, canUpdate } from './transcribe.js'

const json = (body: unknown, status = 200) => Response.json(body, { status })

// VocalStack clones from 30 s to 120 s of speech (a clip is at most 120 s).
const MIN_SAMPLE_S = 30
const MAX_SAMPLE_S = 120

const STATES = new Set<VoiceState>(['failed', 'ready', 'training'])

/** VocalStack's voice as the document keeps it. */
const fieldData = (v: Voice): VoiceFieldData => ({
  createdAt: v.createdAt,
  error: v.error ?? null,
  progress: v.progress,
  sampleS: v.sampleS,
  state: STATES.has(v.state as VoiceState) ? (v.state as VoiceState) : 'training',
  voiceId: v.id,
})

const EMPTY: VoiceFieldData = { consentAt: null, createdAt: null, error: null, progress: null, sampleS: null, state: 'none', voiceId: null }

/**
 * A person's cloned voice, kept in the `vocalstackVoice` group of their document:
 *   GET    /:id/vocalstack/voice            where its training stands
 *   POST   /:id/vocalstack/voice            clone it: JSON { recordingId, startS, endS, consent },
 *                                           or multipart with a `file` sample and `_payload` { consent }
 *   DELETE /:id/vocalstack/voice            delete it, in VocalStack too
 *   GET    /:id/vocalstack/voice/sources    recordings to take the sample from
 *   GET    /:id/vocalstack/voice/clip       a stretch of one of them, to hear before cloning (?recording=&startS=&endS=)
 *   GET    /:id/vocalstack/voice/preview    the voice speaking (?lang=&format=ogg|caf)
 * A sample is only ever taken from the recordings `config.recordings` offers for that document.
 */
export function voiceEndpoints(config: VoiceCollectionConfig, options: VocalStackPluginOptions): Endpoint[] {
  const { collection } = config
  const apiURL = options.apiURL ?? DEFAULT_API_URL

  const open = async (req: PayloadRequest, verb: string): Promise<Response | { api: VocalStackAPI; doc: Record<string, unknown>; id: string }> => {
    const id = req.routeParams?.id as string
    if (!(await canUpdate(req, collection, id))) return json({ error: `You may not ${verb} this voice.` }, 403)
    if (options.access && !(await options.access({ req }))) return json({ error: `You may not ${verb} this voice.` }, 403)
    const apiKey = await resolveAPIKey(req, options)
    if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
    const doc = (await req.payload.findByID({ id, collection, depth: 0, overrideAccess: true, req }).catch(() => null)) as null | Record<string, unknown>
    if (!doc) return json({ error: 'Not found.' }, 404)
    return { api: new VocalStackAPI(apiKey, apiURL), doc, id }
  }

  /** Whether the recording is one the host offers for this person (`config.recordings`). */
  const ownRecording = async (req: PayloadRequest, doc: Record<string, unknown>, recordingId: string) =>
    ((await config.recordings?.({ doc, req })) ?? []).some((s) => s.recordingId === recordingId)

  const save = async (req: PayloadRequest, id: string, data: VoiceFieldData) => {
    await req.payload.update({ id, collection, data: { vocalstackVoice: data } as never, depth: 0, overrideAccess: true, req })
    return data
  }

  const nameOf = (req: PayloadRequest, doc: Record<string, unknown>) => {
    const title = req.payload.collections[collection]?.config.admin?.useAsTitle
    const name = config.name?.({ doc }) ?? (title && typeof doc[title] === 'string' ? (doc[title] as string) : typeof doc.name === 'string' ? doc.name : `${collection} ${doc.id}`)
    // VocalStack takes 1–60 characters.
    return name.trim().slice(0, 60) || `${collection} ${doc.id}`
  }

  return [
    {
      method: 'get',
      path: '/:id/vocalstack/voice',
      handler: async (req) => {
        const found = await open(req, 'see')
        if (found instanceof Response) return found
        const { api, doc, id } = found
        const current = (doc.vocalstackVoice ?? {}) as VoiceFieldData
        if (!current.voiceId || current.state === 'ready') return json({ name: nameOf(req, doc), vocalstackVoice: current })
        try {
          const next = { ...current, ...fieldData(await api.voice(current.voiceId)) }
          const changed = next.state !== current.state || next.progress !== current.progress || next.error !== current.error
          return json({ name: nameOf(req, doc), vocalstackVoice: changed ? await save(req, id, next) : current })
        } catch (err) {
          // Deleted in the VocalStack dashboard: there is no voice any more.
          if (err instanceof VocalStackAPIError && err.status === 404) return json({ name: nameOf(req, doc), vocalstackVoice: await save(req, id, EMPTY) })
          return apiError(err)
        }
      },
    },
    {
      method: 'post',
      path: '/:id/vocalstack/voice',
      handler: async (req) => {
        const found = await open(req, 'create')
        if (found instanceof Response) return found
        const { api, doc, id } = found

        let sample: { blob: Blob; name: string }
        let consent: boolean
        const multipart = req.headers.get('content-type')?.includes('multipart/')
        try {
          if (multipart) {
            await addDataAndFileToRequest(req)
            consent = (req.data as { consent?: unknown } | undefined)?.consent === true
            if (!req.file) return json({ error: 'Add an audio sample.' }, 400)
            sample = { blob: new Blob([new Uint8Array(req.file.data)], { type: req.file.mimetype }), name: req.file.name }
          } else {
            const body = (await req.json?.().catch(() => ({}))) as { consent?: unknown; endS?: unknown; recordingId?: unknown; startS?: unknown }
            consent = body.consent === true
            const [startS, endS] = [Number(body.startS), Number(body.endS)]
            if (typeof body.recordingId !== 'string' || !(endS - startS >= MIN_SAMPLE_S - 1.5 && endS - startS <= MAX_SAMPLE_S)) {
              return json({ error: `Pick ${MIN_SAMPLE_S} to ${MAX_SAMPLE_S} seconds of a recording.` }, 400)
            }
            if (!consent) return json({ error: 'Confirm you have their permission to clone their voice.' }, 400)
            if (!(await ownRecording(req, doc, body.recordingId))) return json({ error: 'That recording is not one of theirs.' }, 403)
            const clip = await api.clip(body.recordingId, startS, endS)
            sample = { blob: await clip.blob(), name: 'sample.wav' }
          }
          if (!consent) return json({ error: 'Confirm you have their permission to clone their voice.' }, 400)

          const previous = (doc.vocalstackVoice as null | VoiceFieldData | undefined)?.voiceId
          const voice = await api.createVoice(sample.blob, sample.name, { consent: true, name: nameOf(req, doc) }, `payload:${collection}:${id}:voice:${randomUUID()}`)
          const data = await save(req, id, { ...fieldData(voice), consentAt: new Date().toISOString() })
          // One voice per person: the old one goes once the new one exists.
          if (previous && previous !== voice.id) await api.deleteVoice(previous).catch(() => undefined)
          return json({ name: nameOf(req, doc), vocalstackVoice: data }, 201)
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'delete',
      path: '/:id/vocalstack/voice',
      handler: async (req) => {
        const found = await open(req, 'delete')
        if (found instanceof Response) return found
        const { api, doc, id } = found
        const voiceId = (doc.vocalstackVoice as null | VoiceFieldData | undefined)?.voiceId
        try {
          if (voiceId) await api.deleteVoice(voiceId)
        } catch (err) {
          if (!(err instanceof VocalStackAPIError && err.status === 404)) return apiError(err)
        }
        return json({ name: nameOf(req, doc), vocalstackVoice: await save(req, id, EMPTY) })
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/voice/sources',
      handler: async (req) => {
        const found = await open(req, 'create')
        if (found instanceof Response) return found
        const sources = (await config.recordings?.({ doc: found.doc, req })) ?? []
        return json({
          sources: sources.map(({ label, recordingId, sentences }): VoiceSource => ({
            label,
            recordingId,
            sentences: (sentences ?? []).filter((s) => !s.draft).map(({ end, id, speaker, start, text }) => ({ end, id, speaker, start, text })),
          })),
        })
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/voice/clip',
      handler: async (req) => {
        const found = await open(req, 'create')
        if (found instanceof Response) return found
        const recording = req.searchParams.get('recording')
        const [startS, endS] = [Number(req.searchParams.get('startS')), Number(req.searchParams.get('endS'))]
        if (!recording || !(endS > startS) || endS - startS > MAX_SAMPLE_S) return json({ error: `At most ${MAX_SAMPLE_S} seconds.` }, 400)
        if (!(await ownRecording(req, found.doc, recording))) return json({ error: 'That recording is not one of theirs.' }, 403)
        try {
          const res = await found.api.clip(recording, startS, endS)
          return new Response(res.body, { headers: { 'cache-control': 'private, max-age=3600', 'content-type': 'audio/wav' } })
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/voice/preview',
      handler: async (req) => {
        const found = await open(req, 'hear')
        if (found instanceof Response) return found
        const voiceId = (found.doc.vocalstackVoice as null | VoiceFieldData | undefined)?.voiceId
        if (!voiceId) return json({ error: 'There is no voice yet.' }, 404)
        const format = req.searchParams.get('format') === 'caf' ? 'caf' : 'ogg'
        try {
          const res = await found.api.voicePreview(voiceId, req.searchParams.get('lang') ?? undefined, format)
          // 202: being rendered; the client asks again.
          if (res.status === 202) return json({ pending: true }, 202)
          if (!res.ok) return json({ error: `VocalStack answered ${res.status}` }, res.status >= 500 ? 502 : res.status)
          return new Response(res.body, { headers: { 'cache-control': 'private, max-age=3600', 'content-type': res.headers.get('content-type') ?? 'audio/ogg' } })
        } catch (err) {
          return apiError(err)
        }
      },
    },
  ]
}

let languages: { at: number; value: Languages } | undefined

/**
 * Shared admin lookups (signed in, and `options.access` when set):
 *   GET /vocalstack/languages                      what can be translated and spoken
 *   GET /vocalstack/voices?lang=&recording=        voices that can speak a language
 */
export function lookupEndpoints(options: VocalStackPluginOptions): Endpoint[] {
  const apiURL = options.apiURL ?? DEFAULT_API_URL
  const api = async (req: PayloadRequest) => {
    if (!req.user) return json({ error: 'Sign in first.' }, 401)
    if (options.access && !(await options.access({ req }))) return json({ error: 'You may not use VocalStack here.' }, 403)
    const apiKey = await resolveAPIKey(req, options)
    if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
    return new VocalStackAPI(apiKey, apiURL)
  }

  return [
    {
      method: 'get',
      path: '/vocalstack/languages',
      handler: async (req) => {
        const client = await api(req)
        if (client instanceof Response) return client
        try {
          if (!languages || Date.now() - languages.at > 3600_000) languages = { at: Date.now(), value: await client.languages() }
          return json(languages.value)
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'get',
      path: '/vocalstack/voices',
      handler: async (req) => {
        const client = await api(req)
        if (client instanceof Response) return client
        const lang = req.searchParams.get('lang')
        if (!lang) return json({ error: 'Which language?' }, 400)
        try {
          return json(await client.availableVoices(lang, req.searchParams.get('recording') ?? undefined))
        } catch (err) {
          return apiError(err)
        }
      },
    },
  ]
}
