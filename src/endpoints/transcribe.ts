import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

import { randomUUID } from 'node:crypto'

import type { ArrayRow, AudioFieldConfig, StatusResponse, TranscriptSentence, UploadDoc, VocalStackFieldData, VocalStackPluginOptions } from '../types.js'

import { type Transcript, DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../api.js'
import { fetchFile, isPublicURL, resolveFileURL } from '../fileSource.js'
import { attachWords, transcriptText } from '../text.js'
import { resolveAPIKey } from '../settings.js'

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Saves to one document, one at a time. Payload writes array fields by deleting and
 * re-inserting every row (of every array), so two overlapping saves collide in the database.
 */
const queues = new Map<string, Promise<unknown>>()
function serially<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(run, run)
  const settled = next.catch(() => undefined)
  queues.set(key, settled)
  void settled.then(() => queues.get(key) === settled && queues.delete(key))
  return next
}

/** Finished jobs being saved, so that every "done" signal for one job shares a single save. */
const finishing = new Map<string, Promise<StatusResponse>>()

/** Whether the signed-in user may update this document, by the collection's own `access.update`. */
async function canUpdate(req: PayloadRequest, collection: CollectionSlug, id: number | string): Promise<boolean> {
  if (!req.user) return false
  const access = req.payload.collections[collection]?.config.access.update
  if (!access) return true
  const result = await access({ id, req })
  if (typeof result !== 'object') return Boolean(result)
  const { totalDocs } = await req.payload.count({ collection, overrideAccess: true, req, where: { and: [{ id: { equals: id } }, result] } })
  return totalDocs > 0
}

/** One transcribable thing: an upload document, or one row of an array field. */
export type Target = {
  data: VocalStackFieldData
  fileName: string
  name: string
  save: (patch: VocalStackFieldData) => Promise<VocalStackFieldData>
  url: () => Promise<string | undefined>
}

export async function locate(
  req: PayloadRequest,
  collection: CollectionSlug,
  options: VocalStackPluginOptions,
  rowFields: AudioFieldConfig[],
  readAs: 'admin' | 'user',
): Promise<Response | Target> {
  const id = req.routeParams?.id as string
  const find = (overrideAccess: boolean) =>
    req.payload.findByID({ id, collection, depth: 0, overrideAccess, req, user: req.user }).catch(() => null) as Promise<null | Record<string, unknown>>
  const doc = await find(readAs === 'admin')
  if (!doc) return json({ error: 'Not found.' }, 404)
  const field = req.searchParams.get('field')

  if (!field) {
    const upload = doc as UploadDoc
    if (!req.payload.collections[collection]?.config.upload) return json({ error: 'Not an upload collection.' }, 400)
    if (!upload.mimeType?.startsWith('audio/')) return json({ error: 'Only audio files can be transcribed.' }, 400)
    return {
      data: upload.vocalstack ?? {},
      fileName: upload.filename ?? 'audio',
      name: upload.filename ?? `${collection} ${id}`,
      save: (patch) =>
        serially(`${collection}:${id}`, async () => {
          const vocalstack = { ...upload.vocalstack, ...patch }
          await req.payload.update({ id, collection, data: { vocalstack } as never, depth: 0, overrideAccess: true, req })
          return vocalstack
        }),
      url: () => resolveFileURL(req, collection, upload, options),
    }
  }

  const config = rowFields.find((f) => f.field === field)
  if (!config) return json({ error: `${field} is not a VocalStack audio field.` }, 400)
  const rowId = req.searchParams.get('row')
  const row = ((doc[field] as ArrayRow[] | undefined) ?? []).find((r) => r.id === rowId)
  if (!row) return json({ error: 'Save the document first, then transcribe.' }, 404)
  const base = req.payload.config.serverURL || req.origin
  return {
    data: row.vocalstack ?? {},
    fileName: 'audio',
    name: config.name?.({ doc, row }) ?? (typeof doc.title === 'string' && doc.title ? doc.title : `${collection} ${id}`),
    save: (patch) =>
      serially(`${collection}:${id}`, async () => {
        // Re-read so edits saved to other rows meanwhile are kept; arrays are written whole.
        const fresh = (await find(true)) ?? doc
        let saved: VocalStackFieldData | undefined
        const rows = ((fresh[field] as ArrayRow[] | undefined) ?? []).map((r) => {
          if (r.id !== rowId) return r
          saved = { ...r.vocalstack, ...patch }
          return { ...r, vocalstack: saved }
        })
        if (!saved) throw new Error('That row was removed.')
        await req.payload.update({ id, collection, data: { [field]: rows } as never, depth: 0, overrideAccess: true, req })
        return saved
      }),
    url: async () => {
      const url = await config.audioURL({ doc, req, row })
      return url ? new URL(url, base).toString() : undefined
    },
  }
}

/** A transcript's sentences, each with its words. */
export function toSentences(t: Pick<Transcript, 'segments' | 'sentences'>): TranscriptSentence[] {
  const sentences = t.sentences
    .filter((s) => !s.suppressed && s.text.trim())
    .map(({ end, sentenceId, speaker, start, text }) => ({ id: sentenceId, end, speaker, start, text: text.trim() }))
  return attachWords(sentences, (t.segments ?? []).filter((g) => !g.suppressed).flatMap((g) => g.words ?? []))
}

export function apiError(err: unknown): Response {
  if (err instanceof VocalStackAPIError) {
    const status = err.status === 401 ? 409 : err.status >= 500 ? 502 : err.status
    const code = err.status === 401 ? 'not_connected' : err.code
    const message = err.status === 401 ? 'The VocalStack API key was refused. Reconnect VocalStack.' : err.message
    return json({ code, error: message }, status)
  }
  return json({ error: err instanceof Error ? err.message : String(err) }, 500)
}

/**
 * Where a job stands, saving the outcome on the document once it is over: the
 * whole transcript when done, the reason when it failed.
 */
export async function checkJob(api: VocalStackAPI, target: Target, recordingId: string): Promise<StatusResponse> {
  const job = await api.job(recordingId)
  if (job.state === 'failed' && job.errorCode === 'stopped') return restore(target)
  if (job.state === 'failed' || job.state === 'cropping') {
    const error = job.state === 'cropping' ? 'VocalStack is waiting for a crop window; open the transcription in VocalStack.' : (job.error ?? 'The transcription failed.')
    return { error, status: 'failed', vocalstack: await target.save({ error, status: 'failed' }) }
  }
  if (job.state !== 'done') {
    const progress = job.state === 'fetching' ? (job.progress.phasePct ?? 0) : job.progress.pct
    if (job.state !== 'transcribing') return { phase: job.progress.phase ?? job.state, progress, status: 'processing' }
    // Sentences are readable while the job runs; send what is there so far.
    const partial = await api.transcript(recordingId).then(toSentences, () => undefined)
    return { audio: { processedS: job.progress.processedS ?? 0, totalS: job.progress.totalS ?? undefined }, partial, phase: 'transcribing', progress, status: 'processing' }
  }
  let saving = finishing.get(recordingId)
  if (!saving) {
    saving = saveTranscript(api, target, recordingId)
    finishing.set(recordingId, saving)
    void saving.catch(() => undefined).then(() => finishing.delete(recordingId))
  }
  return saving
}

/**
 * A stopped job leaves the field as it was before Transcribe: the earlier transcript, if
 * there was one (a new job only replaces it once done), or none. The job's partial
 * transcript stays in VocalStack.
 */
async function restore(target: Target): Promise<StatusResponse> {
  const status = target.data.transcript ? 'done' : 'idle'
  return { status, stopped: true, vocalstack: await target.save({ error: null, status }) }
}

async function saveTranscript(api: VocalStackAPI, target: Target, recordingId: string): Promise<StatusResponse> {
  const transcript = await api.transcript(recordingId)
  const sentences = toSentences(transcript)
  const vocalstack = await target.save({
    error: null,
    language: transcript.lang ?? transcript.sentences.find((s) => s.language)?.language ?? null,
    sentences,
    status: 'done',
    transcribedAt: new Date().toISOString(),
    transcript: transcriptText(sentences),
  })
  return { progress: 100, status: 'done', vocalstack }
}

/**
 * POST /:id/vocalstack/transcribe and GET /:id/vocalstack/status. With no query
 * they act on the upload document itself; with `?field=<array>&row=<row id>` on one row.
 */
export function transcribeEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[] {
  const apiURL = options.apiURL ?? DEFAULT_API_URL

  return [
    {
      method: 'post',
      path: '/:id/vocalstack/transcribe',
      handler: async (req) => {
        const id = req.routeParams?.id as string
        if (!(await canUpdate(req, collection, id))) return json({ error: 'You may not transcribe this file.' }, 403)
        if (options.access && !(await options.access({ req }))) return json({ error: 'You may not transcribe this file.' }, 403)

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)

        const target = await locate(req, collection, options, rowFields, 'admin')
        if (target instanceof Response) return target
        if (target.data.status === 'processing') return json({ status: 'processing', vocalstack: target.data } satisfies StatusResponse)

        const url = await target.url()
        if (!url) return json({ error: 'There is no audio file here.' }, 400)

        const api = new VocalStackAPI(apiKey, apiURL)
        const call = { idempotencyKey: `payload:${collection}:${id}:${randomUUID()}`, name: target.name, spokenLanguage: options.spokenLanguage }
        try {
          const tx = isPublicURL(url)
            ? await api.transcribeURL(url, call)
            : await api.transcribeFile(await fetchFile(req, url), decodeURIComponent(new URL(url).pathname.split('/').pop() || target.fileName), call)
          if (!tx.job) throw new Error('VocalStack did not start a job for this file.')
          const vocalstack = await target.save({ error: null, recordingId: tx.job.recordingId, status: 'processing', transcriptionId: tx.id })
          return json({ phase: tx.job.state, progress: 0, status: 'processing', vocalstack } satisfies StatusResponse, 202)
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'get',
      path: '/:id/vocalstack/status',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Sign in first.' }, 401)
        // Read through access control: only someone who can see the document sees its status.
        const target = await locate(req, collection, options, rowFields, 'user')
        if (target instanceof Response) return target

        const field = target.data
        if (field.status !== 'processing' || !field.recordingId) return json({ status: field.status ?? 'idle', vocalstack: field } satisfies StatusResponse)

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
        try {
          return json(await checkJob(new VocalStackAPI(apiKey, apiURL), target, field.recordingId))
        } catch (err) {
          return apiError(err)
        }
      },
    },
    {
      method: 'post',
      path: '/:id/vocalstack/stop',
      handler: async (req) => {
        const id = req.routeParams?.id as string
        if (!(await canUpdate(req, collection, id))) return json({ error: 'You may not stop this transcription.' }, 403)
        if (options.access && !(await options.access({ req }))) return json({ error: 'You may not stop this transcription.' }, 403)

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)

        const target = await locate(req, collection, options, rowFields, 'admin')
        if (target instanceof Response) return target
        const { recordingId, status } = target.data
        if (status !== 'processing' || !recordingId) return json({ status: status ?? 'idle', vocalstack: target.data } satisfies StatusResponse)

        const api = new VocalStackAPI(apiKey, apiURL)
        try {
          await api.stop(recordingId, 'Stopped from Payload')
          return json(await restore(target))
        } catch (err) {
          // Too late to stop: the job ended meanwhile, so take its outcome instead.
          if (err instanceof VocalStackAPIError && err.status === 409) return json(await checkJob(api, target, recordingId).catch(() => restore(target)))
          return apiError(err)
        }
      },
    },
  ]
}
