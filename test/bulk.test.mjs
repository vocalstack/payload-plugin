// Transcribing a list selection, and saving jobs that finished with no one watching,
// against a stand-in Payload (sermons with audio rows) and a stand-in VocalStack API.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { bulkEndpoints } from '../dist/endpoints/bulk.js'

const API = 'https://api.test'
const realFetch = globalThis.fetch
const reply = (body, status = 200) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })

let docs
let answers
let created
let agents

const row = (id, filename, vocalstack) => ({ id, filename, type: 'file', ...(vocalstack ? { vocalstack } : {}) })

beforeEach(() => {
  created = []
  docs = {
    1: { id: 1, title: 'Psalm 91', attachments: [row('a', 'psalm91.mp3')] },
    2: { id: 2, title: 'Mark 14', attachments: [row('b', 'mark14.mp3', { status: 'done', transcript: 'Hello' })] },
    3: { id: 3, title: 'Hebrews 10', attachments: [row('c', 'heb10.mp3', { status: 'processing', transcriptionId: 'tx-old' })] },
    4: { id: 4, title: 'Notice', attachments: [{ id: 'd', type: 'link', url: 'https://example.test' }] },
    5: { id: 5, title: 'Psalm 103', attachments: [row('e', 'psalm103.mp3'), row('f', 'psalm103-q.mp3')] },
  }
  answers = {
    '/v1/transcriptions': () => {
      const id = `tx-${created.length + 1}`
      created.push(id)
      return reply({ id, job: { progress: { pct: 0 }, state: 'queued', transcriptionId: id }, name: 'x' }, 201)
    },
  }
  agents = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    agents.push(new Headers(init?.headers ?? input.headers).get('user-agent'))
    const answer = answers[url.pathname]
    return answer ? answer({ url }) : reply({ code: 'not_found', message: `no route for ${url.pathname}` }, 404)
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const payload = {
  collections: { sermons: { config: { access: {} } } },
  config: { serverURL: 'https://cms.test' },
  find: async ({ where }) => {
    const field = Object.keys(where.or[0])[0]
    assert.equal(field, 'attachments.vocalstack.status')
    return { docs: Object.values(docs).filter((d) => d.attachments.some((r) => r.vocalstack?.status === 'processing')) }
  },
  findByID: async ({ id }) => structuredClone(docs[id]) ?? Promise.reject(new Error('not found')),
  update: async ({ id, data }) => void (docs[id] = { ...docs[id], ...structuredClone(data) }),
}

const rowFields = [
  {
    audioURL: ({ row }) => (row.filename ? `https://files.test/${row.filename}` : undefined),
    collection: 'sermons',
    condition: (r) => r.type === 'file',
    field: 'attachments',
  },
]

const run = async (path, body) => {
  const endpoint = bulkEndpoints('sermons', { apiKey: 'vs_key', apiURL: API }, rowFields, false).find((e) => e.path === path)
  const req = {
    headers: new Headers(),
    json: async () => body,
    origin: 'https://cms.test',
    payload,
    routeParams: {},
    searchParams: new URLSearchParams(),
    user: { id: 1 },
  }
  const res = await endpoint.handler(req)
  return { body: await res.json(), status: res.status }
}

test('the selection is transcribed: every audio row, skipping what is done, running or not audio', async () => {
  const { body, status } = await run('/vocalstack/transcribe-many', { ids: [1, 2, 3, 4, 5] })
  assert.equal(status, 200)
  assert.equal(body.started, 3)
  assert.deepEqual(body.skipped, { done: 1, noAudio: 1, processing: 1 })
  assert.deepEqual(body.failed, [])
  assert.equal(docs[1].attachments[0].vocalstack.status, 'processing')
  assert.deepEqual(docs[5].attachments.map((r) => r.vocalstack.transcriptionId).sort(), ['tx-2', 'tx-3'])
  assert.equal(docs[2].attachments[0].vocalstack.transcript, 'Hello', 'a finished transcript is left alone')
  assert.ok(agents.length && agents.every((a) => /^VocalStack-Payload\/\d+\.\d+\.\d+/.test(a)), 'VocalStack is told the calls come from Payload')
})

test('out of credit: nothing more is started, and the reason comes back once', async () => {
  answers['/v1/transcriptions'] = () => reply({ code: 'insufficient_credit', message: 'Add credit to transcribe.' }, 402)
  const { body } = await run('/vocalstack/transcribe-many', { ids: [1, 5] })
  assert.equal(body.started, 0)
  assert.equal(body.stopped.error, 'Add credit to transcribe.')
  assert.equal(body.notStarted, 3)
  assert.equal(docs[1].attachments[0].vocalstack, undefined)
})

test('a batch is capped, so each request stays short', async () => {
  const { status } = await run('/vocalstack/transcribe-many', { ids: Array.from({ length: 26 }, (_, i) => i) })
  assert.equal(status, 400)
})

test('settle saves a job that finished while no one had it open', async () => {
  answers['/v1/transcriptions/tx-old/job'] = () => reply({ progress: { pct: 100 }, state: 'done', transcriptionId: 'tx-old' })
  answers['/v1/transcriptions/tx-old/transcript'] = () =>
    reply({ lang: 'en', segments: [], sentences: [{ end: 2, sentenceId: 0, speaker: 0, start: 0, text: 'Grace and peace.' }] })
  const { body } = await run('/vocalstack/settle')
  assert.deepEqual(body, { failed: 0, finished: 1, jobs: [], processing: 0 })
  const saved = docs[3].attachments[0].vocalstack
  assert.equal(saved.status, 'done')
  assert.equal(saved.transcript, 'Grace and peace.')
})
