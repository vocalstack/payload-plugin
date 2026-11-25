import type { CollectionSlug, Endpoint, PayloadRequest, Where } from 'payload'

import { randomUUID } from 'node:crypto'

import type { ArrayRow, AudioFieldConfig, BulkSettleResponse, BulkTranscribeResponse, UploadDoc, VocalStackPluginOptions } from '../types.js'

import { DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../api.js'
import { resolveAPIKey } from '../settings.js'
import { apiError, canUpdate, checkJob, locate, refileWith, startJob } from './transcribe.js'

const json = (body: unknown, status = 200) => Response.json(body, { status })

/** Documents one call may start; the admin sends a long selection in batches, so each request stays short. */
export const BULK_BATCH = 25
/** Jobs one settle checks, a few at a time. */
const SETTLE_LIMIT = 40
const SETTLE_PARALLEL = 4
/** A list open in several tabs asks often; VocalStack is asked at most this often per collection. */
const SETTLE_EVERY_MS = 4_000

type At = { field?: string; id: number | string; row?: string }

/** What there is to transcribe in one document: the upload itself, and each audio row. */
async function targetsOf(req: PayloadRequest, collection: CollectionSlug, rowFields: AudioFieldConfig[], isUpload: boolean, id: number | string): Promise<At[]> {
  const doc = (await req.payload.findByID({ id, collection, depth: 0, overrideAccess: false, req, user: req.user }).catch(() => null)) as null | Record<string, unknown>
  if (!doc) return []
  const out: At[] = []
  if (isUpload && (doc as UploadDoc).mimeType?.startsWith('audio/')) out.push({ id })
  for (const config of rowFields) {
    for (const row of (doc[config.field] as ArrayRow[] | undefined) ?? []) {
      if (row?.id && (!config.condition || config.condition(row))) out.push({ field: config.field, id, row: row.id })
    }
  }
  return out
}

/** Run `work` over `items`, `n` at a time. */
async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  }))
}

/** A refusal that every other start would get too: no key, no credit, a cap or rate limit. */
const stopsAll = (err: unknown) => err instanceof VocalStackAPIError && [401, 402, 403, 429].includes(err.status)

/** A job's phase in the list's words: the work before and after transcribing reads as queued, fetching or finalizing. */
function phaseOf(phase: null | string | undefined, progress: number): string {
  if (phase === 'transcribing') return progress >= 99 ? 'finalizing' : 'transcribing'
  if (phase === 'fetching' || phase === 'extracting') return 'fetching'
  if (!phase || phase === 'queued') return 'queued'
  return progress > 0 ? 'finalizing' : 'queued'
}

const lastSettle = new Map<string, { at: number; result: BulkSettleResponse }>()

/**
 * POST /api/<collection>/vocalstack/transcribe-many { ids } starts a transcription for each
 * audio file of each document (the upload itself, or every audio row). Files already
 * transcribed or being transcribed are skipped. At most BULK_BATCH documents per call.
 *
 * POST /api/<collection>/vocalstack/settle saves every job of the collection that has
 * finished, so transcriptions started from the list are kept without anyone opening them.
 */
export function bulkEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], isUpload: boolean): Endpoint[] {
  const apiURL = options.apiURL ?? DEFAULT_API_URL

  return [
    {
      method: 'post',
      path: '/vocalstack/transcribe-many',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Sign in first.' }, 401)
        if (options.access && !(await options.access({ req }))) return json({ error: 'You may not transcribe these files.' }, 403)
        const body = (await req.json?.().catch(() => ({}))) as { ids?: unknown }
        const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is number | string => typeof id === 'string' || typeof id === 'number') : []
        if (!ids.length) return json({ error: 'Choose what to transcribe.' }, 400)
        if (ids.length > BULK_BATCH) return json({ error: `At most ${BULK_BATCH} at a time.` }, 400)

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409)
        const api = new VocalStackAPI(apiKey, apiURL)

        const result: BulkTranscribeResponse = { failed: [], notStarted: 0, skipped: { done: 0, noAudio: 0, processing: 0 }, started: 0 }
        for (const id of ids) {
          if (!(await canUpdate(req, collection, id))) {
            result.failed.push({ error: 'You may not transcribe this.', id })
            continue
          }
          const targets = await targetsOf(req, collection, rowFields, isUpload, id)
          if (!targets.length) result.skipped.noAudio++
          for (const at of targets) {
            if (result.stopped) {
              result.notStarted++
              continue
            }
            const target = await locate(req, collection, options, rowFields, 'admin', at)
            if (target instanceof Response) {
              result.failed.push({ error: ((await target.json().catch(() => ({}))) as { error?: string }).error ?? 'Not found.', id })
              continue
            }
            if (target.data.status === 'processing') {
              result.skipped.processing++
              continue
            }
            if (target.data.status === 'done' && target.data.transcript) {
              result.skipped.done++
              continue
            }
            if (!(await target.url())) {
              result.skipped.noAudio++
              continue
            }
            try {
              const call = { idempotencyKey: `payload:${collection}:${id}:${randomUUID()}`, name: target.name, spokenLanguage: options.spokenLanguage }
              const tx = await startJob(req, api, target, call)
              await target.save({ error: null, recordingId: null, status: 'processing', transcriptionId: tx.id })
              result.started++
            } catch (err) {
              if (stopsAll(err)) {
                const { code, error } = (await apiError(err).json()) as { code?: string; error: string }
                result.stopped = { code, error }
                result.notStarted++
              } else result.failed.push({ error: err instanceof Error ? err.message : String(err), id })
            }
          }
        }
        return json(result)
      },
    },
    {
      method: 'post',
      path: '/vocalstack/settle',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Sign in first.' }, 401)
        const recent = lastSettle.get(collection)
        if (recent && Date.now() - recent.at < SETTLE_EVERY_MS) return json({ ...recent.result, failed: 0, finished: 0 })

        const where: Where = {
          or: [
            ...(isUpload ? [{ 'vocalstack.status': { equals: 'processing' } }] : []),
            ...rowFields.map((f) => ({ [`${f.field}.vocalstack.status`]: { equals: 'processing' } })),
          ],
        }
        // Read as the user: only what they may see is checked.
        const { docs } = await req.payload.find({ collection, depth: 0, limit: SETTLE_LIMIT, overrideAccess: false, pagination: false, req, user: req.user, where })
        const pending: At[] = []
        for (const doc of docs as Record<string, unknown>[]) {
          const id = doc.id as number | string
          if (isUpload && (doc as UploadDoc).vocalstack?.status === 'processing') pending.push({ id })
          for (const { field } of rowFields) {
            for (const row of (doc[field] as ArrayRow[] | undefined) ?? []) if (row?.id && row.vocalstack?.status === 'processing') pending.push({ field, id, row: row.id })
          }
        }
        const result: BulkSettleResponse = { failed: 0, finished: 0, jobs: [], processing: 0 }
        if (!pending.length) {
          lastSettle.set(collection, { at: Date.now(), result })
          return json(result)
        }

        const apiKey = await resolveAPIKey(req, options)
        if (!apiKey) return json({ ...result, processing: pending.length })
        const api = new VocalStackAPI(apiKey, apiURL)
        await pool(pending, SETTLE_PARALLEL, async (at) => {
          const target = await locate(req, collection, options, rowFields, 'admin', at)
          if (target instanceof Response || target.data.status !== 'processing' || !target.data.transcriptionId) return
          try {
            const status = await checkJob(api, target, target.data.transcriptionId, refileWith(req, api, target, collection, options.spokenLanguage), false)
            if (status.status === 'processing') {
              result.processing++
              result.jobs.push({ id: at.id, phase: phaseOf(status.phase, status.progress ?? 0), progress: Math.round(status.progress ?? 0), row: at.row })
            } else if (status.status === 'failed') result.failed++
            else result.finished++
          } catch {
            // VocalStack could not be asked now; the next settle asks again.
            result.processing++
            result.jobs.push({ id: at.id, phase: 'queued', progress: 0, row: at.row })
          }
        })
        lastSettle.set(collection, { at: Date.now(), result })
        return json(result)
      },
    },
  ]
}
